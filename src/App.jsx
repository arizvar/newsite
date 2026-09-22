import React, { useEffect, useMemo, useRef, useState } from 'react';
import { fabric } from 'fabric';
import { jsPDF } from 'jspdf';
import * as pdfjsLib from 'pdfjs-dist';
import {
  AlignCenterHorizontal, AlignCenterVertical, ArrowDown, ArrowLeft, ArrowRight, ArrowUp,
  Check, ChevronDown, Copy, Crop, Download, Eye, FileImage, FilePlus2, FileText,
  FlipHorizontal, FlipVertical, FolderOpen, GripHorizontal, Image as ImageIcon, Layers,
  LayoutTemplate, Loader2, Lock, Magnet, Maximize, Maximize2, Menu, Minimize2, Move,
  MoveDown, MoveUp, Plus, Redo, RotateCcw, RotateCw, Ruler, Save, ScanLine, Settings,
  ShieldCheck, Sparkles, Trash2, Undo, Unlock, X, ZoomIn, ZoomOut
} from 'lucide-react';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

const PAGE_PRESETS = {
  a4: { label: 'A4 Portrait', width: 600, height: 848 },
  a4landscape: { label: 'A4 Landscape', width: 848, height: 600 },
  letter: { label: 'Letter', width: 612, height: 792 },
  square: { label: 'Square', width: 800, height: 800 },
  phone: { label: 'Phone Portrait', width: 540, height: 960 },
  widescreen: { label: 'Widescreen', width: 960, height: 540 },
};

