import React, { useEffect, useRef, useState } from 'react';
import { fabric } from 'fabric';
import { jsPDF } from 'jspdf';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import {
  Image as ImageIcon, Download, Trash2, Layers, MoveUp, MoveDown,
  Lock, Unlock, FlipHorizontal, FlipVertical, Undo, Redo, Plus,
  LayoutTemplate, Maximize, GripHorizontal, FileText, Loader2,
  Crop, Copy, RotateCcw, AlignCenterHorizontal, AlignCenterVertical,
  Maximize2, Minimize2, Magnet, Move, Check, X, Ratio, Crosshair,
  FilePlus2, Menu, Settings
} from 'lucide-react';

// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

const readFileAsDataURL = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = (e) => resolve(e.target.result);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const degToRad = (deg) => (deg * Math.PI) / 180;

const rotateVector = (x, y, degrees) => {
  const r = degToRad(degrees);
  return {
    x: x * Math.cos(r) - y * Math.sin(r),
    y: x * Math.sin(r) + y * Math.cos(r),
  };
};

const getObjectCenter = (obj) => obj.getCenterPoint();

const safeFileName = (name, fallback = 'BareenaPDFs') => {
  const cleaned = String(name || '').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ');
  return (cleaned || fallback).replace(/\.pdf$/i, '');
};

const drawRotationHandle = (ctx, left, top) => {
  const radius = 14;
  ctx.save();
  ctx.translate(left, top);
  ctx.beginPath();
  ctx.fillStyle = '#0b1220';
  ctx.strokeStyle = '#00c3ff';
  ctx.lineWidth = 2;
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.arc(-1, 1, 6.5, degToRad(212), degToRad(28));
  ctx.stroke();
  ctx.beginPath();
  ctx.fillStyle = '#ffffff';
  ctx.moveTo(7, -3); ctx.lineTo(10, 1); ctx.lineTo(5, 1); ctx.closePath(); ctx.fill();
  ctx.restore();
};


// ==========================================
// ENGINE 1: CUSTOMISABLE CANVAS PAGE
// ==========================================
const PageCanvas = ({
  page, pageIndex, totalPages,
  onSetActive, activeCanvasId,
  moveUp, moveDown, deletePage, toggleOrientation, registerCanvas,
  onDragStart, onDragEnter, onDragEnd
}) => {
  const canvasRef = useRef(null);
  const [canvas, setCanvas] = useState(null);
  const [isDraggable, setIsDraggable] = useState(false);
  const [pageScale, setPageScale] = useState(1);

  useEffect(() => {
    if (!fabric.Object.prototype._bareenaPDFsConfigured) {
      fabric.Object.prototype.set({
        transparentCorners: false,
        cornerColor: '#ffffff',
        cornerStrokeColor: '#00c3ff',
        borderColor: '#00c3ff',
        cornerSize: 12,
        padding: 0,
        borderDashArray: [4, 4],
        lockUniScaling: true,
        centeredRotation: true,
        centeredScaling: true,
        touchCornerSize: 44,
      });
      fabric.Object.prototype._bareenaPDFsConfigured = true;
    }

    const configureRotationControl = (obj) => {
      const rotationControl = obj?.controls?.mtr;
      if (!rotationControl) return;
      rotationControl.x = 0;
      rotationControl.y = -0.5;
      rotationControl.offsetY = -30;
      rotationControl.cursorStyle = 'grab';
      rotationControl.render = drawRotationHandle;
      rotationControl.sizeX = 28;
      rotationControl.sizeY = 28;
    };

    if (fabric.Object.prototype.controls?.mtr) configureRotationControl(fabric.Object.prototype);

    const pageWidth = page.orientation === 'landscape' ? 848 : 600;
    const pageHeight = page.orientation === 'landscape' ? 600 : 848;

    const initCanvas = new fabric.Canvas(canvasRef.current, {
      width: pageWidth,
      height: pageHeight,
      backgroundColor: '#ffffff',
      preserveObjectStacking: true,
      selection: true,
      enableRetinaScaling: true,
      allowTouchScrolling: true,
    });

    // Editor-style behaviour settings. These are mutable from the right sidebar.
    initCanvas.snapEnabled = true;
    initCanvas.boundaryLock = true;
    initCanvas.angleSnapEnabled = true;
    initCanvas.angleSnapStep = 15;
    initCanvas.snapThreshold = 7;
    initCanvas._isCropping = false;
    initCanvas.targetFindTolerance = 10;
    initCanvas.perPixelTargetFind = false;
    const setCanvasTouchMode = (selected = false) => {
      const touchAction = selected ? 'none' : 'auto';
      initCanvas.upperCanvasEl.style.touchAction = touchAction;
      initCanvas.lowerCanvasEl.style.touchAction = touchAction;
      initCanvas.wrapperEl.style.touchAction = touchAction;
    };
    setCanvasTouchMode(false);

    // On phones, normal finger movement should scroll the page.
    // An object only becomes draggable after a deliberate 800ms hold.
    const touchState = { timer: null, target: null, startX: 0, startY: 0, lastX: 0, lastY: 0, dragging: false };
    const clearTouchHold = () => {
      if (touchState.timer) window.clearTimeout(touchState.timer);
      touchState.timer = null;
    };
    const getTouchPoint = (e) => e.touches?.[0] || e.changedTouches?.[0];

    const onTouchStart = (e) => {
      if (initCanvas._isCropping || e.touches.length !== 1) return;

      // Touch gestures are handled here so Fabric never creates a marquee-selection box.
      initCanvas.selection = false;
      const point = getTouchPoint(e);
      const target = initCanvas.findTarget(e);

      // Do not preventDefault: blank-page swipes must remain native page scrolling.
      e.stopImmediatePropagation();

      if (!point || !target || target.isGuide || target.cropEditor) {
        clearTouchHold();
        touchState.target = null;
        touchState.dragging = false;
        setCanvasTouchMode(false);
        return;
      }

      touchState.target = target;
      touchState.startX = touchState.lastX = point.clientX;
      touchState.startY = touchState.lastY = point.clientY;
      touchState.dragging = false;
      clearTouchHold();

      touchState.timer = window.setTimeout(() => {
        if (!touchState.target) return;
        touchState.dragging = true;
        initCanvas.setActiveObject(touchState.target);
        onSetActive(initCanvas, touchState.target, page.id);
        setCanvasTouchMode(true);
        initCanvas.renderAll();
      }, 800);
    };

    const onTouchMove = (e) => {
      if (e.touches.length !== 1) return;
      const point = getTouchPoint(e);
      if (!point) return;

      if (!touchState.target || !touchState.dragging) {
        // Before the hold completes, the browser is free to scroll the workspace.
        if (touchState.target && Math.hypot(point.clientX - touchState.startX, point.clientY - touchState.startY) > 8) {
          clearTouchHold();
          touchState.target = null;
        }
        return;
      }

      e.stopImmediatePropagation();
      e.preventDefault();

      const dx = point.clientX - touchState.lastX;
      const dy = point.clientY - touchState.lastY;
      touchState.lastX = point.clientX;
      touchState.lastY = point.clientY;

      if (!touchState.target.lockMovementX) touchState.target.left += dx / pageScale;
      if (!touchState.target.lockMovementY) touchState.target.top += dy / pageScale;
      touchState.target.setCoords();
      initCanvas.constrainActiveObject?.(touchState.target);
      initCanvas.renderAll();
    };

    const onTouchEnd = (e) => {
      e.stopImmediatePropagation();
      clearTouchHold();
      if (touchState.dragging && touchState.target) {
        initCanvas.fire('object:modified', { target: touchState.target });
      }
      touchState.target = null;
      touchState.dragging = false;
      setCanvasTouchMode(false);
      initCanvas.renderAll();
    };

    initCanvas.upperCanvasEl.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    initCanvas.upperCanvasEl.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    initCanvas.upperCanvasEl.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
    initCanvas.upperCanvasEl.addEventListener('touchcancel', onTouchEnd, { capture: true, passive: true });
    initCanvas.upperCanvasEl.addEventListener('mousedown', () => {
      initCanvas.selection = true;
      setCanvasTouchMode(!!initCanvas.getActiveObject());
    }, { capture: true });

    registerCanvas(page.id, initCanvas);

    initCanvas.history = [];
    initCanvas.redoStack = [];

    const saveHistory = (event) => {
      const target = event?.target;
      if (
        initCanvas._isRestoring ||
        initCanvas._isCropping ||
        target?.isGuide ||
        target?.cropEditor
      ) return;

      initCanvas.history.push(initCanvas.toJSON());
      initCanvas.redoStack = [];
      onSetActive(initCanvas, initCanvas.getActiveObject(), page.id);
    };

    initCanvas.on('object:modified', saveHistory);
    initCanvas.on('object:added', (e) => {
      if (e.target && !e.target.cropEditor) configureRotationControl(e.target);
      saveHistory(e);
    });
    initCanvas.history.push(initCanvas.toJSON());

    initCanvas.undo = () => {
      if (initCanvas.history.length <= 1 || initCanvas._isCropping) return;
      initCanvas._isRestoring = true;
      initCanvas.redoStack.push(initCanvas.history.pop());
      initCanvas.loadFromJSON(initCanvas.history[initCanvas.history.length - 1], () => {
        initCanvas.renderAll();
        initCanvas._isRestoring = false;
        onSetActive(initCanvas, initCanvas.getActiveObject(), page.id);
      });
    };

    initCanvas.redo = () => {
      if (initCanvas.redoStack.length === 0 || initCanvas._isCropping) return;
      initCanvas._isRestoring = true;
      const targetState = initCanvas.redoStack.pop();
      initCanvas.history.push(targetState);
      initCanvas.loadFromJSON(targetState, () => {
        initCanvas.renderAll();
        initCanvas._isRestoring = false;
        onSetActive(initCanvas, initCanvas.getActiveObject(), page.id);
      });
    };

    // ------------------------------------------
    // Editor-style SNAP / BOUNDARY ENGINE
    // ------------------------------------------
    const guides = [];

    const clearGuides = () => {
      guides.forEach((line) => initCanvas.remove(line));
      guides.length = 0;
    };

    const addVGuide = (x) => {
      if (guides.some((g) => g.isGuide && g.x1 === x)) return;
      const line = new fabric.Line([x, 0, x, initCanvas.height], {
        stroke: '#00c3ff',
        strokeWidth: 1,
        strokeDashArray: [5, 5],
        selectable: false,
        evented: false,
        excludeFromExport: true,
        isGuide: true,
        x1: x,
      });
      initCanvas.add(line);
      guides.push(line);
    };

    const addHGuide = (y) => {
      if (guides.some((g) => g.isGuide && g.y1 === y)) return;
      const line = new fabric.Line([0, y, initCanvas.width, y], {
        stroke: '#00c3ff',
        strokeWidth: 1,
        strokeDashArray: [5, 5],
        selectable: false,
        evented: false,
        excludeFromExport: true,
        isGuide: true,
        y1: y,
      });
      initCanvas.add(line);
      guides.push(line);
    };

    const constrainToPage = (obj) => {
      if (!obj || obj.isGuide || obj.cropEditor) return;

      const rect = obj.getBoundingRect();
      let dx = 0;
      let dy = 0;
      const threshold = initCanvas.snapThreshold;

      // Hard boundary lock first.
      if (initCanvas.boundaryLock) {
        if (rect.left < 0) dx = -rect.left;
        if (rect.right > initCanvas.width) dx = initCanvas.width - rect.right;
        if (rect.top < 0) dy = -rect.top;
        if (rect.bottom > initCanvas.height) dy = initCanvas.height - rect.bottom;
      }

      if (initCanvas.snapEnabled) {
        // Canvas edges — these naturally include corner snapping when both axes match.
        if (Math.abs(rect.left) <= threshold) {
          dx = -rect.left;
          addVGuide(0);
        } else if (Math.abs(rect.right - initCanvas.width) <= threshold) {
          dx = initCanvas.width - rect.right;
          addVGuide(initCanvas.width);
        }

        if (Math.abs(rect.top) <= threshold) {
          dy = -rect.top;
          addHGuide(0);
        } else if (Math.abs(rect.bottom - initCanvas.height) <= threshold) {
          dy = initCanvas.height - rect.bottom;
          addHGuide(initCanvas.height);
        }

        const center = getObjectCenter(obj);
        if (Math.abs(center.x - initCanvas.width / 2) <= threshold) {
          dx = initCanvas.width / 2 - center.x;
          addVGuide(initCanvas.width / 2);
        }
        if (Math.abs(center.y - initCanvas.height / 2) <= threshold) {
          dy = initCanvas.height / 2 - center.y;
          addHGuide(initCanvas.height / 2);
        }

        // Snap object center to page corners too, but only when close enough.
        const corners = [
          [0, 0],
          [initCanvas.width, 0],
          [0, initCanvas.height],
          [initCanvas.width, initCanvas.height],
        ];
        for (const [cx, cy] of corners) {
          const dist = Math.hypot(center.x - cx, center.y - cy);
          if (dist <= threshold * 1.7) {
            dx = cx - center.x;
            dy = cy - center.y;
            addVGuide(cx);
            addHGuide(cy);
            break;
          }
        }
      }

      if (dx || dy) obj.left += dx, obj.top += dy;
      obj.setCoords();
    };

    initCanvas.on('before:transform', (e) => {
      const transform = e.transform;
      const obj = transform?.target;
      if (!obj || obj.cropEditor) return;
      if (/^scale/.test(transform.action || '')) {
        if (!obj._scaleGestureCenter) obj._scaleGestureCenter = obj.getCenterPoint();
      }
    });

    initCanvas.on('object:moving', (e) => {
      const obj = e.target;
      if (!obj || obj.cropEditor) return;
      clearGuides();
      constrainToPage(obj);
      initCanvas.renderAll();
    });

    initCanvas.on('object:scaling', (e) => {
      const obj = e.target;
      if (!obj || obj.cropEditor) return;

      // Keep proportional images proportional without touching their size while moving.
      if (obj.type === 'image' && obj.lockUniScaling !== false) {
        const uniform = Math.max(Math.abs(obj.scaleX || 1), Math.abs(obj.scaleY || 1));
        obj.set({
          scaleX: Math.sign(obj.scaleX || 1) * uniform,
          scaleY: Math.sign(obj.scaleY || 1) * uniform,
        });
      }

      // Clamp an oversized scale once against the page bounds. Do not use a
      // repeated 0.985 multiplier: that compounds on every pointer event and
      // makes an image appear to randomly shrink during a drag.
      if (initCanvas.boundaryLock) {
        const rect = obj.getBoundingRect();
        const factor = Math.min(
          1,
          rect.width > initCanvas.width ? initCanvas.width / rect.width : 1,
          rect.height > initCanvas.height ? initCanvas.height / rect.height : 1
        );
        if (factor < 1) {
          obj.scaleX *= factor;
          obj.scaleY *= factor;
          obj.setCoords();
        }
      }

      if (obj._scaleGestureCenter) {
        obj.setPositionByOrigin(obj._scaleGestureCenter, 'center', 'center');
        obj.setCoords();
      }
      clearGuides();
      // Keep the gesture center fixed throughout the complete pointer gesture.
      // Boundary clamping above handles oversized objects without introducing
      // a second position correction on every pointer event.
      obj.setCoords();
      initCanvas.renderAll();
    });

    initCanvas.on('object:modified', (e) => {
      if (e.target?._scaleGestureCenter) e.target._scaleGestureCenter = null;
    });

    initCanvas.on('object:rotating', (e) => {
      const obj = e.target;
      if (!obj || obj.cropEditor) return;

      const step = initCanvas.angleSnapStep || 15;
      const threshold = 4;
      const angle = ((obj.angle || 0) % 360 + 360) % 360;
      const snapped = Math.round(angle / step) * step;
      let delta = Math.abs(angle - snapped);
      delta = Math.min(delta, 360 - delta);

      if (initCanvas.angleSnapEnabled && delta <= threshold) {
        obj.set('angle', snapped === 360 ? 0 : snapped);
      }
      initCanvas.renderAll();
    });

    initCanvas.constrainActiveObject = (obj) => {
      if (!obj) return;
      // Moving must never alter scale. Boundary enforcement here is position-only.
      clearGuides();
      constrainToPage(obj);
      obj.setCoords();
    };

    initCanvas.on('mouse:up', () => {
      clearGuides();
      const active = initCanvas.getActiveObject();
      if (active?._scaleGestureCenter) active._scaleGestureCenter = null;
      initCanvas.renderAll();
    });

    initCanvas.on('selection:created', (e) => {
      setCanvasTouchMode(true);
      onSetActive(initCanvas, e.selected?.[0], page.id);
    });
    initCanvas.on('selection:updated', (e) => {
      setCanvasTouchMode(true);
      onSetActive(initCanvas, e.selected?.[0], page.id);
    });
    initCanvas.on('selection:cleared', () => {
      setCanvasTouchMode(false);
      onSetActive(initCanvas, null, page.id);
    });

    initCanvas.on('mouse:down', (event) => {
      if (!event.target && !initCanvas._isCropping) {
        initCanvas.discardActiveObject();
        initCanvas.renderAll();
        onSetActive(initCanvas, null, page.id);
      }
    });

    if (page.initialImage) {
      fabric.Image.fromURL(page.initialImage, (img) => {
        if (!canvasRef.current || !img) return;
        const scale = Math.min((pageWidth - 60) / img.width, (pageHeight - 60) / img.height);
        img.set({
          left: pageWidth / 2,
          top: pageHeight / 2,
          originX: 'center',
          originY: 'center',
          scaleX: scale,
          scaleY: scale,
          lockUniScaling: true,
          centeredScaling: true,
        });
        initCanvas.add(img);
        initCanvas.renderAll();
        initCanvas.history[0] = initCanvas.toJSON();
      });
    }

    setCanvas(initCanvas);
    return () => {
      clearTouchHold();
      initCanvas.upperCanvasEl?.removeEventListener('touchstart', onTouchStart, true);
      initCanvas.upperCanvasEl?.removeEventListener('touchmove', onTouchMove, true);
      initCanvas.upperCanvasEl?.removeEventListener('touchend', onTouchEnd, true);
      initCanvas.upperCanvasEl?.removeEventListener('touchcancel', onTouchEnd, true);
      initCanvas.dispose();
    };
  }, [page.id, page.initialImage, page.orientation]);

  useEffect(() => {
    const updatePageScale = () => {
      const pageWidth = page.orientation === 'landscape' ? 848 : 600;
      const availableWidth = Math.max(240, Math.min(540, window.innerWidth - 48));
      setPageScale(availableWidth / pageWidth);
    };
    updatePageScale();
    window.addEventListener('resize', updatePageScale);
    window.visualViewport?.addEventListener('resize', updatePageScale);
    return () => { window.removeEventListener('resize', updatePageScale); window.visualViewport?.removeEventListener('resize', updatePageScale); };
  }, [page.orientation]);

  const handleLocalLayerAdd = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !canvas) return;

    const dataUrl = await readFileAsDataURL(file);
    fabric.Image.fromURL(dataUrl, (img) => {
      const scale = Math.min(300 / img.width, 300 / img.height);
      img.set({
        left: canvas.width / 2,
        top: canvas.height / 2,
        originX: 'center',
        originY: 'center',
        scaleX: scale,
        scaleY: scale,
        lockUniScaling: true,
        centeredScaling: true,
      });
      canvas.add(img);
      canvas.setActiveObject(img);
      canvas.renderAll();
    });
  };

  useEffect(() => {
    if (!canvas) return;
    const cssWidth = 600 * pageScale;
    const cssHeight = 848 * pageScale;

    // Keep Fabric's wrapper and both drawing layers in the same scaled A4 box.
    // Otherwise the wrapper can retain the old 600x848 size and shift/crop the page on phones.
    canvas.setDimensions({ width: cssWidth, height: cssHeight }, { cssOnly: true });
    if (canvas.wrapperEl) {
      canvas.wrapperEl.style.width = cssWidth + 'px';
      canvas.wrapperEl.style.height = cssHeight + 'px';
      canvas.wrapperEl.style.maxWidth = '100%';
      canvas.wrapperEl.style.marginLeft = 'auto';
      canvas.wrapperEl.style.marginRight = 'auto';
    }
    if (canvas.upperCanvasEl) {
      canvas.upperCanvasEl.style.width = cssWidth + 'px';
      canvas.upperCanvasEl.style.height = cssHeight + 'px';
    }
    if (canvas.lowerCanvasEl) {
      canvas.lowerCanvasEl.style.width = cssWidth + 'px';
      canvas.lowerCanvasEl.style.height = cssHeight + 'px';
    }
    canvas.calcOffset();
    canvas.renderAll();
  }, [canvas, pageScale]);

  const isActivePage = activeCanvasId === page.id;

  return (
    <div
      draggable={isDraggable}
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragEnd={onDragEnd}
      onDragOver={(e) => e.preventDefault()}
      className={`flex flex-col items-center mb-12 transition-all ${isActivePage ? 'scale-[1.02]' : 'scale-100 opacity-90 hover:opacity-100'}`}
    >
      <div
        className="page-toolbar w-full max-w-[600px] flex justify-between items-center mb-3 px-1 sm:px-2 text-neutral-400 cursor-grab active:cursor-grabbing"
        onMouseEnter={() => setIsDraggable(true)}
        onMouseLeave={() => setIsDraggable(false)}
      >
        <div className="flex items-center gap-2 hover:text-white transition-colors">
          <GripHorizontal size={18} />
          <span className="font-bold text-sm tracking-widest uppercase">Page {pageIndex + 1}</span>
        </div>
        <div className="flex gap-2 items-center" onMouseEnter={() => setIsDraggable(false)}>
          <button
            onClick={() => toggleOrientation(page.id)}
            className="flex items-center gap-1.5 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 text-xs font-semibold px-2.5 py-1.5 rounded transition-colors border border-neutral-800"
            title={page.orientation === 'landscape' ? 'Switch to portrait' : 'Switch to landscape'}
          >
            <Ratio size={14} /> {page.orientation === 'landscape' ? 'Portrait' : 'Landscape'}
          </button>
          <label className="flex items-center gap-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-xs font-semibold px-3 py-1.5 rounded cursor-pointer transition-colors mr-3 border border-blue-500/20">
            <Plus size={14} /> Add Layer
            <input type="file" accept="image/*" className="hidden" onChange={handleLocalLayerAdd} />
          </label>
          <button onClick={() => moveUp(page.id)} disabled={pageIndex === 0} className="p-1.5 hover:bg-neutral-800 rounded disabled:opacity-30"><MoveUp size={16} /></button>
          <button onClick={() => moveDown(page.id)} disabled={pageIndex === totalPages - 1} className="p-1.5 hover:bg-neutral-800 rounded disabled:opacity-30"><MoveDown size={16} /></button>
          <button onClick={() => deletePage(page.id)} className="p-1.5 hover:bg-red-500/20 text-red-500 rounded ml-2"><Trash2 size={16} /></button>
        </div>
      </div>
      <div
        className="shadow-2xl transition-all ring-1 ring-neutral-800"
        style={{
          width: (page.orientation === 'landscape' ? 848 : 600) * pageScale,
          height: (page.orientation === 'landscape' ? 600 : 848) * pageScale,
        }}
      >
        <canvas ref={canvasRef} className="select-none" style={{ display: 'block' }} />
      </div>
    </div>
  );
};

// ==========================================
// MAIN APPLICATION
// ==========================================
export default function App() {
  const [appMode, setAppMode] = useState(null);

  const [pages, setPages] = useState([{ id: Date.now(), initialImage: null, orientation: 'portrait' }]);
  const canvasRefs = useRef({});
  const [activeCanvas, setActiveCanvas] = useState(null);
  const [activeCanvasId, setActiveCanvasId] = useState(null);
  const [activeObject, setActiveObject] = useState(null);
  const [historyTrigger, setHistoryTrigger] = useState(0);

  const [autoFitImages, setAutoFitImages] = useState([]);
  const [pdfImages, setPdfImages] = useState([]);
  const [pdfExportFormat, setPdfExportFormat] = useState('image/png');
  const [isPdfConverting, setIsPdfConverting] = useState(false);
  const [mergeFiles, setMergeFiles] = useState([]);
  const [isMergeBusy, setIsMergeBusy] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [fileName, setFileName] = useState(`BPDF_${Math.floor(Date.now() / 1000)}`);

  const modeOptions = [
    { id: 'customisable', label: 'Customisable', description: 'Place, crop, resize and arrange images on editable A4 pages.', Icon: LayoutTemplate, accent: 'blue' },
    { id: 'autofit', label: 'Auto-Fit', description: 'Turn images into clean portrait or landscape PDF pages automatically.', Icon: Maximize, accent: 'emerald' },
    { id: 'pdf2img', label: 'PDF → Img', description: 'Extract every PDF page as a high-quality image.', Icon: ImageIcon, accent: 'purple' },
    { id: 'merge', label: 'Merge PDFs', description: 'Arrange PDF files and combine them into one document.', Icon: FilePlus2, accent: 'orange' },
  ];

  const goToModes = () => {
    Object.values(canvasRefs.current).forEach((cvs) => {
      if (cvs) { cvs.discardActiveObject(); cvs.renderAll(); }
    });
    setActiveCanvas(null);
    setActiveObject(null);
    setActiveCanvasId(null);
    setCropSession(null);
    cropSessionRef.current = null;
    setMobileToolsOpen(false);
    setAppMode(null);
  };

  // Crop editor state.
  const [cropSession, setCropSession] = useState(null);
  const cropSessionRef = useRef(null);
  const [cropRatio, setCropRatio] = useState('free');

  const dragItem = useRef(null);
  const dragOverItem = useRef(null);

  // Keep callbacks stable enough for child canvas effects.
  const setActiveFromCanvas = (canvasObj, obj, pageId) => {
    // During crop mode, the Fabric crop rectangle is an editor, not the selected layer.
    if (obj?.cropEditor && cropSessionRef.current) {
      setActiveCanvas(canvasObj);
      setActiveObject(cropSessionRef.current.image);
      setActiveCanvasId(pageId);
      return;
    }
    setActiveCanvas(canvasObj);
    setActiveObject(obj);
    setActiveCanvasId(pageId);
    setHistoryTrigger((prev) => prev + 1);
  };

  const registerCanvas = (id, canvas) => {
    canvasRefs.current[id] = canvas;
  };

  // --- SILENT FILE DRAG & DROP ---
  const isFileDrag = (event) => {
    try {
      return Array.from(event?.dataTransfer?.types || []).includes('Files');
    } catch {
      return false;
    }
  };

  const handleSectionDragOver = (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  };

  const handleSectionDrop = async (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) return;

    if (appMode === 'customisable') {
      const imageFiles = files.filter((file) => /^(image\/)/i.test(file.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name));
      if (imageFiles.length) await handleCustomImport({ target: { files: imageFiles, value: '' } });
      return;
    }

    if (appMode === 'autofit') {
      const imageFiles = files.filter((file) => /^(image\/)/i.test(file.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name));
      if (imageFiles.length) await handleAutoFitImport({ target: { files: imageFiles, value: '' } });
      return;
    }

    if (appMode === 'pdf2img') {
      const pdfFile = files.find((file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name));
      if (pdfFile && !isPdfConverting) await handlePdfToImageUpload({ target: { files: [pdfFile], value: '' } });
      return;
    }

    if (appMode === 'merge') {
      const pdfFiles = files.filter((file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name));
      if (pdfFiles.length && !isMergeBusy) await handleMergeUpload({ target: { files: pdfFiles, value: '' } });
    }
  };

  // --- KEYBOARD CONTROLS ---
  useEffect(() => {
    if (appMode !== 'customisable') return;

    const handleKeyDown = (e) => {
      if (e.target?.tagName?.toLowerCase() === 'input') return;
      if (cropSessionRef.current) {
        if (e.key === 'Escape') {
          e.preventDefault();
          cancelCrop();
        }
        return;
      }
      if (!activeCanvas) return;

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        if (activeObject) {
          const step = e.shiftKey ? 10 : 1;
          const isHorizontal = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
          const isVertical = e.key === 'ArrowUp' || e.key === 'ArrowDown';
          const canMove = (isHorizontal && !activeObject.lockMovementX) || (isVertical && !activeObject.lockMovementY);

          if (canMove) {
            e.preventDefault();
            if (e.key === 'ArrowUp' && !activeObject.lockMovementY) activeObject.top -= step;
            if (e.key === 'ArrowDown' && !activeObject.lockMovementY) activeObject.top += step;
            if (e.key === 'ArrowLeft' && !activeObject.lockMovementX) activeObject.left -= step;
            if (e.key === 'ArrowRight' && !activeObject.lockMovementX) activeObject.left += step;
            activeObject.setCoords();
            activeCanvas.constrainActiveObject?.(activeObject);
            activeCanvas.renderAll();
          }
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        activeCanvas.undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        activeCanvas.redo();
      }
      if (e.key === 'Delete' && activeObject && !activeObject.lockMovementX) deleteSelected();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && activeObject) {
        e.preventDefault();
        duplicateSelected();
      }
    };

    const handleKeyUp = (e) => {
      if (e.target?.tagName?.toLowerCase() === 'input') return;
      if (
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) &&
        activeCanvas &&
        activeObject &&
        (!activeObject.lockMovementX || !activeObject.lockMovementY)
      ) {
        activeCanvas.fire('object:modified', { target: activeObject });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [activeCanvas, activeObject, appMode]);

  const handleWorkspaceClick = (e) => {
    if (cropSessionRef.current) return;

    const target = e.target;
    if (target?.closest?.('button, input, label, .page-toolbar')) return;

    const isFabricSurface =
      target?.classList?.contains?.('upper-canvas') ||
      target?.classList?.contains?.('lower-canvas') ||
      target?.closest?.('.canvas-container');

    if (isFabricSurface) return;

    Object.values(canvasRefs.current).forEach((cvs) => {
      if (cvs) {
        cvs.discardActiveObject();
        cvs.renderAll();
      }
    });
    setActiveCanvas(null);
    setActiveObject(null);
    setActiveCanvasId(null);
  };

  // --- IMPORTING ---
  const handleCustomImport = async (e) => {
    const files = Array.from(e.target.files);
    e.target.value = '';
    if (!files.length) return;

    const newPages = await Promise.all(files.map(async (file, i) => {
      const dataUrl = await readFileAsDataURL(file);
      return { id: `${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}`, initialImage: dataUrl, orientation: 'portrait' };
    }));

    setPages((prev) => {
      const firstCanvas = canvasRefs.current[prev[0].id];
      if (prev.length === 1 && firstCanvas && firstCanvas.getObjects().length === 0) return [...newPages];
      return [...prev, ...newPages];
    });
  };

  const handleAutoFitImport = async (e) => {
    const files = Array.from(e.target.files);
    e.target.value = '';
    if (!files.length) return;

    const newImages = await Promise.all(files.map(async (file, i) => {
      const src = await readFileAsDataURL(file);
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ id: `${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}`, src, width: img.width, height: img.height, hasMargin: false });
        img.src = src;
      });
    }));
    setAutoFitImages((prev) => [...prev, ...newImages]);
  };

  // --- PDF TO IMAGE PARSER ---
  const handlePdfToImageUpload = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name))) return alert('Please upload a valid PDF file.');

    setIsPdfConverting(true);
    setFileName(file.name.replace('.pdf', ''));

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const extracted = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;
        extracted.push({ id: Date.now() + i, pageNum: i, dataUrl: canvas.toDataURL('image/png') });
      }
      setPdfImages(extracted);
    } catch (err) {
      console.error('PDF Parsing Error: ', err);
      alert('Failed to extract images from this PDF.');
    }
    setIsPdfConverting(false);
  };

  const downloadPdfImage = (dataUrl, pageNum) => {
    const extension = pdfExportFormat === 'image/jpeg' ? 'jpg' : 'png';
    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');

      if (pdfExportFormat === 'image/jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0);

      const link = document.createElement('a');
      link.href = canvas.toDataURL(pdfExportFormat, 0.95);
      link.download = `${fileName}_Page_${pageNum}.${extension}`;
      link.click();
    };
    img.src = dataUrl;
  };

  const downloadAllPdfImages = () => {
    if (pdfImages.length === 0) return alert('No images to download.');
    pdfImages.forEach((img, idx) => {
      setTimeout(() => downloadPdfImage(img.dataUrl, img.pageNum), idx * 400);
    });
  };

  // --- PDF MERGER ---
  const handleMergeUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setIsMergeBusy(true);
    try {
      const incoming = [];
      for (const file of files) {
        if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) continue;
        const bytes = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
        let preview = null;
        if (pdf.numPages > 0) {
          const page = await pdf.getPage(1);
          const viewport = page.getViewport({ scale: 0.28 });
          const previewCanvas = document.createElement('canvas');
          previewCanvas.width = Math.max(1, Math.ceil(viewport.width));
          previewCanvas.height = Math.max(1, Math.ceil(viewport.height));
          await page.render({ canvasContext: previewCanvas.getContext('2d', { alpha: false }), viewport }).promise;
          preview = previewCanvas.toDataURL('image/jpeg', 0.82);
        }
        incoming.push({ id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, name: file.name, size: file.size, bytes, pageCount: pdf.numPages, preview });
        try { pdf.destroy(); } catch {}
      }
      if (!incoming.length) return alert('Please choose PDF files.');
      setMergeFiles((prev) => [...prev, ...incoming]);
      setFileName(files.length === 1 ? `${files[0].name.replace(/\.pdf$/i, '')}_Combined` : 'Combined_PDF');
    } catch (err) {
      console.error('PDF merge import error:', err);
      alert('One of those PDF files could not be read.');
    } finally {
      setIsMergeBusy(false);
    }
  };

  const removeMergeFile = (id) => setMergeFiles((prev) => prev.filter((file) => file.id !== id));
  const clearMergeFiles = () => setMergeFiles([]);
  const moveMergeFile = (index, direction) => {
    setMergeFiles((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (index < 0 || target < 0 || target >= next.length) return next;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };
  const reorderMergeFiles = (from, to) => {
    if (from == null || to == null || from === to) return;
    setMergeFiles((prev) => {
      if (from < 0 || from >= prev.length || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const item = next.splice(from, 1)[0];
      next.splice(to, 0, item);
      return next;
    });
  };
  const totalMergePages = mergeFiles.reduce((sum, file) => sum + file.pageCount, 0);

  const combinePDFs = async () => {
    if (mergeFiles.length < 2) return alert('Add at least two PDF files to combine.');
    setIsMergeBusy(true);
    try {
      const merged = await PDFDocument.create();
      for (const file of mergeFiles) {
        const source = await PDFDocument.load(file.bytes);
        const copiedPages = await merged.copyPages(source, source.getPageIndices());
        copiedPages.forEach((page) => merged.addPage(page));
      }
      const outputName = safeFileName(fileName, 'Combined_PDF');
      merged.setTitle(outputName);
      merged.setProducer('BareenaPDFs');
      const output = await merged.save({ useObjectStreams: true, addDefaultPage: false });
      const blob = new Blob([output], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${outputName}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error('PDF merge error:', err);
      alert('Could not combine these PDFs. A protected or malformed PDF may be the cause.');
    } finally {
      setIsMergeBusy(false);
    }
  };

  // --- DRAG & DROP LOGIC ---
  const handleSortPages = () => {
    if (dragItem.current !== null && dragOverItem.current !== null && dragItem.current !== dragOverItem.current) {
      const _pages = [...pages];
      const draggedItem = _pages.splice(dragItem.current, 1)[0];
      _pages.splice(dragOverItem.current, 0, draggedItem);
      setPages(_pages);
    }
    dragItem.current = null;
    dragOverItem.current = null;
  };

  const handleSortAutoFit = () => {
    if (dragItem.current !== null && dragOverItem.current !== null && dragItem.current !== dragOverItem.current) {
      const _images = [...autoFitImages];
      const draggedItem = _images.splice(dragItem.current, 1)[0];
      _images.splice(dragOverItem.current, 0, draggedItem);
      setAutoFitImages(_images);
    }
    dragItem.current = null;
    dragOverItem.current = null;
  };

  // --- CUSTOMISABLE LOGIC ---
  const addBlankPage = () => setPages((prev) => [...prev, { id: Date.now(), initialImage: null, orientation: 'portrait' }]);

  const toggleOrientation = (id) => {
    setPages((prev) => prev.map((page) => (
      page.id === id
        ? { ...page, orientation: page.orientation === 'landscape' ? 'portrait' : 'landscape' }
        : page
    )));
  };

  const deletePage = (id) => {
    if (pages.length === 1) return alert('You must have at least one page.');
    if (activeCanvasId === id) {
      setActiveCanvas(null);
      setActiveObject(null);
      setActiveCanvasId(null);
    }
    setPages((prev) => prev.filter((p) => p.id !== id));
    delete canvasRefs.current[id];
  };

  const movePageUp = (id) => {
    const idx = pages.findIndex((p) => p.id === id);
    if (idx > 0) {
      const newPages = [...pages];
      [newPages[idx - 1], newPages[idx]] = [newPages[idx], newPages[idx - 1]];
      setPages(newPages);
    }
  };

  const movePageDown = (id) => {
    const idx = pages.findIndex((p) => p.id === id);
    if (idx < pages.length - 1) {
      const newPages = [...pages];
      [newPages[idx + 1], newPages[idx]] = [newPages[idx], newPages[idx + 1]];
      setPages(newPages);
    }
  };

  const deleteAutoFitPage = (id) => setAutoFitImages((prev) => prev.filter((img) => img.id !== id));
  const toggleAutoFitMargin = (id) => setAutoFitImages((prev) => prev.map((img) => img.id === id ? { ...img, hasMargin: !img.hasMargin } : img));

  const handlePropertyChange = (property, value) => {
    if (!activeObject || !activeCanvas || activeObject.lockMovementX || cropSessionRef.current) return;
    const numVal = parseFloat(value);
    if (Number.isNaN(numVal)) return;

    if (property === 'width' && activeObject.width) {
      const scale = numVal / activeObject.width;
      activeObject.set({ scaleX: scale });
      if (activeObject.type === 'image' && activeObject.lockUniScaling !== false) activeObject.set({ scaleY: scale });
    }

    if (property === 'height' && activeObject.height) {
      const scale = numVal / activeObject.height;
      activeObject.set({ scaleY: scale });
      if (activeObject.type === 'image' && activeObject.lockUniScaling !== false) activeObject.set({ scaleX: scale });
    }

    if (property === 'angle') activeObject.set('angle', numVal);
    if (property === 'opacity') activeObject.set('opacity', clamp(numVal, 0, 100) / 100);
    if (property === 'left') activeObject.set('left', numVal);
    if (property === 'top') activeObject.set('top', numVal);

    activeObject.setCoords();
    activeCanvas.constrainActiveObject?.(activeObject);
    activeCanvas.renderAll();
    setHistoryTrigger((prev) => prev + 1);
  };

  const commitPropertyChange = () => {
    if (activeCanvas && activeObject && !cropSessionRef.current) {
      activeCanvas.fire('object:modified', { target: activeObject });
    }
  };

  const updateActive = (props) => {
    if (!activeObject || !activeCanvas || activeObject.lockMovementX || cropSessionRef.current) return;
    activeObject.set(props);
    activeObject.setCoords();
    activeCanvas.renderAll();
    activeCanvas.fire('object:modified', { target: activeObject });
    setActiveObject(activeCanvas.getActiveObject());
  };

  const deleteSelected = () => {
    if (cropSessionRef.current) return;
    if (activeObject && activeCanvas && !activeObject.lockMovementX) {
      activeCanvas.remove(activeObject);
      activeCanvas.discardActiveObject();
      activeCanvas.fire('object:modified', { target: activeObject });
      setActiveObject(null);
    }
  };

  const toggleLock = () => {
    if (!activeObject || !activeCanvas || cropSessionRef.current) return;
    const isLocked = activeObject.lockMovementX;
    activeObject.set({
      lockMovementX: !isLocked,
      lockMovementY: !isLocked,
      lockScalingX: !isLocked,
      lockScalingY: !isLocked,
      lockRotation: !isLocked,
      borderColor: !isLocked ? '#888888' : '#00c3ff',
      cornerColor: !isLocked ? '#888888' : '#ffffff',
      borderDashArray: !isLocked ? [6, 6] : [4, 4],
      hasControls: isLocked,
    });
    activeCanvas.renderAll();
    activeCanvas.fire('object:modified', { target: activeObject });
    setActiveObject(activeCanvas.getActiveObject());
  };

  const toggleAspectRatioLock = () => {
    if (!activeObject || activeObject.type !== 'image' || !activeCanvas || cropSessionRef.current) return;
    activeObject.set('lockUniScaling', activeObject.lockUniScaling === false);
    activeCanvas.renderAll();
    setActiveObject(activeCanvas.getActiveObject());
    setHistoryTrigger((prev) => prev + 1);
    activeCanvas.fire('object:modified', { target: activeObject });
  };

  const toggleCanvasSetting = (setting) => {
    if (!activeCanvas) return;
    activeCanvas[setting] = !activeCanvas[setting];
    setHistoryTrigger((prev) => prev + 1);
    activeCanvas.renderAll();
  };

  const alignActive = (mode) => {
    if (!activeObject || !activeCanvas || activeObject.lockMovementX || cropSessionRef.current) return;
    const rect = activeObject.getBoundingRect();
    const center = activeObject.getCenterPoint();
    let dx = 0;
    let dy = 0;

    if (mode === 'left') dx = -rect.left;
    if (mode === 'centerH') dx = activeCanvas.width / 2 - center.x;
    if (mode === 'right') dx = activeCanvas.width - rect.right;
    if (mode === 'top') dy = -rect.top;
    if (mode === 'centerV') dy = activeCanvas.height / 2 - center.y;
    if (mode === 'bottom') dy = activeCanvas.height - rect.bottom;

    activeObject.left += dx;
    activeObject.top += dy;
    activeObject.setCoords();
    activeCanvas.constrainActiveObject?.(activeObject);
    activeCanvas.renderAll();
    activeCanvas.fire('object:modified', { target: activeObject });
    setHistoryTrigger((prev) => prev + 1);
  };

  const duplicateSelected = () => {
    if (!activeObject || !activeCanvas || activeObject.lockMovementX || cropSessionRef.current) return;
    activeObject.clone((cloned) => {
      cloned.set({
        left: activeObject.left + 20,
        top: activeObject.top + 20,
        evented: true,
      });
      activeCanvas.add(cloned);
      activeCanvas.setActiveObject(cloned);
      activeCanvas.renderAll();
      activeCanvas.fire('object:modified', { target: cloned });
      setActiveObject(cloned);
    });
  };

  // Calculate the scale needed for an image to fit/fill the actual page.
  // The page is 600x848 canvas units, so there is intentionally no artificial
  // margin here. For rotated images, use their current rotated bounding box.
  const getPageScale = (obj, cvs, mode) => {
    if (!obj?.width || !obj?.height || !cvs) return 1;
    const angle = ((obj.angle || 0) * Math.PI) / 180;
    const baseW = Math.abs(obj.width * Math.cos(angle)) + Math.abs(obj.height * Math.sin(angle));
    const baseH = Math.abs(obj.width * Math.sin(angle)) + Math.abs(obj.height * Math.cos(angle));
    const ratioW = cvs.width / Math.max(0.0001, baseW);
    const ratioH = cvs.height / Math.max(0.0001, baseH);
    return mode === 'cover' ? Math.max(ratioW, ratioH) : Math.min(ratioW, ratioH);
  };

  const fitAllImages = (mode) => {
    if (cropSessionRef.current) return;
    let changed = false;

    Object.values(canvasRefs.current).forEach((cvs) => {
      if (!cvs) return;
      let canvasChanged = false;

      cvs.getObjects()
        .filter((obj) => obj.type === 'image' && !obj.cropEditor && !obj.lockMovementX)
        .forEach((obj) => {
          const scale = getPageScale(obj, cvs, mode);
          obj.set({
            scaleX: scale,
            scaleY: scale,
            left: cvs.width / 2,
            top: cvs.height / 2,
            centeredScaling: true,
          });
          obj.setCoords();
          canvasChanged = true;
          changed = true;
        });

      if (canvasChanged) cvs.fire('object:modified', { target: null });
      cvs.renderAll();
    });

    if (changed) setHistoryTrigger((prev) => prev + 1);
  };

  const rotateActive = (degrees) => {
    if (!activeObject || !activeCanvas || activeObject.lockMovementX || cropSessionRef.current) return;
    activeObject.set('angle', ((activeObject.angle || 0) + degrees + 360) % 360);
    activeObject.setCoords();
    activeCanvas.constrainActiveObject?.(activeObject);
    activeCanvas.renderAll();
    activeCanvas.fire('object:modified', { target: activeObject });
    setActiveObject(activeCanvas.getActiveObject());
  };

  const centerAndScaleActive = (mode) => {
    if (!activeObject || !activeCanvas || activeObject.lockMovementX || cropSessionRef.current) return;
    if (!activeObject.width || !activeObject.height) return;

    const scale = getPageScale(activeObject, activeCanvas, mode);
    activeObject.set({
      scaleX: scale,
      scaleY: scale,
      left: activeCanvas.width / 2,
      top: activeCanvas.height / 2,
      centeredScaling: true,
    });
    activeObject.setCoords();

    // Do not run snapping/boundary correction here: Fit and Fill are exact
    // page-layout commands and must leave the image centered on the page.
    activeCanvas.renderAll();
    activeCanvas.fire('object:modified', { target: activeObject });
    setHistoryTrigger((prev) => prev + 1);
  };

  // ------------------------------------------
  // CROP ENGINE
  // ------------------------------------------
  const updateCropClip = (session) => {
    if (!session?.image || !session.cropRect) return;

    const image = session.image;
    const cropRect = session.cropRect;
    const center = image.getCenterPoint();
    const cropCenter = cropRect.getCenterPoint();
    const deltaCanvas = { x: cropCenter.x - center.x, y: cropCenter.y - center.y };
    const deltaLocal = rotateVector(deltaCanvas.x, deltaCanvas.y, -(image.angle || 0));

    const absScaleX = Math.max(0.0001, Math.abs(image.scaleX || 1));
    const absScaleY = Math.max(0.0001, Math.abs(image.scaleY || 1));
    const clipW = cropRect.getScaledWidth() / absScaleX;
    const clipH = cropRect.getScaledHeight() / absScaleY;

    const clipPath = new fabric.Rect({
      width: clipW,
      height: clipH,
      left: deltaLocal.x / absScaleX,
      top: deltaLocal.y / absScaleY,
      originX: 'center',
      originY: 'center',
      absolutePositioned: false,
    });

    image.clipPath = clipPath;
    image.setCoords();
    session.canvas.renderAll();
  };

  const clampCropRect = (session) => {
    if (!session?.image || !session.cropRect) return;

    const image = session.image;
    const rect = session.cropRect;
    const imageW = Math.abs(image.getScaledWidth());
    const imageH = Math.abs(image.getScaledHeight());
    const rectW = Math.min(rect.getScaledWidth(), imageW);
    const rectH = Math.min(rect.getScaledHeight(), imageH);

    if (rect.getScaledWidth() !== rectW) rect.scaleX = rectW / rect.width;
    if (rect.getScaledHeight() !== rectH) rect.scaleY = rectH / rect.height;

    const imageCenter = image.getCenterPoint();
    const rectCenter = rect.getCenterPoint();
    const deltaCanvas = { x: rectCenter.x - imageCenter.x, y: rectCenter.y - imageCenter.y };
    const deltaLocal = rotateVector(deltaCanvas.x, deltaCanvas.y, -(image.angle || 0));

    const halfImageW = imageW / 2;
    const halfImageH = imageH / 2;
    const halfRectW = rectW / 2;
    const halfRectH = rectH / 2;

    const clampedLocal = {
      x: clamp(deltaLocal.x, -(halfImageW - halfRectW), halfImageW - halfRectW),
      y: clamp(deltaLocal.y, -(halfImageH - halfRectH), halfImageH - halfRectH),
    };

    const correctedCanvas = rotateVector(clampedLocal.x, clampedLocal.y, image.angle || 0);
    rect.setPositionByOrigin(
      new fabric.Point(imageCenter.x + correctedCanvas.x, imageCenter.y + correctedCanvas.y),
      'center',
      'center'
    );
    rect.setCoords();
    updateCropClip(session);
  };

  const startCrop = () => {
    if (!activeObject || !activeCanvas || activeObject.type !== 'image' || activeObject.lockMovementX) return;
    if (cropSessionRef.current) return;
    if (activeObject.clipPath) {
      alert('This image already has a crop. Apply the current crop before cropping it again.');
      return;
    }

    activeCanvas._isCropping = true;
    activeCanvas.discardActiveObject();

    const image = activeObject;
    const imageW = Math.abs(image.getScaledWidth());
    const imageH = Math.abs(image.getScaledHeight());
    // Start with the full image visible, like a normal crop tool.
    // Applying without moving/resizing therefore preserves the image unchanged.
    const startW = imageW;
    const startH = imageH;

    const cropRect = new fabric.Rect({
      left: image.left,
      top: image.top,
      width: Math.max(30, startW),
      height: Math.max(30, startH),
      originX: 'center',
      originY: 'center',
      angle: image.angle || 0,
      fill: 'rgba(0, 195, 255, 0.08)',
      stroke: '#00c3ff',
      strokeWidth: 2,
      strokeDashArray: [7, 5],
      transparentCorners: false,
      cornerColor: '#ffffff',
      cornerStrokeColor: '#00c3ff',
      cornerSize: 14,
      lockRotation: true,
      hasRotatingPoint: false,
      excludeFromExport: true,
      cropEditor: true,
    });

    const session = { canvas: activeCanvas, image, cropRect, originalClipPath: null };
    cropSessionRef.current = session;
    setCropSession(session);
    setCropRatio('free');
    setMobileToolsOpen(false);

    image.selectable = false;
    image.evented = false;

    activeCanvas.add(cropRect);
    activeCanvas.setActiveObject(cropRect);
    cropRect.on('moving', () => clampCropRect(session));
    cropRect.on('scaling', () => clampCropRect(session));
    updateCropClip(session);
    activeCanvas.renderAll();
  };

  const cancelCrop = () => {
    const session = cropSessionRef.current;
    if (!session) return;

    session.image.clipPath = session.originalClipPath;
    session.image.selectable = true;
    session.image.evented = true;
    session.canvas.remove(session.cropRect);
    session.canvas.discardActiveObject();
    session.canvas._isCropping = false;
    session.canvas.setActiveObject(session.image);
    session.canvas.renderAll();

    cropSessionRef.current = null;
    setCropSession(null);
    setActiveObject(session.image);
  };

  const applyCrop = () => {
    const session = cropSessionRef.current;
    if (!session) return;

    const image = session.image;
    const rect = session.cropRect;
    const canvas = session.canvas;

    const imageCenter = image.getCenterPoint();
    const cropCenter = rect.getCenterPoint();
    const deltaCanvas = { x: cropCenter.x - imageCenter.x, y: cropCenter.y - imageCenter.y };
    const deltaLocal = rotateVector(deltaCanvas.x, deltaCanvas.y, -(image.angle || 0));

    const absScaleX = Math.max(0.0001, Math.abs(image.scaleX || 1));
    const absScaleY = Math.max(0.0001, Math.abs(image.scaleY || 1));
    const cropW = rect.getScaledWidth() / absScaleX;
    const cropH = rect.getScaledHeight() / absScaleY;

    // cropX/cropY are source-image coordinates. Work relative to the currently visible image area.
    const currentVisibleCenterX = image.width / 2;
    const currentVisibleCenterY = image.height / 2;
    const cropCenterX = currentVisibleCenterX + (deltaLocal.x / absScaleX) * (image.flipX ? -1 : 1);
    const cropCenterY = currentVisibleCenterY + (deltaLocal.y / absScaleY) * (image.flipY ? -1 : 1);

    const cropLeftInVisible = cropCenterX - cropW / 2;
    const cropTopInVisible = cropCenterY - cropH / 2;

    const newCropX = (image.cropX || 0) + cropLeftInVisible;
    const newCropY = (image.cropY || 0) + cropTopInVisible;

    image.set({
      left: cropCenter.x,
      top: cropCenter.y,
      width: cropW,
      height: cropH,
      cropX: Math.max(0, newCropX),
      cropY: Math.max(0, newCropY),
      clipPath: null,
      selectable: true,
      evented: true,
      lockUniScaling: true,
    });

    // Re-enable normal editor state.
    canvas.remove(rect);
    canvas._isCropping = false;
    canvas.setActiveObject(image);
    image.setCoords();
    canvas.renderAll();
    canvas.fire('object:modified', { target: image });

    cropSessionRef.current = null;
    setCropSession(null);
    setActiveObject(image);
    setActiveCanvas(canvas);
  };

  const setCropAspectRatio = (ratio) => {
    setCropRatio(ratio);
    const session = cropSessionRef.current;
    if (!session || ratio === 'free') return;

    const numericRatio = ratio === '1:1' ? 1 : ratio === '4:5' ? 4 / 5 : 16 / 9;
    const imageW = Math.abs(session.image.getScaledWidth());
    const imageH = Math.abs(session.image.getScaledHeight());
    const currentW = session.cropRect.getScaledWidth();
    const currentH = session.cropRect.getScaledHeight();

    let targetW = currentW;
    let targetH = targetW / numericRatio;
    if (targetH > imageH * 0.95) {
      targetH = imageH * 0.95;
      targetW = targetH * numericRatio;
    }
    if (targetW > imageW * 0.95) {
      targetW = imageW * 0.95;
      targetH = targetW / numericRatio;
    }

    session.cropRect.scaleX = targetW / session.cropRect.width;
    session.cropRect.scaleY = targetH / session.cropRect.height;
    clampCropRect(session);
  };

  // --- EXPORTERS ---
  const exportCustomPDF = () => {
    if (cropSessionRef.current) return alert('Apply or cancel the crop before exporting.');
    const firstIsLandscape = pages[0]?.orientation === 'landscape';
    const firstFormat = firstIsLandscape ? [848, 600] : [600, 848];
    const firstOrientation = firstIsLandscape ? 'landscape' : 'portrait';
    const pdf = new jsPDF({ orientation: firstOrientation, unit: 'px', format: firstFormat });
    pages.forEach((page, index) => {
      const cvs = canvasRefs.current[page.id];
      if (cvs) {
        const isLandscape = page.orientation === 'landscape';
        const format = isLandscape ? [848, 600] : [600, 848];
        const orientation = isLandscape ? 'landscape' : 'portrait';
        if (index === 0) {
          // Recreate the document with the first page's actual orientation.
          // jsPDF's page size must match the canvas being exported.
        } else {
          pdf.addPage(format, orientation);
        }
        const dataUrl = cvs.toDataURL({ format: 'jpeg', multiplier: 3, quality: 1 });
        pdf.addImage(dataUrl, 'JPEG', 0, 0, format[0], format[1]);
      }
    });
    pdf.save(`${safeFileName(fileName)}.pdf`);
  };

  const exportAutoFitPDF = () => {
    if (autoFitImages.length === 0) return alert('No images to export.');

    Promise.all(autoFitImages.map((imgData) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.src = imgData.src;
    }))).then((loadedImages) => {
      let pdf = null;

      loadedImages.forEach((loaded, index) => {
        const imgData = autoFitImages[index];
        const marginPx = imgData.hasMargin ? 14 : 0;
        const isLandscape = imgData.width > imgData.height;
        const format = isLandscape ? [848, 600] : [600, 848];
        const orientation = isLandscape ? 'landscape' : 'portrait';

        if (index === 0) pdf = new jsPDF({ orientation, unit: 'px', format });
        else pdf.addPage(format, orientation);

        const availableW = format[0] - marginPx * 2;
        const availableH = format[1] - marginPx * 2;
        const scale = Math.min(availableW / imgData.width, availableH / imgData.height);
        const w = imgData.width * scale;
        const h = imgData.height * scale;
        const x = marginPx + (availableW - w) / 2;
        const y = marginPx + (availableH - h) / 2;

        pdf.addImage(loaded, 'JPEG', x, y, w, h);
      });

      pdf.save(`${safeFileName(fileName)}.pdf`);
    });
  };

  const canUndo = activeCanvas && activeCanvas.history && activeCanvas.history.length > 1 && !cropSession;
  const canRedo = activeCanvas && activeCanvas.redoStack && activeCanvas.redoStack.length > 0 && !cropSession;

  const displayedWidth = activeObject?.width ? Math.round(Math.abs(activeObject.width * (activeObject.scaleX || 1))) : 0;
  const displayedHeight = activeObject?.height ? Math.round(Math.abs(activeObject.height * (activeObject.scaleY || 1))) : 0;
  const selectedAngle = Math.round(activeObject?.angle || 0);

  if (!appMode) {
    return (
      <main className="min-h-[100dvh] w-full bg-[#0a0a0a] text-neutral-200 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8 sm:py-12">
          <div className="text-center mb-8 sm:mb-10">
            <div className="mx-auto mb-3 h-14 w-14 rounded-2xl bg-neutral-950 border border-neutral-700 p-2 shadow-xl"><img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="BareenaPDFs" className="h-full w-full object-contain" /></div>
            <img src={`${import.meta.env.BASE_URL}bareenapdfs-wordmark.svg`} alt="BareenaPDFs" className="mx-auto h-auto w-[min(78vw,360px)] sm:w-[360px]" />
            <div className="mt-2 text-[10px] sm:text-xs font-semibold text-neutral-500 uppercase tracking-[0.22em]">made by ariz</div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {modeOptions.map(({ id, label, description, Icon, accent }) => {
              const card = {
                blue: { border: 'hover:border-blue-500/50', icon: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
                emerald: { border: 'hover:border-emerald-500/50', icon: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
                purple: { border: 'hover:border-purple-500/50', icon: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
                orange: { border: 'hover:border-orange-500/50', icon: 'bg-orange-500/10 text-orange-400 border-orange-500/20' },
              }[accent];

              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setAppMode(id)}
                  className={`group w-full text-left rounded-2xl border border-neutral-800 bg-[#121212] p-4 sm:p-5 transition-all active:scale-[0.99] ${card.border}`}
                >
                  <div className="relative h-36 sm:h-44 rounded-xl border border-neutral-800 bg-[#0c0c0c] overflow-hidden flex items-center justify-center">
                    {id === 'customisable' && (
                      <div className="w-[42%] h-[78%] bg-white rounded-sm shadow-lg relative">
                        <div className="absolute left-[13%] top-[17%] w-[50%] h-[24%] bg-neutral-200 rounded-sm" />
                        <div className="absolute right-[12%] bottom-[15%] w-[35%] h-[30%] bg-neutral-300 rounded-sm" />
                      </div>
                    )}
                    {id === 'autofit' && (
                      <div className="flex gap-2 items-center">
                        <div className="w-20 h-28 sm:w-24 sm:h-32 bg-white rounded-sm shadow-lg flex items-center justify-center"><div className="w-12 h-16 bg-neutral-200 rounded-sm" /></div>
                        <div className="w-16 h-24 sm:w-20 sm:h-28 bg-neutral-800 border border-neutral-700 rounded-sm" />
                      </div>
                    )}
                    {id === 'pdf2img' && (
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-28 bg-white rounded-sm shadow-lg flex flex-col gap-1 p-2"><span className="h-1.5 w-full bg-neutral-300 rounded" /><span className="h-1.5 w-3/4 bg-neutral-300 rounded" /><span className="h-12 w-full bg-neutral-200 rounded mt-1" /></div>
                        <span className="text-neutral-600 text-xl">→</span>
                        <div className="w-20 h-20 bg-neutral-800 border border-neutral-700 rounded-lg flex items-center justify-center"><Icon size={26} className={card.icon.split(' ')[1]} /></div>
                      </div>
                    )}
                    {id === 'merge' && (
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-22 sm:w-20 sm:h-28 bg-white rounded-sm shadow-lg" />
                        <div className="w-16 h-22 sm:w-20 sm:h-28 bg-neutral-300 rounded-sm shadow-lg -ml-8 translate-y-2" />
                        <span className="text-white text-xl ml-1">+</span>
                        <div className="w-16 h-22 sm:w-20 sm:h-28 bg-neutral-800 border border-neutral-700 rounded-sm -ml-3" />
                      </div>
                    )}
                    <div className={`absolute top-3 right-3 w-9 h-9 rounded-xl border flex items-center justify-center ${card.icon}`}>
                      <Icon size={17} />
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base sm:text-lg font-bold text-white">{label}</h2>
                      <p className="mt-1.5 text-xs sm:text-sm leading-relaxed text-neutral-500">{description}</p>
                    </div>
                    <span className="shrink-0 text-neutral-600 group-hover:text-neutral-300 text-xl transition-colors">→</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="relative flex min-h-[100dvh] h-[100dvh] w-full min-w-0 bg-[#0a0a0a] font-sans text-neutral-200 overflow-hidden">
      <div className="lg:hidden absolute top-0 left-0 right-0 z-40 bg-[#121212]/95 backdrop-blur-xl border-b border-neutral-800">
        <div className="px-3 py-2.5 flex items-center gap-2">
          <button onClick={goToModes} className="p-2 -ml-1 rounded-lg bg-neutral-900 border border-neutral-800 text-neutral-300 active:scale-95" aria-label="Back to modes"><LayoutTemplate size={16} /></button>
          <div className="h-9 w-9 shrink-0 rounded-xl bg-neutral-950 border border-neutral-700 p-1 shadow-lg"><img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-full w-full object-contain" /></div>
          <div className="min-w-0 flex-1"><img src={`${import.meta.env.BASE_URL}bareenapdfs-wordmark.svg`} alt="BareenaPDFs" className="h-auto w-[132px] max-w-full" /><div className="text-[9px] font-semibold text-neutral-500 uppercase tracking-widest mt-1">made by ariz</div></div>
          <button onClick={() => setMobileToolsOpen((open) => !open)} className="p-2 rounded-lg bg-neutral-900 border border-neutral-800 text-neutral-300 active:scale-95" aria-label="Open tools"><Menu size={17} /></button>
        </div>
      </div>

      {/* LEFT SIDEBAR */}
      <div className="hidden lg:flex w-72 bg-[#121212] border-r border-neutral-800 flex-col justify-between shadow-2xl z-20 shrink-0">
        <div>
          <div className="p-6">
            <div className="mb-6">
              <button onClick={goToModes} className="flex items-center gap-2 text-left hover:opacity-80 transition-opacity">
                <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-9 w-9 shrink-0 object-contain" />
                <img src={`${import.meta.env.BASE_URL}bareenapdfs-wordmark.svg`} alt="BareenaPDFs" className="h-auto w-[165px] max-w-full" />
              </button>
              <span className="text-[10px] font-semibold text-neutral-500 uppercase tracking-widest mt-1 ml-11 block">made by ariz</span>
            </div>

            <div className="grid grid-cols-4 bg-neutral-900 p-1 rounded-lg border border-neutral-800 mb-6 relative">
              <button onClick={() => setAppMode('customisable')} className={`flex flex-col items-center justify-center gap-1 py-2 text-[9px] sm:text-[10px] font-semibold rounded-md transition-all ${appMode === 'customisable' ? 'bg-blue-600 text-white shadow-lg' : 'text-neutral-400 hover:text-white hover:bg-neutral-800'}`}><LayoutTemplate size={14} /><span>Custom</span></button>
              <button onClick={() => setAppMode('autofit')} className={`flex flex-col items-center justify-center gap-1 py-2 text-[9px] sm:text-[10px] font-semibold rounded-md transition-all ${appMode === 'autofit' ? 'bg-emerald-600 text-white shadow-lg' : 'text-neutral-400 hover:text-white hover:bg-neutral-800'}`}><Maximize size={14} /><span>Auto-Fit</span></button>
              <button onClick={() => setAppMode('pdf2img')} className={`flex flex-col items-center justify-center gap-1 py-2 text-[9px] sm:text-[10px] font-semibold rounded-md transition-all ${appMode === 'pdf2img' ? 'bg-purple-600 text-white shadow-lg' : 'text-neutral-400 hover:text-white hover:bg-neutral-800'}`}><ImageIcon size={14} /><span>PDF → Img</span></button>
              <button onClick={() => setAppMode('merge')} className={`flex flex-col items-center justify-center gap-1 py-2 text-[9px] sm:text-[10px] font-semibold rounded-md transition-all ${appMode === 'merge' ? 'bg-orange-600 text-white shadow-lg' : 'text-neutral-400 hover:text-white hover:bg-neutral-800'}`}><FilePlus2 size={14} /><span>Merge</span></button>
            </div>

            {appMode === 'customisable' && (
              <>
                <div className="flex gap-2 bg-neutral-900 p-1 rounded-lg border border-neutral-800 mb-4">
                  <button onClick={() => activeCanvas?.undo()} disabled={!canUndo} className="flex-1 flex items-center justify-center gap-2 py-2 hover:bg-neutral-800 rounded disabled:opacity-30 text-sm transition-colors"><Undo size={16} /> Undo</button>
                  <div className="w-px bg-neutral-800" />
                  <button onClick={() => activeCanvas?.redo()} disabled={!canRedo} className="flex-1 flex items-center justify-center gap-2 py-2 hover:bg-neutral-800 rounded disabled:opacity-30 text-sm transition-colors"><Redo size={16} /> Redo</button>
                </div>
                <label className="flex items-center justify-center gap-2 w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-3 rounded-lg cursor-pointer transition-all active:scale-95 shadow-lg shadow-blue-900/20">
                  <ImageIcon size={20} /> <span>Import Images</span>
                  <input type="file" multiple accept="image/*" className="hidden" onChange={handleCustomImport} />
                </label>
                <p className="text-[11px] text-neutral-500 text-center mt-2 font-medium">Select multiple images to create editable pages.</p>
                <div className="grid grid-cols-2 gap-2 mt-4">
                  <button onClick={() => fitAllImages('contain')} className="flex items-center justify-center gap-1.5 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-lg py-2 text-xs"><Minimize2 size={14} /> Fit All</button>
                  <button onClick={() => fitAllImages('cover')} className="flex items-center justify-center gap-1.5 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-lg py-2 text-xs"><Maximize2 size={14} /> Fill All</button>
                </div>
              </>
            )}

            {appMode === 'autofit' && (
              <>
                <label className="flex items-center justify-center gap-2 w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-3 rounded-lg cursor-pointer transition-all active:scale-95 shadow-lg shadow-emerald-900/20">
                  <ImageIcon size={20} /> <span>Upload to Auto-Fit</span>
                  <input type="file" multiple accept="image/*" className="hidden" onChange={handleAutoFitImport} />
                </label>
                <p className="text-[11px] text-neutral-500 text-center mt-3 font-medium">Images will instantly scale perfectly to PDF pages.</p>
              </>
            )}

            {appMode === 'pdf2img' && (
              <div className="animate-in fade-in duration-200">
                <label className={`flex items-center justify-center gap-2 w-full ${isPdfConverting ? 'bg-purple-900 text-purple-300' : 'bg-purple-600 hover:bg-purple-500 text-white'} font-medium py-3 rounded-lg cursor-pointer transition-all active:scale-95 shadow-lg shadow-purple-900/20`}>
                  {isPdfConverting ? <Loader2 size={20} className="animate-spin" /> : <FileText size={20} />}
                  <span>{isPdfConverting ? 'Converting...' : 'Upload PDF'}</span>
                  <input type="file" accept="application/pdf" className="hidden" onChange={handlePdfToImageUpload} disabled={isPdfConverting} />
                </label>
                <div className="mt-6 border-t border-neutral-800 pt-4">
                  <label className="text-xs text-neutral-500 mb-2 block font-medium">Choose Export Format:</label>
                  <div className="flex gap-2">
                    <button onClick={() => setPdfExportFormat('image/png')} className={`flex-1 py-2 text-xs font-bold rounded-md border transition-colors ${pdfExportFormat === 'image/png' ? 'bg-purple-500/20 border-purple-500 text-purple-400' : 'bg-neutral-900 border-neutral-700 text-neutral-400 hover:bg-neutral-800'}`}>PNG</button>
                    <button onClick={() => setPdfExportFormat('image/jpeg')} className={`flex-1 py-2 text-xs font-bold rounded-md border transition-colors ${pdfExportFormat === 'image/jpeg' ? 'bg-purple-500/20 border-purple-500 text-purple-400' : 'bg-neutral-900 border-neutral-700 text-neutral-400 hover:bg-neutral-800'}`}>JPEG</button>
                  </div>
                </div>
              </div>
            )}

            {appMode === 'merge' && (
              <div className="animate-in fade-in duration-200">
                <label className={`flex items-center justify-center gap-2 w-full ${isMergeBusy ? 'bg-orange-900 text-orange-300' : 'bg-orange-600 hover:bg-orange-500 text-white'} font-medium py-3 rounded-lg cursor-pointer transition-all active:scale-95 shadow-lg shadow-orange-900/20`}>
                  {isMergeBusy ? <Loader2 size={20} className="animate-spin" /> : <FilePlus2 size={20} />}
                  <span>{isMergeBusy ? 'Reading PDFs...' : 'Add PDF Files'}</span>
                  <input type="file" multiple accept="application/pdf" className="hidden" onChange={handleMergeUpload} disabled={isMergeBusy} />
                </label>
                <p className="text-[11px] text-neutral-500 text-center mt-3 font-medium">Combine pages directly without converting the source PDFs into images.</p>
              </div>
            )}
          </div>
        </div>

        <div className="p-6 bg-neutral-900/50 border-t border-neutral-800 mt-auto">
          <label className="text-xs text-neutral-500 mb-1 block">File Name</label>
          <input
            type="text" value={fileName} onChange={(e) => setFileName(e.target.value)}
            className="w-full bg-neutral-950 border border-neutral-700 rounded p-2 mb-4 text-sm focus:outline-none focus:border-blue-500 transition-colors"
          />
          {appMode === 'pdf2img' ? (
            <button onClick={downloadAllPdfImages} disabled={!pdfImages.length} className="flex items-center justify-center gap-2 w-full bg-purple-600 hover:bg-purple-500 text-white font-semibold py-3 rounded-lg transition-all active:scale-95 shadow-lg shadow-purple-900/20 disabled:opacity-40">
              <Download size={20} /> Download All Images
            </button>
          ) : appMode === 'merge' ? (
            <button onClick={combinePDFs} disabled={isMergeBusy || mergeFiles.length < 2} className="flex items-center justify-center gap-2 w-full bg-orange-600 hover:bg-orange-500 text-white font-semibold py-3 rounded-lg transition-all active:scale-95 shadow-lg shadow-orange-900/20 disabled:opacity-40">
              {isMergeBusy ? <Loader2 size={20} className="animate-spin" /> : <Download size={20} />} {isMergeBusy ? 'Merging...' : 'Combine PDFs'}
            </button>
          ) : (
            <button onClick={appMode === 'customisable' ? exportCustomPDF : exportAutoFitPDF} className="flex items-center justify-center gap-2 w-full bg-white hover:bg-neutral-200 text-black font-semibold py-3 rounded-lg transition-all active:scale-95 shadow-lg shadow-white/10">
              <Download size={20} /> Export to PDF
            </button>
          )}
        </div>
      </div>

      {/* CENTER WORKSPACE */}
      {appMode === 'customisable' && (
        <div id="workspace-container" onMouseDown={handleWorkspaceClick} onTouchStart={handleWorkspaceClick} onDragOver={handleSectionDragOver} onDrop={handleSectionDrop} className="flex-1 min-h-0 min-w-0 w-full max-w-full bg-[#0a0a0a] overflow-x-hidden overflow-y-auto overscroll-contain p-2 sm:p-6 lg:p-10 pt-16 lg:pt-10 pb-28 lg:pb-10 flex flex-col items-center">
          <div id="workspace-spacer" className="w-full max-w-full flex flex-col items-center">
            {pages.map((page, index) => (
              <PageCanvas
                key={page.id}
                page={page}
                pageIndex={index}
                totalPages={pages.length}
                onSetActive={setActiveFromCanvas}
                activeCanvasId={activeCanvasId}
                moveUp={movePageUp}
                moveDown={movePageDown}
                deletePage={deletePage}
                toggleOrientation={toggleOrientation}
                registerCanvas={registerCanvas}
                onDragStart={() => dragItem.current = index}
                onDragEnter={() => dragOverItem.current = index}
                onDragEnd={handleSortPages}
              />
            ))}
            <button onClick={addBlankPage} className="mb-20 mt-4 flex items-center gap-2 text-neutral-500 hover:text-white transition-colors py-2 px-4 rounded-full border border-neutral-800 hover:border-neutral-600 bg-neutral-900/50">
              <Plus size={16} /> Add Blank Page
            </button>
          </div>
        </div>
      )}

      {appMode === 'autofit' && (
        <div className="flex-1 min-h-0 bg-[#0a0a0a] overflow-auto p-3 sm:p-6 lg:p-10 pt-24 lg:pt-10 pb-24 lg:pb-10 flex flex-col items-center" onDragOver={handleSectionDragOver} onDrop={handleSectionDrop}>
          {autoFitImages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-neutral-500 text-center">
              <Maximize size={48} className="opacity-20 mb-4" />
              <p>No images uploaded yet.<br />Upload images to see the Auto-Fit Blueprint.</p>
            </div>
          ) : (
            autoFitImages.map((imgData, idx) => {
              const isLandscape = imgData.width > imgData.height;
              const w = isLandscape ? 848 : 600;
              const h = isLandscape ? 600 : 848;
              const AutoFitPageDraggable = () => {
                const [isDragg, setIsDragg] = useState(false);
                return (
                  <div
                    draggable={isDragg}
                    onDragStart={() => dragItem.current = idx}
                    onDragEnter={() => dragOverItem.current = idx}
                    onDragEnd={handleSortAutoFit}
                    onDragOver={(e) => e.preventDefault()}
                    className="mb-8 sm:mb-12 flex flex-col items-center transition-all hover:scale-[1.01] w-full"
                  >
                    <div className="flex justify-between items-center mb-3 text-neutral-400 cursor-grab active:cursor-grabbing w-full" style={{ width: `${w}px` }} onMouseEnter={() => setIsDragg(true)} onMouseLeave={() => setIsDragg(false)}>
                      <div className="flex items-center gap-2 hover:text-white transition-colors"><GripHorizontal size={18} /><span className="font-bold text-sm tracking-widest uppercase">Blueprint {idx + 1}</span></div>
                      <div className="flex items-center gap-4" onMouseEnter={() => setIsDragg(false)}>
                        <span className="text-[10px] font-bold uppercase tracking-wider bg-neutral-800 text-neutral-300 px-2.5 py-1 rounded-full">{isLandscape ? 'Landscape' : 'Portrait'}</span>
                        <label className="flex items-center gap-1.5 cursor-pointer text-xs font-bold text-neutral-400 hover:text-white transition-colors border-l border-neutral-800 pl-4">
                          <input type="checkbox" checked={imgData.hasMargin} onChange={() => toggleAutoFitMargin(imgData.id)} className="accent-emerald-500 w-3.5 h-3.5 rounded cursor-pointer" />
                          5mm Margins
                        </label>
                        <button onClick={() => deleteAutoFitPage(imgData.id)} className="p-1.5 hover:bg-red-500/20 text-red-500 rounded transition-colors ml-2"><Trash2 size={16} /></button>
                      </div>
                    </div>
                    <div className="bg-[#0c1a2e] border border-blue-500/30 flex items-center justify-center relative shadow-2xl ring-1 ring-blue-500/20 transition-all" style={{ width: `min(${w}px, calc(100vw - 24px))`, height: `min(${h}px, calc((100vw - 24px) * ${h / w}))`, backgroundImage: 'linear-gradient(rgba(0, 195, 255, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 195, 255, 0.1) 1px, transparent 1px)', backgroundSize: '20px 20px', padding: imgData.hasMargin ? '14px' : '0px' }}>
                      <img src={imgData.src} className="max-w-full max-h-full object-contain drop-shadow-2xl z-10" alt={`AutoFit Blueprint ${idx + 1}`} />
                    </div>
                  </div>
                );
              };
              return <AutoFitPageDraggable key={imgData.id} />;
            })
          )}
        </div>
      )}

      {appMode === 'pdf2img' && (
        <div className="flex-1 min-h-0 bg-[#0a0a0a] overflow-auto p-3 sm:p-6 lg:p-10 pt-24 lg:pt-10 pb-24 lg:pb-10 flex flex-col items-center" onDragOver={handleSectionDragOver} onDrop={handleSectionDrop}>
          {pdfImages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-neutral-500 text-center animate-in fade-in duration-500">
              <FileText size={48} className="opacity-20 mb-4" />
              <p>No PDF uploaded yet.<br />Upload a document to extract all of its pages into images.</p>
            </div>
          ) : (
            <div className="w-full max-w-5xl grid grid-cols-2 gap-8 animate-in fade-in duration-300">
              {pdfImages.map((img) => (
                <div key={img.id} className="bg-[#121212] p-5 rounded-xl border border-neutral-800 shadow-2xl flex flex-col items-center transition-all hover:scale-[1.02]">
                  <div className="w-full flex justify-between items-center mb-4">
                    <span className="text-sm font-bold text-neutral-400 tracking-wider">PAGE {img.pageNum}</span>
                    <button onClick={() => downloadPdfImage(img.dataUrl, img.pageNum)} className="flex items-center gap-1.5 text-xs font-bold bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 px-3 py-1.5 rounded transition-colors border border-purple-500/20"><Download size={14} /> Download Page</button>
                  </div>
                  <img src={img.dataUrl} className="w-full object-contain bg-white rounded shadow-inner" alt={`PDF Page ${img.pageNum}`} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {appMode === 'merge' && (
        <div className="flex-1 min-h-0 bg-[#0a0a0a] overflow-auto p-3 sm:p-6 lg:p-10 pt-24 lg:pt-10 pb-24 lg:pb-10 flex flex-col items-center" onDragOver={handleSectionDragOver} onDrop={handleSectionDrop}>
          {mergeFiles.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-neutral-500 text-center animate-in fade-in duration-500 px-6">
              <FilePlus2 size={48} className="opacity-20 mb-4" />
              <p className="text-sm text-neutral-300 font-semibold">No PDF files added yet.</p>
              <p className="text-xs text-neutral-600 mt-2">Add PDF files to arrange and combine them into one document.</p>
            </div>
          ) : (
            <div className="w-full max-w-5xl animate-in fade-in duration-300">
              <div className="flex items-center justify-between mb-5 px-1">
                <span className="text-sm font-bold text-neutral-400 tracking-wider">{mergeFiles.length} PDF FILE{mergeFiles.length === 1 ? '' : 'S'} · {totalMergePages} PAGE{totalMergePages === 1 ? '' : 'S'}</span>
                <button onClick={clearMergeFiles} className="text-xs font-semibold text-neutral-500 hover:text-white transition-colors">Clear all</button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {mergeFiles.map((file, idx) => (
                  <div
                    key={file.id}
                    draggable
                    onDragStart={() => { dragItem.current = idx; }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      const from = dragItem.current;
                      if (from != null) reorderMergeFiles(from, idx);
                      dragItem.current = null;
                    }}
                    className="bg-[#121212] p-5 rounded-xl border border-neutral-800 shadow-2xl flex flex-col transition-all hover:scale-[1.01]"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-sm font-bold text-neutral-400 tracking-wider">PDF {idx + 1}</span>
                      <GripHorizontal size={18} className="text-neutral-600 cursor-grab" />
                    </div>

                    <div className="flex gap-4 items-center">
                      {file.preview ? (
                        <img src={file.preview} alt="" className="h-24 w-[4.4rem] rounded bg-white object-cover border border-neutral-700 shrink-0 shadow-inner" />
                      ) : (
                        <div className="h-24 w-[4.4rem] rounded bg-orange-500/10 text-orange-400 flex items-center justify-center border border-orange-500/10 shrink-0"><FileText size={22} /></div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-sm text-white truncate" title={file.name}>{file.name}</div>
                        <div className="mt-1.5 text-[10px] text-neutral-500">{file.pageCount} page{file.pageCount === 1 ? '' : 's'} · {(file.size / 1024 / 1024).toFixed(2)} MB</div>
                      </div>
                    </div>

                    <div className="mt-5 pt-4 border-t border-neutral-800 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        <button aria-label="Move PDF up" onClick={() => moveMergeFile(idx, -1)} disabled={idx === 0} className="p-2 rounded-lg hover:bg-neutral-900 text-neutral-500 disabled:opacity-25"><MoveUp size={14} /></button>
                        <button aria-label="Move PDF down" onClick={() => moveMergeFile(idx, 1)} disabled={idx === mergeFiles.length - 1} className="p-2 rounded-lg hover:bg-neutral-900 text-neutral-500 disabled:opacity-25"><MoveDown size={14} /></button>
                      </div>
                      <button aria-label="Remove PDF" onClick={() => removeMergeFile(file.id)} className="p-2 rounded-lg hover:bg-red-500/10 text-red-400"><Trash2 size={15} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* RIGHT SIDEBAR */}
      {appMode === 'customisable' && (
        <div className="hidden xl:flex w-80 bg-[#121212] border-l border-neutral-800 p-6 flex-col shadow-2xl z-20 overflow-y-auto shrink-0">
          {cropSession ? (
            <div className="space-y-5 animate-in fade-in duration-200">
              <div>
                <div className="flex items-center gap-2 mb-1"><Crop size={18} className="text-blue-400" /><h2 className="text-sm font-bold text-white">Crop Image</h2></div>
                <p className="text-[11px] text-neutral-500">Drag the crop box or its handles. The crop stays inside the image.</p>
              </div>

              <div>
                <h2 className="text-xs font-bold text-neutral-500 tracking-wider mb-3">ASPECT RATIO</h2>
                <div className="grid grid-cols-4 gap-2">
                  {['free', '1:1', '4:5', '16:9'].map((ratio) => (
                    <button key={ratio} onClick={() => setCropAspectRatio(ratio)} className={`py-2 text-[11px] font-bold rounded border transition-colors ${cropRatio === ratio ? 'bg-blue-500/20 text-blue-400 border-blue-500' : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:bg-neutral-800'}`}>{ratio === 'free' ? 'Free' : ratio}</button>
                  ))}
                </div>
              </div>

              <div className="bg-blue-500/5 border border-blue-500/15 rounded-lg p-3 text-[11px] text-neutral-400 leading-relaxed">
                <div className="flex gap-2 items-start"><Crosshair size={14} className="text-blue-400 mt-0.5 shrink-0" />
                  <span>Crop mode supports rotated images too. The image's rotation is preserved when you apply the crop.</span>
                </div>
              </div>

              <div className="flex gap-2 pt-2 border-t border-neutral-800">
                <button onClick={cancelCrop} className="flex-1 flex items-center justify-center gap-2 bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 py-2.5 rounded-lg text-sm font-semibold"><X size={16} /> Cancel</button>
                <button onClick={applyCrop} className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 py-2.5 rounded-lg text-sm font-semibold"><Check size={16} /> Apply Crop</button>
              </div>
              <p className="text-[10px] text-neutral-600 text-center">Esc cancels crop</p>
            </div>
          ) : activeObject ? (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div className="flex gap-2">
                <button onClick={startCrop} disabled={activeObject.type !== 'image' || activeObject.lockMovementX} className="flex-1 flex items-center justify-center gap-2 bg-blue-500/10 text-blue-400 border border-blue-500/25 hover:bg-blue-500/20 disabled:opacity-25 disabled:cursor-not-allowed py-2.5 rounded-lg text-sm font-semibold"><Crop size={17} /> Crop</button>
                <button onClick={duplicateSelected} disabled={activeObject.lockMovementX} className="flex-1 flex items-center justify-center gap-2 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 disabled:opacity-30 py-2.5 rounded-lg text-sm font-semibold"><Copy size={17} /> Duplicate</button>
              </div>

              <button onClick={toggleLock} className={`flex items-center justify-center gap-2 w-full py-3 rounded-lg transition-all font-medium border ${activeObject.lockMovementX ? 'bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20' : 'bg-neutral-800 text-neutral-200 border-neutral-700 hover:bg-neutral-700'}`}>
                {activeObject.lockMovementX ? <><Lock size={18} /> Layer Locked</> : <><Unlock size={18} /> Lock Layer</>}
              </button>

              <div className={activeObject.lockMovementX ? 'opacity-30 pointer-events-none transition-opacity space-y-6' : 'transition-opacity space-y-6'}>
                <div>
                  <div className="flex items-center justify-between mb-3"><h2 className="text-xs font-bold text-neutral-500 tracking-wider">DIMENSIONS</h2>{activeObject.type === 'image' && <button onClick={toggleAspectRatioLock} className={`text-[10px] font-bold flex items-center gap-1 ${activeObject.lockUniScaling !== false ? 'text-blue-400' : 'text-neutral-500'}`}><Ratio size={13} /> {activeObject.lockUniScaling !== false ? 'Locked' : 'Free'}</button>}</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-neutral-900 p-2 rounded border border-neutral-800"><span className="text-[10px] text-neutral-500 uppercase block mb-0.5">Width (px)</span><input type="number" value={displayedWidth} onChange={(e) => handlePropertyChange('width', e.target.value)} onBlur={commitPropertyChange} className="w-full bg-transparent text-sm text-white outline-none focus:text-blue-400" /></div>
                    <div className="bg-neutral-900 p-2 rounded border border-neutral-800"><span className="text-[10px] text-neutral-500 uppercase block mb-0.5">Height (px)</span><input type="number" value={displayedHeight} onChange={(e) => handlePropertyChange('height', e.target.value)} onBlur={commitPropertyChange} className="w-full bg-transparent text-sm text-white outline-none focus:text-blue-400" /></div>
                    <div className="bg-neutral-900 p-2 rounded border border-neutral-800"><span className="text-[10px] text-neutral-500 uppercase block mb-0.5">Rotation (°)</span><input type="number" value={selectedAngle} onChange={(e) => handlePropertyChange('angle', e.target.value)} onBlur={commitPropertyChange} className="w-full bg-transparent text-sm text-white outline-none focus:text-blue-400" /></div>
                    <div className="bg-neutral-900 p-2 rounded border border-neutral-800"><span className="text-[10px] text-neutral-500 uppercase block mb-0.5">Opacity (%)</span><input type="number" min="0" max="100" value={Math.round((activeObject.opacity ?? 1) * 100)} onChange={(e) => handlePropertyChange('opacity', e.target.value)} onBlur={commitPropertyChange} className="w-full bg-transparent text-sm text-white outline-none focus:text-blue-400" /></div>
                  </div>
                </div>

                <div>
                  <h2 className="text-xs font-bold text-neutral-500 tracking-wider mb-3">POSITION</h2>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-neutral-900 p-2 rounded border border-neutral-800"><span className="text-[10px] text-neutral-500 uppercase block mb-0.5">X</span><input type="number" value={Math.round(activeObject.left || 0)} onChange={(e) => handlePropertyChange('left', e.target.value)} onBlur={commitPropertyChange} className="w-full bg-transparent text-sm text-white outline-none focus:text-blue-400" /></div>
                    <div className="bg-neutral-900 p-2 rounded border border-neutral-800"><span className="text-[10px] text-neutral-500 uppercase block mb-0.5">Y</span><input type="number" value={Math.round(activeObject.top || 0)} onChange={(e) => handlePropertyChange('top', e.target.value)} onBlur={commitPropertyChange} className="w-full bg-transparent text-sm text-white outline-none focus:text-blue-400" /></div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    <button onClick={() => alignActive('left')} className="bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 py-2 rounded text-[10px]">Left</button>
                    <button onClick={() => alignActive('centerH')} className="bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 py-2 rounded text-[10px]">Center</button>
                    <button onClick={() => alignActive('right')} className="bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 py-2 rounded text-[10px]">Right</button>
                    <button onClick={() => alignActive('top')} className="bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 py-2 rounded text-[10px]">Top</button>
                    <button onClick={() => alignActive('centerV')} className="bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 py-2 rounded text-[10px]">Middle</button>
                    <button onClick={() => alignActive('bottom')} className="bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 py-2 rounded text-[10px]">Bottom</button>
                  </div>
                </div>

                <div>
                  <h2 className="text-xs font-bold text-neutral-500 tracking-wider mb-3">ADJUSTMENTS</h2>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => updateActive({ flipX: !activeObject.flipX })} className="bg-neutral-900 hover:bg-neutral-800 py-2 flex justify-center rounded border border-neutral-800"><FlipHorizontal size={18} /></button>
                    <button onClick={() => updateActive({ flipY: !activeObject.flipY })} className="bg-neutral-900 hover:bg-neutral-800 py-2 flex justify-center rounded border border-neutral-800"><FlipVertical size={18} /></button>
                    <button onClick={() => rotateActive(-90)} className="bg-neutral-900 hover:bg-neutral-800 py-2 flex items-center justify-center gap-1 rounded border border-neutral-800 text-xs"><RotateCcw size={16} /> Rotate Left</button>
                    <button onClick={() => rotateActive(90)} className="bg-neutral-900 hover:bg-neutral-800 py-2 flex items-center justify-center gap-1 rounded border border-neutral-800 text-xs"><RotateCcw size={16} className="scale-x-[-1]" /> Rotate Right</button>
                    <button onClick={() => updateActive({ angle: 0 })} className="col-span-2 bg-neutral-900 hover:bg-neutral-800 py-2 flex items-center justify-center gap-2 rounded border border-neutral-800 text-xs"><RotateCcw size={16} /> Reset Rotation</button>
                  </div>
                </div>

                <div>
                  <h2 className="text-xs font-bold text-neutral-500 tracking-wider mb-3">ALIGN TO PAGE</h2>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => centerAndScaleActive('contain')} className="flex items-center justify-center gap-2 bg-neutral-900 hover:bg-neutral-800 py-2 rounded border border-neutral-800 text-xs"><Minimize2 size={14} /> Fit</button>
                    <button onClick={() => centerAndScaleActive('cover')} className="flex items-center justify-center gap-2 bg-neutral-900 hover:bg-neutral-800 py-2 rounded border border-neutral-800 text-xs"><Maximize2 size={14} /> Fill</button>
                  </div>
                </div>

                <div>
                  <h2 className="text-xs font-bold text-neutral-500 tracking-wider mb-3">ARRANGE</h2>
                  <div className="flex gap-2">
                    <button onClick={() => { activeCanvas.bringForward(activeObject); activeCanvas.fire('object:modified', { target: activeObject }); }} className="flex-1 flex items-center justify-center gap-2 bg-neutral-900 hover:bg-neutral-800 py-2 rounded-md transition-colors text-xs font-medium border border-neutral-800"><MoveUp size={14} /> Forward</button>
                    <button onClick={() => { activeCanvas.sendBackwards(activeObject); activeCanvas.fire('object:modified', { target: activeObject }); }} className="flex-1 flex items-center justify-center gap-2 bg-neutral-900 hover:bg-neutral-800 py-2 rounded-md transition-colors text-xs font-medium border border-neutral-800"><MoveDown size={14} /> Backward</button>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-neutral-800">
                <button onClick={deleteSelected} disabled={activeObject.lockMovementX} className="flex items-center justify-center gap-2 w-full bg-red-500/10 hover:bg-red-500/20 disabled:opacity-30 disabled:hover:bg-red-500/10 text-red-500 border border-red-500/20 font-medium py-2.5 rounded-lg transition-colors"><Trash2 size={18} /> Delete Layer</button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="h-48 flex flex-col items-center justify-center text-neutral-500 text-center space-y-3"><Layers size={48} className="opacity-20" /><p className="text-sm">Select an image to see<br />editing tools.</p></div>

            </div>
          )}
        </div>
      )}
      {appMode === 'customisable' && (
        <div className="xl:hidden fixed inset-x-0 bottom-0 z-50 px-2 pb-[max(8px,env(safe-area-inset-bottom))] pointer-events-none">
          <div className="mx-auto max-w-xl rounded-2xl border border-neutral-800 bg-[#121212]/97 backdrop-blur-xl shadow-2xl p-2 pointer-events-auto">
            {cropSession ? (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                  {['free', '1:1', '4:5', '16:9'].map((ratio) => (
                    <button key={ratio} onClick={() => setCropAspectRatio(ratio)} className={`shrink-0 px-3 py-2 rounded-xl text-[10px] font-bold border ${cropRatio === ratio ? 'bg-blue-500/20 border-blue-500 text-blue-400' : 'bg-neutral-900 border-neutral-800 text-neutral-400'}`}>{ratio === 'free' ? 'Free' : ratio}</button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button onClick={cancelCrop} className="py-2.5 rounded-xl bg-neutral-900 border border-neutral-800 text-xs font-semibold"><X size={15} className="inline mr-1.5" />Cancel</button>
                  <button onClick={applyCrop} className="py-2.5 rounded-xl bg-blue-600 text-white text-xs font-semibold"><Check size={15} className="inline mr-1.5" />Apply Crop</button>
                </div>
              </div>
            ) : (
              <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                <label className="min-w-[58px] shrink-0 py-2 rounded-xl bg-blue-600 text-white text-[10px] font-semibold text-center active:scale-95 cursor-pointer"><Plus size={15} className="mx-auto mb-1" />Add<input type="file" multiple accept="image/*" className="hidden" onChange={handleCustomImport} /></label>
                <button onClick={() => activeCanvas?.undo()} disabled={!canUndo} className="min-w-[58px] shrink-0 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-[10px] font-semibold disabled:opacity-30 active:scale-95"><Undo size={15} className="mx-auto mb-1" />Undo</button>
                <button onClick={() => activeCanvas?.redo()} disabled={!canRedo} className="min-w-[58px] shrink-0 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-[10px] font-semibold disabled:opacity-30 active:scale-95"><Redo size={15} className="mx-auto mb-1" />Redo</button>
                {activeObject && <>
                  <button onClick={() => { activeCanvas?.discardActiveObject(); activeCanvas?.renderAll(); setActiveObject(null); }} className="min-w-[70px] shrink-0 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-[10px] font-semibold active:scale-95"><X size={15} className="mx-auto mb-1" />Deselect</button>
                  <button onClick={startCrop} disabled={activeObject.type !== 'image' || activeObject.lockMovementX} className="min-w-[58px] shrink-0 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-[10px] font-semibold disabled:opacity-30 active:scale-95"><Crop size={15} className="mx-auto mb-1" />Crop</button>
                  <button onClick={duplicateSelected} disabled={activeObject.lockMovementX} className="min-w-[70px] shrink-0 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-[10px] font-semibold disabled:opacity-30 active:scale-95"><Copy size={15} className="mx-auto mb-1" />Duplicate</button>
                  <button onClick={toggleLock} className="min-w-[58px] shrink-0 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-[10px] font-semibold active:scale-95"><Lock size={15} className="mx-auto mb-1" />{activeObject.lockMovementX ? 'Unlock' : 'Lock'}</button>
                </>}
                <button onClick={() => setMobileToolsOpen(true)} className="min-w-[58px] shrink-0 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-[10px] font-semibold active:scale-95"><Settings size={15} className="mx-auto mb-1" />More</button>
                <button onClick={exportCustomPDF} disabled={!!cropSessionRef.current} className="min-w-[62px] shrink-0 py-2 rounded-xl bg-white text-black text-[10px] font-semibold disabled:opacity-30 active:scale-95"><Download size={15} className="mx-auto mb-1" />Export</button>
              </div>
            )}
          </div>
        </div>
      )}
      {appMode === 'customisable' && mobileToolsOpen && (
        <div className="xl:hidden fixed inset-0 z-[60] bg-black/60" onMouseDown={(e) => { if (e.currentTarget === e.target) setMobileToolsOpen(false); }}><div className="absolute inset-x-0 bottom-0 max-h-[82vh] overflow-y-auto rounded-t-3xl border-t border-neutral-700 bg-[#121212] shadow-2xl pb-[max(12px,env(safe-area-inset-bottom))]"><div className="sticky top-0 z-10 bg-[#121212] border-b border-neutral-800 px-4 py-3 flex items-center justify-between"><span className="text-sm font-semibold">Editor tools</span><button onClick={() => setMobileToolsOpen(false)} className="p-2 rounded-lg hover:bg-neutral-900"><X size={16} /></button></div>{activeObject ? <div className="p-4 space-y-5"><div className="grid grid-cols-2 gap-2">
<button onClick={() => rotateActive(-90)} className="bg-neutral-900 border border-neutral-800 py-2 rounded text-xs flex items-center justify-center gap-1"><RotateCcw size={14} /> Rotate Left</button>
<button onClick={() => rotateActive(90)} className="bg-neutral-900 border border-neutral-800 py-2 rounded text-xs flex items-center justify-center gap-1"><RotateCcw size={14} className="scale-x-[-1]" /> Rotate Right</button>
</div><div className="grid grid-cols-2 gap-2"><button onClick={() => alignActive('left')} className="bg-neutral-900 border border-neutral-800 py-2 rounded text-[10px]">Left</button><button onClick={() => alignActive('centerH')} className="bg-neutral-900 border border-neutral-800 py-2 rounded text-[10px]">Center</button><button onClick={() => alignActive('right')} className="bg-neutral-900 border border-neutral-800 py-2 rounded text-[10px]">Right</button><button onClick={() => alignActive('top')} className="bg-neutral-900 border border-neutral-800 py-2 rounded text-[10px]">Top</button><button onClick={() => alignActive('centerV')} className="bg-neutral-900 border border-neutral-800 py-2 rounded text-[10px]">Middle</button><button onClick={() => alignActive('bottom')} className="bg-neutral-900 border border-neutral-800 py-2 rounded text-[10px]">Bottom</button></div><div className="grid grid-cols-2 gap-2"><button onClick={() => fitAllImages('contain')} className="bg-neutral-900 border border-neutral-800 py-2 rounded text-xs">Fit All</button><button onClick={() => fitAllImages('cover')} className="bg-neutral-900 border border-neutral-800 py-2 rounded text-xs">Fill All</button></div><div className="grid grid-cols-2 gap-2"><button onClick={() => centerAndScaleActive('contain')} className="bg-neutral-900 border border-neutral-800 py-2 rounded text-xs">Fit page</button><button onClick={() => centerAndScaleActive('cover')} className="bg-neutral-900 border border-neutral-800 py-2 rounded text-xs">Fill page</button></div><label className="flex items-center justify-between bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2.5"><span className="text-xs">Proportional scaling</span><input type="checkbox" checked={activeObject.lockUniScaling !== false} onChange={toggleAspectRatioLock} className="accent-blue-500" /></label><div className="grid grid-cols-2 gap-3"><label className="bg-neutral-900 border border-neutral-800 rounded p-2"><span className="text-[10px] text-neutral-500 block mb-1">X</span><input type="number" value={Math.round(activeObject.left || 0)} onChange={(e) => handlePropertyChange('left', e.target.value)} className="w-full bg-transparent text-sm text-white outline-none" /></label><label className="bg-neutral-900 border border-neutral-800 rounded p-2"><span className="text-[10px] text-neutral-500 block mb-1">Y</span><input type="number" value={Math.round(activeObject.top || 0)} onChange={(e) => handlePropertyChange('top', e.target.value)} className="w-full bg-transparent text-sm text-white outline-none" /></label></div></div> : <div className="p-4 space-y-3"><label className="flex items-center justify-between bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2.5"><span className="text-xs">Smart snapping</span><input type="checkbox" checked={!!activeCanvas?.snapEnabled} onChange={() => toggleCanvasSetting('snapEnabled')} className="accent-blue-500" /></label><label className="flex items-center justify-between bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2.5"><span className="text-xs">Keep inside page</span><input type="checkbox" checked={!!activeCanvas?.boundaryLock} onChange={() => toggleCanvasSetting('boundaryLock')} className="accent-blue-500" /></label><label className="flex items-center justify-between bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2.5"><span className="text-xs">15° angle snapping</span><input type="checkbox" checked={!!activeCanvas?.angleSnapEnabled} onChange={() => toggleCanvasSetting('angleSnapEnabled')} className="accent-blue-500" /></label></div>}<div className="px-4 pb-4"><label className="text-xs text-neutral-500 block mb-2">File Name</label><input type="text" value={fileName} onChange={(e) => setFileName(e.target.value)} className="w-full bg-neutral-950 border border-neutral-700 rounded p-2 text-sm focus:outline-none focus:border-blue-500" /></div></div></div>
      )}

      {appMode === 'autofit' && (
        <div className="xl:hidden fixed inset-x-0 bottom-0 z-50 px-2 pb-[max(8px,env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-xl rounded-2xl border border-neutral-800 bg-[#121212]/97 backdrop-blur-xl shadow-2xl p-2">
            <div className="grid grid-cols-2 gap-1.5">
              <label className="py-2 rounded-xl bg-emerald-600 text-white text-[10px] font-semibold text-center cursor-pointer"><ImageIcon size={15} className="mx-auto mb-1" />Upload<input type="file" multiple accept="image/*" className="hidden" onChange={handleAutoFitImport} /></label>
              <button onClick={exportAutoFitPDF} disabled={autoFitImages.length === 0} className="py-2 rounded-xl bg-white text-black text-[10px] font-semibold disabled:opacity-30"><Download size={15} className="mx-auto mb-1" />Export PDF</button>
            </div>
          </div>
        </div>
      )}

      {appMode === 'pdf2img' && (
        <div className="xl:hidden fixed inset-x-0 bottom-0 z-50 px-2 pb-[max(8px,env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-xl rounded-2xl border border-neutral-800 bg-[#121212]/97 backdrop-blur-xl shadow-2xl p-2">
            <div className="grid grid-cols-2 gap-1.5">
              <label className="py-2 rounded-xl bg-purple-600 text-white text-[10px] font-semibold text-center cursor-pointer"><FileText size={15} className="mx-auto mb-1" />Upload PDF<input type="file" accept="application/pdf,.pdf" className="hidden" onChange={handlePdfToImageUpload} disabled={isPdfConverting} /></label>
              <button onClick={downloadAllPdfImages} disabled={pdfImages.length === 0} className="py-2 rounded-xl bg-white text-black text-[10px] font-semibold disabled:opacity-30"><Download size={15} className="mx-auto mb-1" />Download All</button>
            </div>
          </div>
        </div>
      )}

      {appMode === 'merge' && (
        <div className="xl:hidden fixed inset-x-0 bottom-0 z-50 px-2 pb-[max(8px,env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-xl rounded-2xl border border-neutral-800 bg-[#121212]/97 backdrop-blur-xl shadow-2xl p-2">
            <div className="grid grid-cols-2 gap-1.5">
              <label className="py-2 rounded-xl bg-orange-600 text-white text-[10px] font-semibold text-center cursor-pointer"><Plus size={15} className="mx-auto mb-1" />Add PDFs<input type="file" multiple accept="application/pdf,.pdf" className="hidden" onChange={handleMergeUpload} disabled={isMergeBusy} /></label>
              <button onClick={combinePDFs} disabled={mergeFiles.length < 2 || isMergeBusy} className="py-2 rounded-xl bg-white text-black text-[10px] font-semibold disabled:opacity-30"><FilePlus2 size={15} className="mx-auto mb-1" />Combine</button>
            </div>
          </div>
        </div>
      )}

      {mobileToolsOpen && appMode !== 'customisable' && (
        <div className="xl:hidden fixed inset-0 z-[60] bg-black/60" onMouseDown={(e) => { if (e.currentTarget === e.target) setMobileToolsOpen(false); }}><div className="absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-neutral-700 bg-[#121212] shadow-2xl p-4 pb-[max(12px,env(safe-area-inset-bottom))]"><div className="flex items-center justify-between mb-3"><span className="text-sm font-semibold">Output settings</span><button onClick={() => setMobileToolsOpen(false)} className="p-2 rounded-lg hover:bg-neutral-900"><X size={16} /></button></div><label className="text-xs text-neutral-500 block mb-2">File Name</label><input type="text" value={fileName} onChange={(e) => setFileName(e.target.value)} className="w-full bg-neutral-950 border border-neutral-700 rounded p-2 text-sm focus:outline-none focus:border-blue-500" /></div></div>
      )}

    </div>
  );
}