const uid = (prefix = 'id') => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const degToRad = (deg) => (deg * Math.PI) / 180;
const rotateVector = (x, y, degrees) => {
  const r = degToRad(degrees);
  return { x: x * Math.cos(r) - y * Math.sin(r), y: x * Math.sin(r) + y * Math.cos(r) };
};
const readFileAsDataURL = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = (e) => resolve(e.target.result);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const Button = ({ children, className = '', variant = 'ghost', disabled = false, ...props }) => {
  const styles = {
    ghost: 'bg-neutral-900 border border-neutral-800 text-neutral-300 hover:bg-neutral-800 hover:text-white',
    blue: 'bg-blue-600 hover:bg-blue-500 text-white border-blue-500',
    emerald: 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500',
    purple: 'bg-purple-600 hover:bg-purple-500 text-white border-purple-500',
    soft: 'bg-white/5 border border-white/10 text-neutral-300 hover:bg-white/10 hover:text-white',
    danger: 'bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20',
    white: 'bg-white hover:bg-neutral-200 text-black border-white',
    orange: 'bg-orange-600 hover:bg-orange-500 text-white border-orange-500',
  };
  return (
    <button disabled={disabled} className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-30 ${styles[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
};

const Toggle = ({ label, checked, onChange, icon: Icon }) => (
  <label className="flex items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-900/80 px-3 py-2.5 cursor-pointer select-none">
    <span className="flex items-center gap-2 text-xs text-neutral-300">{Icon && <Icon size={14} className="text-blue-400" />}{label}</span>
    <span className={`relative h-5 w-9 rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-neutral-700'}`}>
      <input type="checkbox" className="sr-only" checked={checked} onChange={onChange} />
      <span className={`absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full bg-white transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-1'}`} />
    </span>
  </label>
);

function drawRotationHandle(ctx, left, top) {
  const r = 15;
  ctx.save();
  ctx.translate(left, top);
  ctx.beginPath();
  ctx.fillStyle = '#0f172a';
  ctx.strokeStyle = '#00c3ff';
  ctx.lineWidth = 2;
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.arc(-1, 1, 6.5, degToRad(210), degToRad(35));
  ctx.stroke();
  ctx.beginPath();
  ctx.fillStyle = '#ffffff';
  ctx.moveTo(7, -4);
  ctx.lineTo(10, 1);
  ctx.lineTo(4.5, 1);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

const setupFabricDefaults = () => {
  fabric.Object.prototype.set({
    transparentCorners: false,
    cornerColor: '#ffffff',
    cornerStrokeColor: '#00c3ff',
    borderColor: '#00c3ff',
    cornerSize: 11,
    padding: 0,
    borderDashArray: [5, 5],
    lockUniScaling: true,
    centeredRotation: true,
    touchCornerSize: 34,
    cornerStyle: 'circle',
    targetFindTolerance: 12,
  });

  if (fabric.Object.prototype.controls?.mtr && fabric.Control) {
    const existing = fabric.Object.prototype.controls.mtr;
    existing.x = 0;
    existing.y = -0.5;
    existing.offsetY = -34;
    existing.cursorStyle = 'grab';
    existing.render = drawRotationHandle;
    existing.sizeX = 30;
    existing.sizeY = 30;
  }
};

const PageCanvas = ({
  page, pageIndex, totalPages, registerCanvas, onSetActive, activeCanvasId,
  moveUp, moveDown, deletePage, addLayer, mobilePageScale, onRequestTools
}) => {
  const canvasRef = useRef(null);
  const [canvas, setCanvas] = useState(null);
  const [dragReady, setDragReady] = useState(false);
  const [pageScale, setPageScale] = useState(mobilePageScale || 1);
  const pageW = page.width || 600;
  const pageH = page.height || 848;

  useEffect(() => {
    setupFabricDefaults();
    const cvs = new fabric.Canvas(canvasRef.current, {
      width: pageW,
      height: pageH,
      backgroundColor: '#ffffff',
      preserveObjectStacking: true,
      selection: true,
      stopContextMenu: true,
      fireRightClick: true,
    });

    cvs.snapEnabled = true;
    cvs.boundaryLock = true;
    cvs.angleSnapEnabled = true;
    cvs.angleSnapStep = 15;
    cvs.snapThreshold = 8;
    cvs._isRestoring = false;
    cvs._isCropping = false;
    cvs.history = [];
    cvs.redoStack = [];

    registerCanvas(page.id, cvs);

    const guides = [];
    const clearGuides = () => {
      guides.forEach((g) => cvs.remove(g));
      guides.length = 0;
    };
    const addGuide = (vertical, position) => {
      const exists = guides.some((g) => g.isGuide && g.guideAxis === (vertical ? 'x' : 'y') && g.guidePosition === position);
      if (exists) return;
      const line = vertical
        ? new fabric.Line([position, 0, position, pageH], { stroke: '#00c3ff', strokeWidth: 1, strokeDashArray: [6, 5], selectable: false, evented: false })
        : new fabric.Line([0, position, pageW, position], { stroke: '#00c3ff', strokeWidth: 1, strokeDashArray: [6, 5], selectable: false, evented: false });
      line.isGuide = true;
      line.guideAxis = vertical ? 'x' : 'y';
      line.guidePosition = position;
      line.excludeFromExport = true;
      cvs.add(line);
      guides.push(line);
    };

    const recordHistory = (e) => {
      if (cvs._isRestoring || cvs._isCropping || e?.target?.isGuide || e?.target?.cropEditor) return;
      cvs.history.push(cvs.toJSON(['lockUniScaling', 'isGuide', 'cropEditor']));
      if (cvs.history.length > 60) cvs.history.shift();
      cvs.redoStack = [];
      onSetActive(cvs, cvs.getActiveObject(), page.id);
    };

    cvs.on('object:added', recordHistory);
    cvs.on('object:modified', recordHistory);
    cvs.on('object:removed', recordHistory);
    cvs.history.push(cvs.toJSON(['lockUniScaling', 'isGuide', 'cropEditor']));

    cvs.undo = () => {
      if (cvs.history.length <= 1 || cvs._isCropping) return;
      cvs._isRestoring = true;
      cvs.redoStack.push(cvs.history.pop());
      const target = cvs.history[cvs.history.length - 1];
      cvs.loadFromJSON(target, () => {
        cvs.renderAll();
        cvs._isRestoring = false;
        onSetActive(cvs, cvs.getActiveObject(), page.id);
      });
    };

    cvs.redo = () => {
      if (!cvs.redoStack.length || cvs._isCropping) return;
      cvs._isRestoring = true;
      const target = cvs.redoStack.pop();
      cvs.history.push(target);
      cvs.loadFromJSON(target, () => {
        cvs.renderAll();
        cvs._isRestoring = false;
        onSetActive(cvs, cvs.getActiveObject(), page.id);
      });
    };

    const keepInsidePage = (obj) => {
      if (!obj || obj.isGuide || obj.cropEditor || !cvs.boundaryLock) return;
      const rect = obj.getBoundingRect(true, true);
      let dx = 0;
      let dy = 0;
      if (rect.left < 0) dx = -rect.left;
      if (rect.right > pageW) dx = pageW - rect.right;
      if (rect.top < 0) dy = -rect.top;
      if (rect.bottom > pageH) dy = pageH - rect.bottom;
      if (dx || dy) obj.set({ left: obj.left + dx, top: obj.top + dy });
      obj.setCoords();
    };

    const snapObject = (obj) => {
      if (!obj || obj.isGuide || obj.cropEditor || !cvs.snapEnabled) return;
      const threshold = cvs.snapThreshold;
      const rect = obj.getBoundingRect(true, true);
      const center = obj.getCenterPoint();
      let dx = 0;
      let dy = 0;

      if (Math.abs(rect.left) <= threshold) { dx = -rect.left; addGuide(true, 0); }
      else if (Math.abs(rect.right - pageW) <= threshold) { dx = pageW - rect.right; addGuide(true, pageW); }
      else if (Math.abs(center.x - pageW / 2) <= threshold) { dx = pageW / 2 - center.x; addGuide(true, pageW / 2); }

      if (Math.abs(rect.top) <= threshold) { dy = -rect.top; addGuide(false, 0); }
      else if (Math.abs(rect.bottom - pageH) <= threshold) { dy = pageH - rect.bottom; addGuide(false, pageH); }
      else if (Math.abs(center.y - pageH / 2) <= threshold) { dy = pageH / 2 - center.y; addGuide(false, pageH / 2); }

      const corners = [[0, 0], [pageW, 0], [0, pageH], [pageW, pageH]];
      const nearCorner = corners.find(([x, y]) => Math.hypot(center.x - x, center.y - y) <= threshold * 1.8);
      if (nearCorner) {
        dx = nearCorner[0] - center.x;
        dy = nearCorner[1] - center.y;
        addGuide(true, nearCorner[0]);
        addGuide(false, nearCorner[1]);
      }

      if (dx || dy) obj.set({ left: obj.left + dx, top: obj.top + dy });
      obj.setCoords();
    };

    cvs.on('object:moving', (e) => {
      clearGuides();
      snapObject(e.target);
      keepInsidePage(e.target);
      cvs.renderAll();
    });

    cvs.on('object:scaling', (e) => {
      const obj = e.target;
      if (obj?.type === 'image' && obj.lockUniScaling !== false) {
        const baseW = Math.max(0.0001, Math.abs(obj.scaleX || 1));
        const baseH = Math.max(0.0001, Math.abs(obj.scaleY || 1));
        const targetScale = Math.max(baseW, baseH);
        obj.set({ scaleX: Math.sign(obj.scaleX || 1) * targetScale, scaleY: Math.sign(obj.scaleY || 1) * targetScale });
      }
      clearGuides();
      snapObject(obj);
      keepInsidePage(obj);
      cvs.renderAll();
    });

    cvs.on('object:rotating', (e) => {
      const obj = e.target;
      if (!obj || !cvs.angleSnapEnabled || obj.cropEditor) return;
      const step = cvs.angleSnapStep || 15;
      const angle = ((obj.angle || 0) % 360 + 360) % 360;
      const snap = Math.round(angle / step) * step;
      const delta = Math.min(Math.abs(angle - snap), 360 - Math.abs(angle - snap));
      if (delta <= 4) obj.set('angle', snap >= 360 ? 0 : snap);
      keepInsidePage(obj);
      cvs.renderAll();
    });

    cvs.on('mouse:up', () => { clearGuides(); cvs.renderAll(); });
    cvs.on('selection:created', (e) => onSetActive(cvs, e.selected?.[0] || null, page.id));
    cvs.on('selection:updated', (e) => onSetActive(cvs, e.selected?.[0] || null, page.id));
    cvs.on('selection:cleared', () => onSetActive(cvs, null, page.id));

    if (page.initialImage) {
      fabric.Image.fromURL(page.initialImage, (img) => {
        if (!img) return;
        const scale = Math.min((pageW - 48) / img.width, (pageH - 48) / img.height, 1);
        img.set({ left: pageW / 2, top: pageH / 2, originX: 'center', originY: 'center', scaleX: scale, scaleY: scale, lockUniScaling: true });
        cvs.add(img);
        cvs.history[0] = cvs.toJSON(['lockUniScaling', 'isGuide', 'cropEditor']);
        cvs.renderAll();
      });
    }

    setCanvas(cvs);
    return () => {
      clearGuides();
      delete cvs._resizeObserver;
      cvs.dispose();
    };
  }, [page.id, page.initialImage, page.width, page.height]);

  useEffect(() => {
    const update = () => {
      const mobile = window.innerWidth < 768;
      const available = Math.max(220, window.innerWidth - (mobile ? 24 : 48));
      const scale = Math.min(1, available / pageW);
      setPageScale(scale);
      if (canvas) {
        canvas.setDimensions(
          { width: Math.round(pageW * scale), height: Math.round(pageH * scale) },
          { cssOnly: true }
        );
        canvas.renderAll();
      }
    };
    update();
    window.addEventListener('resize', update, { passive: true });
    return () => window.removeEventListener('resize', update);
  }, [canvas, pageW, pageH]);

  const handleAddLayer = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !canvas) return;
    const src = await readFileAsDataURL(file);
    fabric.Image.fromURL(src, (img) => {
      const scale = Math.min(320 / img.width, 320 / img.height, 1);
      img.set({ left: pageW / 2, top: pageH / 2, originX: 'center', originY: 'center', scaleX: scale, scaleY: scale, lockUniScaling: true });
      canvas.add(img);
      canvas.setActiveObject(img);
      canvas.renderAll();
    });
  };

  const active = activeCanvasId === page.id;
  const displayW = Math.round(pageW * pageScale);
  const displayH = Math.round(pageH * pageScale);

  return (
    <div className={`w-full max-w-[980px] flex flex-col items-center mb-10 ${active ? '' : 'opacity-90'}`}>
      <div className="w-full flex items-center justify-between gap-3 px-1 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <button
            className="text-neutral-500 hover:text-white touch-manipulation"
            title="Move page"
            onMouseDown={() => setDragReady(true)}
            onMouseUp={() => setDragReady(false)}
            draggable={dragReady}
            onDragStart={(e) => e.dataTransfer.setData('pageIndex', String(pageIndex))}
            onDragEnd={() => setDragReady(false)}
          >
            <GripHorizontal size={18} />
          </button>
          <span className="text-xs font-bold uppercase tracking-[.18em] text-neutral-500">Page {pageIndex + 1}</span>
          <span className="rounded-full border border-neutral-800 bg-neutral-900 px-2 py-1 text-[9px] text-neutral-500">
            {pageW === pageH ? '1:1' : pageW > pageH ? 'Landscape' : 'Portrait'}
          </span>
          <span className="hidden sm:inline text-[10px] text-neutral-700">{pageW} × {pageH}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <label className="hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 px-3 py-1.5 text-xs font-semibold cursor-pointer">
            <Plus size={14} /> Layer
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleAddLayer} />
          </label>
          <button className="sm:hidden p-2 rounded-lg bg-neutral-900 border border-neutral-800" onClick={() => onRequestTools(page.id)}><Settings size={15} /></button>
          <button className="p-2 rounded-lg hover:bg-neutral-900 text-neutral-400 disabled:opacity-30" onClick={() => moveUp(page.id)} disabled={pageIndex === 0}><ArrowUp size={15} /></button>
          <button className="p-2 rounded-lg hover:bg-neutral-900 text-neutral-400 disabled:opacity-30" onClick={() => moveDown(page.id)} disabled={pageIndex === totalPages - 1}><ArrowDown size={15} /></button>
          <button className="p-2 rounded-lg hover:bg-red-500/10 text-red-400" onClick={() => deletePage(page.id)}><Trash2 size={15} /></button>
        </div>
      </div>
      <div
        className={`relative rounded-sm overflow-visible select-none ${active ? 'ring-2 ring-blue-500/70 shadow-[0_20px_80px_rgba(0,130,255,.18)]' : 'ring-1 ring-neutral-800 shadow-2xl'}`}
        style={{ width: displayW, height: displayH, maxWidth: '100%', touchAction: 'none' }}
        onMouseDown={() => onSetActive(canvas, canvas?.getActiveObject() || null, page.id)}
        onTouchStart={() => onSetActive(canvas, canvas?.getActiveObject() || null, page.id)}
      >
        <canvas
          ref={canvasRef}
          style={{ display: 'block', width: `${displayW}px`, height: `${displayH}px`, maxWidth: '100%', touchAction: 'none' }}
        />
      </div>
    </div>
  );
};

const CropOverlay = ({ ratio, setRatio, onApply, onCancel }) => (
  <div className="fixed inset-x-0 bottom-0 z-[80] border-t border-blue-500/20 bg-[#101317]/95 backdrop-blur-xl px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))] shadow-2xl">
    <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Crop size={18} className="text-blue-400" />
        <span className="text-sm font-semibold">Crop mode</span>
        <span className="hidden sm:inline text-xs text-neutral-500">Drag the frame, resize the corners, then apply.</span>
      </div>
      <div className="flex items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-1">
        {['free', '1:1', '4:5', '16:9'].map((r) => (
          <button key={r} onClick={() => setRatio(r)} className={`rounded-md px-2.5 py-1.5 text-[11px] font-bold ${ratio === r ? 'bg-blue-600 text-white' : 'text-neutral-400 hover:bg-neutral-800'}`}>{r === 'free' ? 'Free' : r}</button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={onCancel} variant="ghost"><X size={15} /> Cancel</Button>
        <Button onClick={onApply} variant="blue"><Check size={15} /> Apply Crop</Button>
      </div>
    </div>
  </div>
);

export default function App() {
  const [appMode, setAppMode] = useState('customisable');
  const [pagePreset, setPagePreset] = useState('a4');
  const [pages, setPages] = useState(() => [{ id: uid('page'), initialImage: null, ...PAGE_PRESETS.a4 }]);
  const canvasRefs = useRef({});
  const [activeCanvas, setActiveCanvas] = useState(null);
  const [activeCanvasId, setActiveCanvasId] = useState(null);
  const [activeObject, setActiveObject] = useState(null);
  const [historyTick, setHistoryTick] = useState(0);
  const [workspaceZoom, setWorkspaceZoom] = useState(1);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);

  const [autoFitImages, setAutoFitImages] = useState([]);
  const [pdfImages, setPdfImages] = useState([]);
  const [pdfExportFormat, setPdfExportFormat] = useState('image/png');
  const [isPdfConverting, setIsPdfConverting] = useState(false);

  const [mergeFiles, setMergeFiles] = useState([]);
  const [mergeBusy, setMergeBusy] = useState(false);

  const [fileName, setFileName] = useState(`BPDF_${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`);
  const [cropRatio, setCropRatio] = useState('free');
  const cropSessionRef = useRef(null);
  const dragItem = useRef(null);

  
  const onSetActive = (canvasObj, obj, pageId) => {
    setActiveCanvas(canvasObj || null);
    setActiveObject(obj || null);
    setActiveCanvasId(pageId || null);
    setHistoryTick((x) => x + 1);
  };

  const registerCanvas = (id, canvas) => { canvasRefs.current[id] = canvas; };

  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      if (cropSessionRef.current) {
        if (e.key === 'Escape') { e.preventDefault(); cancelCrop(); }
        return;
      }
      if (!activeCanvas) return;
      const imageUnlocked = activeObject && !activeObject.lockMovementX;
      if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); activeCanvas.undo?.(); return; }
      if (e.ctrlKey && e.key.toLowerCase() === 'y') { e.preventDefault(); activeCanvas.redo?.(); return; }
      if (e.ctrlKey && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); return; }
      if (e.key === 'Delete' && imageUnlocked) { e.preventDefault(); deleteSelected(); return; }
      if (imageUnlocked && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        activeObject.top += e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
        activeObject.left += e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
        activeCanvas.fire('object:moving', { target: activeObject });
        activeCanvas.renderAll();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeCanvas, activeObject]);

  const handleCustomImport = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    const preset = PAGE_PRESETS[pagePreset];
    const incoming = await Promise.all(files.map(async (file) => ({ id: uid('page'), initialImage: await readFileAsDataURL(file), ...preset })));
    setPages((prev) => {
      const first = prev[0] && canvasRefs.current[prev[0].id];
      if (prev.length === 1 && first && first.getObjects().length === 0) return incoming;
      return [...prev, ...incoming];
    });
  };

  const addBlankPage = () => setPages((prev) => [...prev, { id: uid('page'), initialImage: null, ...PAGE_PRESETS[pagePreset] }]);
  const deletePage = (id) => {
    if (pages.length === 1) return alert('You need at least one page.');
    setPages((prev) => prev.filter((p) => p.id !== id));
    delete canvasRefs.current[id];
  };
  const movePage = (id, direction) => {
    setPages((prev) => {
      const list = [...prev];
      const idx = list.findIndex((p) => p.id === id);
      const next = idx + direction;
      if (idx < 0 || next < 0 || next >= list.length) return list;
      [list[idx], list[next]] = [list[next], list[idx]];
      return list;
    });
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
    if (!activeObject || !activeCanvas || activeObject.lockMovementX || cropSessionRef.current) return;
    activeCanvas.remove(activeObject);
    activeCanvas.discardActiveObject();
    activeCanvas.renderAll();
    setActiveObject(null);
  };

  const duplicateSelected = () => {
    if (!activeObject || !activeCanvas || activeObject.lockMovementX || cropSessionRef.current) return;
    activeObject.clone((copy) => {
      copy.set({ left: activeObject.left + 20, top: activeObject.top + 20 });
      activeCanvas.add(copy);
      activeCanvas.setActiveObject(copy);
      activeCanvas.renderAll();
    });
  };

  const toggleLock = () => {
    if (!activeObject || !activeCanvas || cropSessionRef.current) return;
    const locked = !!activeObject.lockMovementX;
    activeObject.set({
      lockMovementX: !locked, lockMovementY: !locked,
      lockScalingX: !locked, lockScalingY: !locked,
      lockRotation: !locked, hasControls: locked,
      borderColor: locked ? '#00c3ff' : '#8b8b8b',
      cornerColor: locked ? '#ffffff' : '#8b8b8b',
    });
    activeCanvas.renderAll();
    activeCanvas.fire('object:modified', { target: activeObject });
    setActiveObject(activeCanvas.getActiveObject());
  };

  const toggleAspectRatio = () => {
    if (!activeObject || activeObject.type !== 'image') return;
    activeObject.set('lockUniScaling', activeObject.lockUniScaling === false);
    activeCanvas.renderAll();
    activeCanvas.fire('object:modified', { target: activeObject });
    setActiveObject(activeCanvas.getActiveObject());
  };

  const setProperty = (property, raw) => {
    if (!activeObject || !activeCanvas || activeObject.lockMovementX || cropSessionRef.current) return;
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    if (property === 'angle') activeObject.set('angle', value);
    if (property === 'opacity') activeObject.set('opacity', clamp(value, 0, 100) / 100);
    if (property === 'left') activeObject.set('left', value);
    if (property === 'top') activeObject.set('top', value);
    if (property === 'width' && activeObject.width) {
      const scale = value / activeObject.width;
      activeObject.set({ scaleX: scale });
      if (activeObject.type === 'image' && activeObject.lockUniScaling !== false) activeObject.set({ scaleY: scale });
    }
    if (property === 'height' && activeObject.height) {
      const scale = value / activeObject.height;
      activeObject.set({ scaleY: scale });
      if (activeObject.type === 'image' && activeObject.lockUniScaling !== false) activeObject.set({ scaleX: scale });
    }
    activeObject.setCoords();
    activeCanvas.renderAll();
  };

  const alignActive = (mode) => {
    if (!activeObject || !activeCanvas || activeObject.lockMovementX) return;
    const rect = activeObject.getBoundingRect(true, true);
    const center = activeObject.getCenterPoint();
    if (mode === 'left') activeObject.left += -rect.left;
    if (mode === 'right') activeObject.left += activeCanvas.width - rect.right;
    if (mode === 'centerH') activeObject.left += activeCanvas.width / 2 - center.x;
    if (mode === 'top') activeObject.top += -rect.top;
    if (mode === 'bottom') activeObject.top += activeCanvas.height - rect.bottom;
    if (mode === 'centerV') activeObject.top += activeCanvas.height / 2 - center.y;
    activeObject.setCoords();
    activeCanvas.renderAll();
    activeCanvas.fire('object:modified', { target: activeObject });
  };

  const fitActive = (cover = false) => {
    if (!activeObject || !activeCanvas || activeObject.lockMovementX || !activeObject.width || !activeObject.height) return;
    const margin = 18;
    const sx = (activeCanvas.width - margin * 2) / activeObject.width;
    const sy = (activeCanvas.height - margin * 2) / activeObject.height;
    const scale = cover ? Math.max(sx, sy) : Math.min(sx, sy);
    activeObject.set({ left: activeCanvas.width / 2, top: activeCanvas.height / 2, scaleX: scale, scaleY: scale, originX: 'center', originY: 'center' });
    activeObject.setCoords();
    activeCanvas.renderAll();
    activeCanvas.fire('object:modified', { target: activeObject });
  };

  const startCrop = () => {
    if (!activeObject || activeObject.type !== 'image' || !activeCanvas || activeObject.lockMovementX || cropSessionRef.current) return;
    if (activeObject.clipPath) return alert('This image already has a crop applied.');
    const image = activeObject;
    activeCanvas._isCropping = true;
    activeCanvas.discardActiveObject();
    image.selectable = false;
    image.evented = false;
    const rect = new fabric.Rect({
      left: image.left, top: image.top,
      width: Math.max(32, image.getScaledWidth()), height: Math.max(32, image.getScaledHeight()),
      originX: 'center', originY: 'center', angle: image.angle || 0,
      fill: 'rgba(0,195,255,.06)', stroke: '#00c3ff', strokeWidth: 2,
      strokeDashArray: [7, 5], cornerColor: '#ffffff', cornerStrokeColor: '#00c3ff', cornerSize: 12,
      lockRotation: true, hasRotatingPoint: false, cropEditor: true, excludeFromExport: true,
    });
    const session = { canvas: activeCanvas, image, rect };
    cropSessionRef.current = session;
    setCropRatio('free');

    const clampRect = () => {
      const imgW = Math.abs(image.getScaledWidth());
      const imgH = Math.abs(image.getScaledHeight());
      const rw = Math.min(rect.getScaledWidth(), imgW);
      const rh = Math.min(rect.getScaledHeight(), imgH);
      rect.scaleX = rw / rect.width;
      rect.scaleY = rh / rect.height;
      const ic = image.getCenterPoint();
      const rc = rect.getCenterPoint();
      const delta = rotateVector(rc.x - ic.x, rc.y - ic.y, -(image.angle || 0));
      const lx = clamp(delta.x, -(imgW - rw) / 2, (imgW - rw) / 2);
      const ly = clamp(delta.y, -(imgH - rh) / 2, (imgH - rh) / 2);
      const corrected = rotateVector(lx, ly, image.angle || 0);
      rect.setPositionByOrigin(new fabric.Point(ic.x + corrected.x, ic.y + corrected.y), 'center', 'center');
      rect.setCoords();
      activeCanvas.renderAll();
    };

    rect.on('moving', clampRect);
    rect.on('scaling', clampRect);
    activeCanvas.add(rect);
    activeCanvas.setActiveObject(rect);
    activeCanvas.renderAll();
  };

  const applyCrop = () => {
    const s = cropSessionRef.current;
    if (!s) return;
    const { image, rect, canvas } = s;
    const imageCenter = image.getCenterPoint();
    const cropCenter = rect.getCenterPoint();
    const deltaCanvas = { x: cropCenter.x - imageCenter.x, y: cropCenter.y - imageCenter.y };
    const deltaLocal = rotateVector(deltaCanvas.x, deltaCanvas.y, -(image.angle || 0));
    const sx = Math.max(.0001, Math.abs(image.scaleX || 1));
    const sy = Math.max(.0001, Math.abs(image.scaleY || 1));
    const cropW = rect.getScaledWidth() / sx;
    const cropH = rect.getScaledHeight() / sy;
    const cropCX = image.width / 2 + (deltaLocal.x / sx) * (image.flipX ? -1 : 1);
    const cropCY = image.height / 2 + (deltaLocal.y / sy) * (image.flipY ? -1 : 1);
    const cropX = clamp((image.cropX || 0) + cropCX - cropW / 2, 0, Math.max(0, (image.cropX || 0) + image.width - cropW));
    const cropY = clamp((image.cropY || 0) + cropCY - cropH / 2, 0, Math.max(0, (image.cropY || 0) + image.height - cropH));

    image.set({ width: cropW, height: cropH, cropX, cropY, left: cropCenter.x, top: cropCenter.y, clipPath: null, selectable: true, evented: true });
    image.setCoords();
    canvas.remove(rect);
    canvas._isCropping = false;
    canvas.setActiveObject(image);
    canvas.renderAll();
    canvas.fire('object:modified', { target: image });
    cropSessionRef.current = null;
    setActiveObject(image);
  };

  const cancelCrop = () => {
    const s = cropSessionRef.current;
    if (!s) return;
    s.image.selectable = true;
    s.image.evented = true;
    s.canvas.remove(s.rect);
    s.canvas._isCropping = false;
    s.canvas.setActiveObject(s.image);
    s.canvas.renderAll();
    cropSessionRef.current = null;
    setActiveObject(s.image);
  };

  const setCropAspect = (ratio) => {
    setCropRatio(ratio);
    const s = cropSessionRef.current;
    if (!s || ratio === 'free') return;
    const numeric = ratio === '1:1' ? 1 : ratio === '4:5' ? 4 / 5 : 16 / 9;
    const maxW = Math.abs(s.image.getScaledWidth()) * .96;
    const maxH = Math.abs(s.image.getScaledHeight()) * .96;
    let w = s.rect.getScaledWidth();
    let h = w / numeric;
    if (h > maxH) { h = maxH; w = h * numeric; }
    if (w > maxW) { w = maxW; h = w / numeric; }
    s.rect.set({ scaleX: w / s.rect.width, scaleY: h / s.rect.height });
    s.rect.setCoords();
  };

  const exportCustomPDF = async () => {
    if (cropSessionRef.current) return alert('Apply or cancel the current crop first.');
    if (!pages.length) return;
    const first = pages[0];
    const pdf = new jsPDF({ orientation: first.width > first.height ? 'landscape' : 'portrait', unit: 'px', format: [first.width, first.height], compress: true });
    pages.forEach((page, idx) => {
      const cvs = canvasRefs.current[page.id];
      if (!cvs) return;
      if (idx > 0) pdf.addPage([page.width, page.height], page.width > page.height ? 'landscape' : 'portrait');
      pdf.addImage(cvs.toDataURL({ format: 'jpeg', multiplier: 2.5, quality: .96 }), 'JPEG', 0, 0, page.width, page.height, undefined, 'FAST');
    });
    pdf.save(`${fileName || 'BareenaPDFs'}.pdf`);
  };

  const handleAutoFitImport = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    const newImages = await Promise.all(files.map(async (file) => {
      const src = await readFileAsDataURL(file);
      return await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ id: uid('auto'), src, width: img.width, height: img.height, hasMargin: false });
        img.src = src;
      });
    }));
    setAutoFitImages((prev) => [...prev, ...newImages]);
  };

  const exportAutoFitPDF = async () => {
    if (!autoFitImages.length) return alert('Upload some images first.');
    const loaded = await Promise.all(autoFitImages.map((item) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.src = item.src;
    })));
    let pdf = null;
    loaded.forEach((img, idx) => {
      const item = autoFitImages[idx];
      const landscape = item.width > item.height;
      const format = landscape ? [848, 600] : [600, 848];
      const orientation = landscape ? 'landscape' : 'portrait';
      if (!pdf) pdf = new jsPDF({ orientation, unit: 'px', format, compress: true });
      else pdf.addPage(format, orientation);
      const margin = item.hasMargin ? 14 : 0;
      const aw = format[0] - margin * 2;
      const ah = format[1] - margin * 2;
      const scale = Math.min(aw / item.width, ah / item.height);
      const w = item.width * scale;
      const h = item.height * scale;
      pdf.addImage(img, 'JPEG', margin + (aw - w) / 2, margin + (ah - h) / 2, w, h, undefined, 'FAST');
    });
    pdf.save(`${fileName || 'BareenaPDFs'}_AutoFit.pdf`);
  };

  const handlePdfToImageUpload = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setIsPdfConverting(true);
    setFileName(file.name.replace(/\.pdf$/i, ''));
    try {
      const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      const result = [];
      for (let i = 1; i <= pdf.numPages; i += 1) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2 });
        const c = document.createElement('canvas');
        c.width = Math.ceil(viewport.width); c.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: c.getContext('2d'), viewport }).promise;
        result.push({ id: uid('pdfimg'), pageNum: i, dataUrl: c.toDataURL('image/png') });
      }
      setPdfImages(result);
    } catch (err) {
      console.error(err);
      alert('Could not read that PDF.');
    } finally {
      setIsPdfConverting(false);
    }
  };

  const downloadPdfImage = (dataUrl, pageNum) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d');
      if (pdfExportFormat === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
      ctx.drawImage(img, 0, 0);
      const extension = pdfExportFormat === 'image/jpeg' ? 'jpg' : 'png';
      const a = document.createElement('a');
      a.href = c.toDataURL(pdfExportFormat, .95);
      a.download = `${fileName || 'BareenaPDFs'}_Page_${pageNum}.${extension}`;
      a.click();
    };
    img.src = dataUrl;
  };

  const downloadAllImages = () => pdfImages.forEach((p, i) => setTimeout(() => downloadPdfImage(p.dataUrl, p.pageNum), i * 250));

  const handleMergeUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setMergeBusy(true);
    try {
      const incoming = [];
      for (const file of files) {
        const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        const pagesOut = [];
        for (let i = 1; i <= pdf.numPages; i += 1) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1.35 });
          const c = document.createElement('canvas');
          c.width = Math.ceil(viewport.width); c.height = Math.ceil(viewport.height);
          await page.render({ canvasContext: c.getContext('2d'), viewport }).promise;
          pagesOut.push({ id: uid('mergepage'), pageNum: i, dataUrl: c.toDataURL('image/jpeg', .9), width: page.view[2] - page.view[0], height: page.view[3] - page.view[1] });
        }
        incoming.push({ id: uid('merge'), name: file.name, size: file.size, pages: pagesOut });
      }
      setMergeFiles((prev) => [...prev, ...incoming]);
      setFileName(files.length === 1 ? files[0].name.replace(/\.pdf$/i, '') + '_Combined' : 'Combined_PDF');
    } catch (err) {
      console.error(err);
      alert('One of those PDF files could not be read.');
    } finally {
      setMergeBusy(false);
    }
  };

  const removeMergeFile = (id) => setMergeFiles((prev) => prev.filter((x) => x.id !== id));
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
    setMergeFiles((prev) => {
      const list = [...prev];
      const item = list.splice(from, 1)[0];
      list.splice(to, 0, item);
      return list;
    });
  };

  const combinePDFs = async () => {
    if (!mergeFiles.length) return alert('Add at least one PDF.');
    setMergeBusy(true);
    try {
      let pdf = null;
      let pageCount = 0;
      for (const file of mergeFiles) {
        for (const page of file.pages) {
          const format = [page.width, page.height];
          const orientation = page.width > page.height ? 'landscape' : 'portrait';
          if (!pdf) pdf = new jsPDF({ orientation, unit: 'pt', format, compress: true });
          else pdf.addPage(format, orientation);
          pdf.addImage(page.dataUrl, 'JPEG', 0, 0, page.width, page.height, undefined, 'FAST');
          pageCount += 1;
        }
      }
      if (pdf) pdf.save(`${fileName || 'Combined_PDF'}.pdf`);
      alert(`Combined ${pageCount} page${pageCount === 1 ? '' : 's'}.`);
    } catch (err) {
      console.error(err);
      alert('Could not combine these PDFs.');
    } finally {
      setMergeBusy(false);
    }
  };

  const activeWidth = activeObject?.width ? Math.round(Math.abs(activeObject.width * (activeObject.scaleX || 1))) : 0;
  const activeHeight = activeObject?.height ? Math.round(Math.abs(activeObject.height * (activeObject.scaleY || 1))) : 0;
  const activeAngle = Math.round(activeObject?.angle || 0);
  const canUndo = !!(activeCanvas?.history?.length > 1) && !cropSessionRef.current;
  const canRedo = !!(activeCanvas?.redoStack?.length) && !cropSessionRef.current;
  const totalMergePages = useMemo(() => mergeFiles.reduce((sum, f) => sum + f.pages.length, 0), [mergeFiles]);

  const switchMode = (mode) => {
    if (cropSessionRef.current) cancelCrop();
    setAppMode(mode);
    setMobilePanelOpen(false);
  };

  const modes = [
    { id: 'customisable', label: 'Studio', icon: LayoutTemplate, color: 'blue', desc: 'Edit pages and layers' },
    { id: 'autofit', label: 'Auto-Fit', icon: Maximize, color: 'emerald', desc: 'Place images cleanly' },
    { id: 'pdf2img', label: 'PDF to Image', icon: FileImage, color: 'purple', desc: 'Export PDF pages' },
    { id: 'merge', label: 'Merge PDFs', icon: FilePlus2, color: 'orange', desc: 'Combine documents' },
  ];

  return (
    <>
      <style>{`
        html, body, #root { width: 100%; min-width: 0; margin: 0; }
        * { -webkit-tap-highlight-color: transparent; }
        button, label, select, input { touch-action: manipulation; }
        @media (max-width: 767px) { body { overflow-x: hidden; } }
      `}</style>
      <div className="min-h-screen w-full overflow-x-hidden bg-[#08090b] text-neutral-200 font-sans">
      {/* Desktop left rail */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-50 w-[282px] flex-col border-r border-neutral-800/90 bg-[#101114]/95 backdrop-blur-xl">
        <div className="px-5 pt-6 pb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2"><div className="h-8 w-8 rounded-xl bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center shadow-lg"><Sparkles size={16} /></div><h1 className="text-xl font-black tracking-tight text-white">BareenaPDFs</h1></div>
              <p className="mt-2 text-[10px] uppercase tracking-[.22em] text-neutral-500">made by ariz · document studio</p>
            </div>
          </div>
        </div>

        <div className="px-4 space-y-1.5">
          {modes.map((m) => {
            const Icon = m.icon;
            const active = appMode === m.id;
            return <button key={m.id} onClick={() => switchMode(m.id)} className={`w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left transition-all ${active ? 'bg-white/5 ring-1 ring-white/10 shadow-lg' : 'hover:bg-white/[.04]'}`}>
              <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${active ? 'bg-blue-600 text-white' : 'bg-neutral-900 text-neutral-500'}`}><Icon size={17} /></div>
              <div className="min-w-0"><div className="text-sm font-semibold text-white">{m.label}</div><div className="text-[10px] text-neutral-500 truncate">{m.desc}</div></div>
            </button>;
          })}
        </div>

        <div className="px-4 mt-5">
          {appMode === 'customisable' && (
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-3 space-y-3">
              <div className="flex gap-2">
                <Button className="flex-1" disabled={!canUndo} onClick={() => activeCanvas?.undo()}><Undo size={15} /> Undo</Button>
                <Button className="flex-1" disabled={!canRedo} onClick={() => activeCanvas?.redo()}><Redo size={15} /> Redo</Button>
              </div>
              <label className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white px-3 py-3 text-sm font-semibold cursor-pointer shadow-lg shadow-blue-900/20"><FolderOpen size={17} /> Import Images<input type="file" multiple accept="image/*" className="hidden" onChange={handleCustomImport} /></label>
              <select value={pagePreset} onChange={(e) => setPagePreset(e.target.value)} className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-xs text-neutral-300 outline-none">
                {Object.entries(PAGE_PRESETS).map(([key, v]) => <option key={key} value={key}>{v.label} · {v.width}×{v.height}</option>)}
              </select>
              <Button className="w-full" onClick={addBlankPage}><Plus size={15} /> Add Blank Page</Button>
            </div>
          )}
          {appMode === 'autofit' && <label className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-3 text-sm font-semibold cursor-pointer"><FolderOpen size={17} /> Upload Images<input type="file" multiple accept="image/*" className="hidden" onChange={handleAutoFitImport} /></label>}
          {appMode === 'pdf2img' && <label className={`flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold cursor-pointer ${isPdfConverting ? 'bg-purple-900 text-purple-300' : 'bg-purple-600 hover:bg-purple-500 text-white'}`}>{isPdfConverting ? <Loader2 size={17} className="animate-spin" /> : <FileText size={17} />}{isPdfConverting ? 'Converting…' : 'Upload PDF'}<input type="file" accept="application/pdf" className="hidden" disabled={isPdfConverting} onChange={handlePdfToImageUpload} /></label>}
          {appMode === 'merge' && <label className={`flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold cursor-pointer ${mergeBusy ? 'bg-orange-900 text-orange-300' : 'bg-orange-600 hover:bg-orange-500 text-white'}`}>{mergeBusy ? <Loader2 size={17} className="animate-spin" /> : <FilePlus2 size={17} />}{mergeBusy ? 'Reading PDFs…' : 'Add PDF Files'}<input type="file" multiple accept="application/pdf" className="hidden" disabled={mergeBusy} onChange={handleMergeUpload} /></label>}
        </div>

        <div className="mt-auto border-t border-neutral-800 p-4">
          <label className="block text-[10px] uppercase tracking-[.18em] text-neutral-500 mb-2">Output name</label>
          <input value={fileName} onChange={(e) => setFileName(e.target.value)} className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500/60" />
          <div className="mt-2 text-[10px] text-neutral-600 flex items-center gap-1.5"><ShieldCheck size={12} /> Files stay in your browser during editing.</div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-[70] border-b border-neutral-800/90 bg-[#0e0f12]/95 backdrop-blur-xl px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0"><div className="h-8 w-8 shrink-0 rounded-xl bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center"><Sparkles size={16} /></div><div className="min-w-0"><div className="font-black text-white text-sm truncate">BareenaPDFs</div><div className="text-[9px] uppercase tracking-widest text-neutral-600">document studio</div></div></div>
          <div className="flex items-center gap-1">
            <select value={appMode} onChange={(e) => switchMode(e.target.value)} className="max-w-[142px] rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-2 text-[11px] text-neutral-300 outline-none">
              {modes.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            {appMode === 'customisable' && <button onClick={() => setMobilePanelOpen((x) => !x)} className="p-2 rounded-lg bg-neutral-900 border border-neutral-800"><Menu size={17} /></button>}
          </div>
        </div>
      </header>

      <main className={`w-full min-w-0 lg:pl-[282px] min-h-screen ${activeObject && appMode === 'customisable' ? 'xl:pr-[310px]' : ''}`}>
        {/* workspace top bar */}
        <div className="sticky top-0 lg:top-0 z-40 border-b border-neutral-800/80 bg-[#0b0c0f]/92 backdrop-blur-xl px-3 sm:px-5 py-2.5">
          <div className="mx-auto max-w-[1500px] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <div className="hidden sm:block text-xs text-neutral-500">Workspace</div>
              <ChevronDown size={13} className="hidden sm:block text-neutral-700" />
              <div className="text-sm font-semibold text-white truncate">{modes.find((m) => m.id === appMode)?.label}</div>
              {appMode === 'customisable' && <span className="hidden md:inline text-[10px] text-neutral-600">{pages.length} page{pages.length === 1 ? '' : 's'}</span>}
              {appMode === 'merge' && <span className="hidden md:inline text-[10px] text-neutral-600">{mergeFiles.length} file{mergeFiles.length === 1 ? '' : 's'} · {totalMergePages} pages</span>}
            </div>
            <div className="flex items-center gap-1.5">
              {appMode === 'customisable' && <>
                <button onClick={() => setWorkspaceZoom((z) => clamp(z - .1, .5, 1.35))} className="p-2 rounded-lg hover:bg-neutral-900 text-neutral-400"><ZoomOut size={16} /></button>
                <span className="w-10 text-center text-[10px] text-neutral-500">{Math.round(workspaceZoom * 100)}%</span>
                <button onClick={() => setWorkspaceZoom((z) => clamp(z + .1, .5, 1.35))} className="p-2 rounded-lg hover:bg-neutral-900 text-neutral-400"><ZoomIn size={16} /></button>
              </>}
              <button onClick={() => setFileName((x) => x.trim() || 'BareenaPDFs')} className="hidden sm:inline-flex p-2 rounded-lg hover:bg-neutral-900 text-neutral-400" title="Keep filename"><Save size={16} /></button>
            </div>
          </div>
        </div>

        <div className="lg:hidden border-b border-neutral-800/80 bg-[#0c0d10] px-3 py-2.5 overflow-x-auto">
          <div className="flex items-center gap-2 min-w-max">
            {appMode === 'customisable' && <>
              <label className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-[11px] font-semibold text-white cursor-pointer"><FolderOpen size={14} /> Import<input type="file" multiple accept="image/*" className="hidden" onChange={handleCustomImport} /></label>
              <Button onClick={addBlankPage}><Plus size={14} /> Page</Button>
              <select value={pagePreset} onChange={(e) => setPagePreset(e.target.value)} className="rounded-xl border border-neutral-800 bg-neutral-900 px-2.5 py-2 text-[10px] text-neutral-300 outline-none">{Object.entries(PAGE_PRESETS).map(([key, v]) => <option key={key} value={key}>{v.label}</option>)}</select>
              <Button disabled={!canUndo} onClick={() => activeCanvas?.undo()}><Undo size={14} /></Button>
              <Button disabled={!canRedo} onClick={() => activeCanvas?.redo()}><Redo size={14} /></Button>
            </>}
            {appMode === 'autofit' && <label className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-[11px] font-semibold text-white cursor-pointer"><FolderOpen size={14} /> Upload images<input type="file" multiple accept="image/*" className="hidden" onChange={handleAutoFitImport} /></label>}
            {appMode === 'pdf2img' && <label className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-3 py-2 text-[11px] font-semibold text-white cursor-pointer"><FileText size={14} /> Upload PDF<input type="file" accept="application/pdf" className="hidden" onChange={handlePdfToImageUpload} /></label>}
            {appMode === 'merge' && <label className="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-3 py-2 text-[11px] font-semibold text-white cursor-pointer"><FilePlus2 size={14} /> Add PDFs<input type="file" multiple accept="application/pdf" className="hidden" disabled={mergeBusy} onChange={handleMergeUpload} /></label>}
          </div>
        </div>

        {appMode === 'customisable' && (
          <section className="min-h-[calc(100vh-49px)] overflow-auto bg-[#07080a] px-3 sm:px-5 lg:px-10 py-5 sm:py-8">
            <div className="mx-auto max-w-[1180px]" style={{ zoom: workspaceZoom }}>
              {pages.map((page, index) => (
                <PageCanvas key={page.id} page={page} pageIndex={index} totalPages={pages.length} registerCanvas={registerCanvas} onSetActive={onSetActive} activeCanvasId={activeCanvasId} moveUp={(id) => movePage(id, -1)} moveDown={(id) => movePage(id, 1)} deletePage={deletePage} addLayer={() => {}} onRequestTools={() => setMobilePanelOpen(true)} />
              ))}
              <button onClick={addBlankPage} className="mx-auto mb-16 flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900/70 px-4 py-2.5 text-xs font-medium text-neutral-400 hover:text-white hover:border-neutral-700"><Plus size={14} /> Add blank page</button>
            </div>
          </section>
        )}

        {appMode === 'autofit' && (
          <section className="min-h-[calc(100vh-49px)] overflow-auto bg-[#07080a] px-3 sm:px-6 lg:px-10 py-6 sm:py-10">
            {autoFitImages.length === 0 ? (
              <div className="min-h-[65vh] flex flex-col items-center justify-center text-center text-neutral-500"><Maximize size={54} className="opacity-20 mb-4" /><h2 className="text-lg font-semibold text-neutral-300">Drop in your images</h2><p className="mt-2 max-w-sm text-xs leading-relaxed">Each image gets its own clean page, with optional margins and automatic orientation.</p><label className="mt-5 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white cursor-pointer">Upload images<input type="file" multiple accept="image/*" className="hidden" onChange={handleAutoFitImport} /></label></div>
            ) : (
              <div className="mx-auto max-w-5xl space-y-9">
                {autoFitImages.map((item, idx) => {
                  const landscape = item.width > item.height;
                  const w = landscape ? 848 : 600;
                  const h = landscape ? 600 : 848;
                  return <div key={item.id} className="rounded-2xl border border-neutral-800/90 bg-[#0f1013] p-3 sm:p-5 shadow-2xl">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                      <div className="flex items-center gap-2"><GripHorizontal size={16} className="text-neutral-600" /><span className="text-xs font-bold uppercase tracking-[.18em] text-neutral-400">Page {idx + 1}</span><span className="rounded-full bg-neutral-900 border border-neutral-800 px-2 py-1 text-[9px] uppercase tracking-wider text-neutral-500">{landscape ? 'Landscape' : 'Portrait'}</span></div>
                      <div className="flex items-center gap-1.5"><label className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-2 text-[10px] text-neutral-400"><input type="checkbox" checked={item.hasMargin} onChange={() => setAutoFitImages((prev) => prev.map((x) => x.id === item.id ? { ...x, hasMargin: !x.hasMargin } : x))} className="accent-emerald-500" /> 5mm margin</label><button onClick={() => setAutoFitImages((prev) => prev.filter((x) => x.id !== item.id))} className="p-2 rounded-lg text-red-400 hover:bg-red-500/10"><Trash2 size={15} /></button></div>
                    </div>
                    <div className="bg-white rounded-xl overflow-hidden border border-white/5 flex justify-center" style={{ minHeight: Math.min(540, h * .7) }}><img src={item.src} alt="" className="max-w-full max-h-[70vh] object-contain" style={{ padding: item.hasMargin ? 18 : 0 }} /></div>
                  </div>;
                })}
              </div>
            )}
          </section>
        )}

        {appMode === 'pdf2img' && (
          <section className="min-h-[calc(100vh-49px)] overflow-auto bg-[#07080a] px-3 sm:px-6 lg:px-10 py-6 sm:py-10">
            <div className="mx-auto max-w-6xl">
              {pdfImages.length === 0 ? <div className="min-h-[65vh] flex flex-col items-center justify-center text-center text-neutral-500"><FileText size={54} className="opacity-20 mb-4" /><h2 className="text-lg font-semibold text-neutral-300">Turn a PDF into page images</h2><p className="mt-2 max-w-md text-xs leading-relaxed">Upload once and every page appears here as a high-resolution preview you can save individually or all at once.</p><label className="mt-5 inline-flex items-center gap-2 rounded-xl bg-purple-600 px-4 py-3 text-sm font-semibold text-white cursor-pointer">Upload PDF<input type="file" accept="application/pdf" className="hidden" onChange={handlePdfToImageUpload} /></label></div> : <>
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold text-white">Page images</h2><p className="text-xs text-neutral-500 mt-1">{pdfImages.length} exported pages ready.</p></div><div className="flex items-center gap-2"><div className="flex rounded-lg border border-neutral-800 bg-neutral-900 p-1"><button onClick={() => setPdfExportFormat('image/png')} className={`rounded-md px-3 py-1.5 text-[11px] font-bold ${pdfExportFormat === 'image/png' ? 'bg-purple-600 text-white' : 'text-neutral-500'}`}>PNG</button><button onClick={() => setPdfExportFormat('image/jpeg')} className={`rounded-md px-3 py-1.5 text-[11px] font-bold ${pdfExportFormat === 'image/jpeg' ? 'bg-purple-600 text-white' : 'text-neutral-500'}`}>JPEG</button></div><Button variant="purple" onClick={downloadAllImages}><Download size={15} /> Download all</Button></div></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">{pdfImages.map((item) => <div key={item.id} className="rounded-2xl border border-neutral-800 bg-[#111215] p-3 shadow-xl"><div className="flex items-center justify-between mb-3"><span className="text-[11px] font-bold uppercase tracking-widest text-neutral-500">Page {item.pageNum}</span><button onClick={() => downloadPdfImage(item.dataUrl, item.pageNum)} className="p-2 rounded-lg bg-purple-500/10 text-purple-400 hover:bg-purple-500/20"><Download size={14} /></button></div><div className="rounded-xl bg-white overflow-hidden"><img src={item.dataUrl} alt={`Page ${item.pageNum}`} className="w-full h-auto" /></div></div>)}</div>
              </>}
            </div>
          </section>
        )}

        {appMode === 'merge' && (
          <section className="min-h-[calc(100vh-49px)] overflow-auto bg-[#07080a] px-3 sm:px-6 lg:px-10 py-6 sm:py-10">
            <div className="mx-auto max-w-5xl">
              <div className="rounded-3xl border border-neutral-800 bg-gradient-to-b from-neutral-900/80 to-neutral-950 p-5 sm:p-7 shadow-2xl mb-6"><div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"><div><div className="flex items-center gap-2 text-orange-400"><FilePlus2 size={20} /><span className="text-xs uppercase tracking-[.2em] font-bold">Merge PDFs</span></div><h2 className="mt-2 text-2xl font-bold text-white">Build one document from several files.</h2><p className="mt-2 max-w-2xl text-xs leading-relaxed text-neutral-500">Add PDFs, reorder them, review their page counts, then export one combined document.</p></div><label className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-600 hover:bg-orange-500 text-white px-4 py-3 text-sm font-semibold cursor-pointer shrink-0">{mergeBusy ? <Loader2 size={17} className="animate-spin" /> : <Plus size={17} />} Add PDFs<input type="file" multiple accept="application/pdf" className="hidden" disabled={mergeBusy} onChange={handleMergeUpload} /></label></div></div>
              {mergeFiles.length === 0 ? <div className="min-h-[42vh] rounded-2xl border border-dashed border-neutral-800 bg-neutral-950/60 flex flex-col items-center justify-center text-center text-neutral-600"><FilePlus2 size={50} className="opacity-20 mb-4" /><h3 className="text-sm font-semibold text-neutral-300">No PDF files yet</h3><p className="mt-2 text-xs">Add two or more documents to start combining.</p></div> : <>
                <div className="space-y-3">{mergeFiles.map((file, idx) => <div key={file.id} draggable onDragStart={() => { dragItem.current = idx; }} onDragOver={(e) => e.preventDefault()} onDrop={() => { const to = idx; if (dragItem.current !== null && dragItem.current !== to) reorderMergeFiles(dragItem.current, to); dragItem.current = null; }} className="group rounded-2xl border border-neutral-800 bg-[#111215] p-3 sm:p-4 shadow-xl"><div className="flex items-center gap-3"><GripHorizontal size={18} className="text-neutral-600 shrink-0" /><div className="h-10 w-10 rounded-xl bg-orange-500/10 text-orange-400 flex items-center justify-center shrink-0"><FileText size={18} /></div><div className="min-w-0 flex-1"><div className="font-semibold text-sm text-white truncate">{file.name}</div><div className="mt-1 text-[10px] text-neutral-500">{file.pages.length} page{file.pages.length === 1 ? '' : 's'} · {(file.size / 1024 / 1024).toFixed(2)} MB</div></div><div className="flex items-center gap-1"><button onClick={() => moveMergeFile(idx, -1)} className="p-2 rounded-lg hover:bg-neutral-900 text-neutral-500"><ArrowUp size={14} /></button><button onClick={() => moveMergeFile(idx, 1)} className="p-2 rounded-lg hover:bg-neutral-900 text-neutral-500"><ArrowDown size={14} /></button><button onClick={() => removeMergeFile(file.id)} className="p-2 rounded-lg hover:bg-red-500/10 text-red-400"><Trash2 size={14} /></button></div></div></div>)}</div>
                <div className="mt-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 rounded-2xl border border-neutral-800 bg-neutral-900/70 p-3"><Button onClick={clearMergeFiles}><Trash2 size={15} /> Clear</Button><Button variant="orange" onClick={combinePDFs} disabled={mergeBusy || !mergeFiles.length}>{mergeBusy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Combine {totalMergePages} page{totalMergePages === 1 ? '' : 's'}</Button></div>
              </>}
            </div>
          </section>
        )}
      </main>

      {/* Desktop contextual inspector */}
      {appMode === 'customisable' && activeObject && !cropSessionRef.current && (
        <aside className="hidden xl:flex fixed inset-y-0 right-0 z-[55] w-[310px] border-l border-neutral-800 bg-[#111215]/96 backdrop-blur-xl flex-col shadow-2xl">
          <Inspector activeObject={activeObject} activeCanvas={activeCanvas} activeWidth={activeWidth} activeHeight={activeHeight} activeAngle={activeAngle} setProperty={setProperty} toggleLock={toggleLock} toggleAspectRatio={toggleAspectRatio} updateActive={updateActive} deleteSelected={deleteSelected} alignActive={alignActive} fitActive={fitActive} startCrop={startCrop} />
        </aside>
      )}

      {/* Mobile inspector */}
      {appMode === 'customisable' && mobilePanelOpen && (
        <div className="xl:hidden fixed inset-0 z-[75] bg-black/55" onMouseDown={(e) => { if (e.currentTarget === e.target) setMobilePanelOpen(false); }}>
          <div className="absolute inset-x-0 bottom-0 max-h-[84vh] rounded-t-3xl border-t border-neutral-700 bg-[#111215] shadow-2xl overflow-y-auto pb-[max(12px,env(safe-area-inset-bottom))]">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-neutral-800 bg-[#111215]/95 backdrop-blur px-4 py-3"><div className="h-1.5 w-11 rounded-full bg-neutral-700 absolute left-1/2 -translate-x-1/2 top-2" /><span className="pt-1 text-sm font-semibold">Layer tools</span><button onClick={() => setMobilePanelOpen(false)} className="p-2 rounded-lg hover:bg-neutral-900"><X size={16} /></button></div>
            {activeObject ? <Inspector activeObject={activeObject} activeCanvas={activeCanvas} activeWidth={activeWidth} activeHeight={activeHeight} activeAngle={activeAngle} setProperty={setProperty} toggleLock={toggleLock} toggleAspectRatio={toggleAspectRatio} updateActive={updateActive} deleteSelected={deleteSelected} alignActive={alignActive} fitActive={fitActive} startCrop={startCrop} /> : <div className="p-8 text-center text-neutral-500 text-sm">Select an image to edit it.</div>}
          </div>
        </div>
      )}

      {/* Mobile action strip */}
      {appMode === 'customisable' && activeObject && !cropSessionRef.current && <div className="xl:hidden fixed inset-x-0 bottom-0 z-[60] border-t border-neutral-800 bg-[#0f1013]/96 backdrop-blur-xl px-3 py-2 pb-[max(8px,env(safe-area-inset-bottom))]"><div className="mx-auto max-w-xl flex items-center justify-center gap-2"><button onClick={startCrop} disabled={activeObject.type !== 'image' || activeObject.lockMovementX} className="flex-1 rounded-xl bg-blue-600 px-3 py-2.5 text-xs font-semibold text-white disabled:opacity-30"><Crop size={14} className="mx-auto" /><span className="block mt-1">Crop</span></button><button onClick={duplicateSelected} className="flex-1 rounded-xl bg-neutral-900 border border-neutral-800 px-3 py-2.5 text-xs font-semibold"><Copy size={14} className="mx-auto" /><span className="block mt-1">Duplicate</span></button><button onClick={toggleLock} className="flex-1 rounded-xl bg-neutral-900 border border-neutral-800 px-3 py-2.5 text-xs font-semibold"><Lock size={14} className="mx-auto" /><span className="block mt-1">{activeObject.lockMovementX ? 'Unlock' : 'Lock'}</span></button><button onClick={() => setMobilePanelOpen(true)} className="flex-1 rounded-xl bg-neutral-900 border border-neutral-800 px-3 py-2.5 text-xs font-semibold"><Settings size={14} className="mx-auto" /><span className="block mt-1">More</span></button></div></div>}

      {cropSessionRef.current && <CropOverlay ratio={cropRatio} setRatio={setCropAspect} onApply={applyCrop} onCancel={cancelCrop} />}

      {appMode !== 'merge' && (
        <div className="lg:hidden fixed left-3 right-3 sm:right-6 sm:left-auto bottom-3 sm:bottom-5 z-[60]">
          <div className="rounded-2xl border border-neutral-800 bg-[#111215]/95 backdrop-blur-xl shadow-2xl px-3 py-2.5 flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2 text-[10px] text-neutral-500 mr-1"><Ruler size={13} /> Output</div>
            <input value={fileName} onChange={(e) => setFileName(e.target.value)} className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none" />
            {appMode === 'customisable' && <Button variant="white" className="shrink-0" onClick={exportCustomPDF}><Download size={15} /> <span className="hidden sm:inline">Export PDF</span><span className="sm:hidden">Export</span></Button>}
            {appMode === 'autofit' && <Button variant="white" className="shrink-0" onClick={exportAutoFitPDF}><Download size={15} /> <span className="hidden sm:inline">Export PDF</span><span className="sm:hidden">Export</span></Button>}
            {appMode === 'pdf2img' && <Button variant="purple" className="shrink-0" onClick={downloadAllImages} disabled={!pdfImages.length}><Download size={15} /> <span className="hidden sm:inline">Download All</span><span className="sm:hidden">Save All</span></Button>}
          </div>
        </div>
      )}
    </div>
    </>
  );
}

function Inspector({ activeObject, activeCanvas, activeWidth, activeHeight, activeAngle, setProperty, toggleLock, toggleAspectRatio, updateActive, deleteSelected, alignActive, fitActive, startCrop }) {
  const locked = !!activeObject.lockMovementX;
  return (
    <div className="p-4 sm:p-5 space-y-5">
      <div className="flex items-center justify-between"><div><h2 className="text-sm font-bold text-white">Selected layer</h2><p className="text-[10px] text-neutral-500 mt-1">{activeObject.type === 'image' ? 'Image' : activeObject.type}</p></div><div className="flex items-center gap-1.5"><div className="h-2 w-2 rounded-full bg-emerald-400" /><span className="text-[9px] uppercase tracking-wider text-neutral-600">Live</span></div></div>

      {activeObject.type === 'image' && <Button variant="blue" className="w-full py-3" onClick={startCrop} disabled={locked}><Crop size={16} /> Crop image</Button>}

      <Button variant={locked ? 'danger' : 'ghost'} className="w-full py-3" onClick={toggleLock}>{locked ? <><Unlock size={16} /> Unlock layer</> : <><Lock size={16} /> Lock layer</>}</Button>

      <section><div className="mb-3 flex items-center justify-between"><h3 className="text-[10px] font-bold uppercase tracking-[.18em] text-neutral-500">Size & rotation</h3>{activeObject.type === 'image' && <button onClick={toggleAspectRatio} className="text-[10px] text-blue-400 flex items-center gap-1">{activeObject.lockUniScaling !== false ? 'Proportion locked' : 'Free scaling'}</button>}</div><div className="grid grid-cols-2 gap-2.5"><Field label="Width" value={activeWidth} onChange={(v) => setProperty('width', v)} disabled={locked} /><Field label="Height" value={activeHeight} onChange={(v) => setProperty('height', v)} disabled={locked} /><Field label="Rotation" value={activeAngle} onChange={(v) => setProperty('angle', v)} disabled={locked} suffix="°" /><Field label="Opacity" value={Math.round((activeObject.opacity ?? 1) * 100)} onChange={(v) => setProperty('opacity', v)} disabled={locked} suffix="%" /></div></section>

      <section><h3 className="mb-3 text-[10px] font-bold uppercase tracking-[.18em] text-neutral-500">Position</h3><div className="grid grid-cols-2 gap-2.5"><Field label="X" value={Math.round(activeObject.left || 0)} onChange={(v) => setProperty('left', v)} disabled={locked} /><Field label="Y" value={Math.round(activeObject.top || 0)} onChange={(v) => setProperty('top', v)} disabled={locked} /></div><div className="mt-2 grid grid-cols-3 gap-1.5">{[['left', AlignCenterHorizontal, 'Left'], ['centerH', AlignCenterHorizontal, 'Center'], ['right', AlignCenterHorizontal, 'Right'], ['top', AlignCenterVertical, 'Top'], ['centerV', AlignCenterVertical, 'Middle'], ['bottom', AlignCenterVertical, 'Bottom']].map(([mode, Icon, label]) => <button key={mode} onClick={() => alignActive(mode)} disabled={locked} className="rounded-lg border border-neutral-800 bg-neutral-900 py-2 text-[10px] text-neutral-400 hover:text-white disabled:opacity-30"><Icon size={13} className="mx-auto mb-1" />{label}</button>)}</div></section>

      <section><h3 className="mb-3 text-[10px] font-bold uppercase tracking-[.18em] text-neutral-500">Quick actions</h3><div className="grid grid-cols-3 gap-1.5"><MiniAction icon={FlipHorizontal} label="Flip H" onClick={() => updateActive({ flipX: !activeObject.flipX })} disabled={locked} /><MiniAction icon={FlipVertical} label="Flip V" onClick={() => updateActive({ flipY: !activeObject.flipY })} disabled={locked} /><MiniAction icon={RotateCcw} label="Reset angle" onClick={() => updateActive({ angle: 0 })} disabled={locked} /></div><div className="mt-2 grid grid-cols-2 gap-1.5"><MiniAction icon={Minimize2} label="Fit page" onClick={() => fitActive(false)} disabled={locked} /><MiniAction icon={Maximize2} label="Fill page" onClick={() => fitActive(true)} disabled={locked} /></div></section>

      <section><h3 className="mb-3 text-[10px] font-bold uppercase tracking-[.18em] text-neutral-500">Arrange</h3><div className="grid grid-cols-2 gap-2"><Button disabled={locked} onClick={() => { activeCanvas?.bringForward(activeObject); activeCanvas?.renderAll(); activeCanvas?.fire('object:modified', { target: activeObject }); }}><MoveUp size={14} /> Forward</Button><Button disabled={locked} onClick={() => { activeCanvas?.sendBackwards(activeObject); activeCanvas?.renderAll(); activeCanvas?.fire('object:modified', { target: activeObject }); }}><MoveDown size={14} /> Backward</Button></div></section>

      <Button variant="danger" className="w-full py-2.5" disabled={locked} onClick={deleteSelected}><Trash2 size={15} /> Delete layer</Button>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3 text-[10px] leading-relaxed text-neutral-600">The selected image keeps its rotation handle on the top edge. Boundary snapping and angle snapping are active automatically.</div>
    </div>
  );
}

function Field({ label, value, onChange, disabled, suffix }) {
  return <label className={`block rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 ${disabled ? 'opacity-40' : ''}`}><span className="block text-[9px] uppercase tracking-wider text-neutral-600 mb-1">{label}</span><div className="flex items-center gap-1"><input disabled={disabled} type="number" value={value ?? 0} onChange={(e) => onChange(e.target.value)} className="min-w-0 w-full bg-transparent text-sm text-white outline-none" />{suffix && <span className="text-[10px] text-neutral-600">{suffix}</span>}</div></label>;
}

function MiniAction({ icon: Icon, label, onClick, disabled }) {
  return <button disabled={disabled} onClick={onClick} className="rounded-xl border border-neutral-800 bg-neutral-900 py-2 text-[10px] text-neutral-400 hover:text-white disabled:opacity-30"><Icon size={15} className="mx-auto mb-1" />{label}</button>;
}
