// Draw on a screenshot: pen, highlighter, line, arrow, box, circle, text, move and eraser, in a few colours and
// widths, with undo/redo. The drawing is kept as shapes next to the untouched original, so it can be reopened and
// changed any time; saving also renders a flat picture that the journal shows everywhere else.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, Circle, Eraser, Hand, Highlighter, Minus, Pencil, Redo2, Square, Trash2, Type, Undo2, X } from 'lucide-react';

const COLORS = ['#ff4d4f', '#ffb020', '#22c55e', '#38bdf8', '#a78bfa', '#ffffff', '#111111'];
const WIDTHS = [{ v: 2, label: 'Thin' }, { v: 4, label: 'Medium' }, { v: 8, label: 'Thick' }];
const TOOLS = [
  { id: 'pen', icon: Pencil, label: 'Pen (P)', key: 'p' },
  { id: 'hl', icon: Highlighter, label: 'Highlighter (H)', key: 'h' },
  { id: 'line', icon: Minus, label: 'Line (L)', key: 'l' },
  { id: 'arrow', icon: ArrowUpRight, label: 'Arrow (A)', key: 'a' },
  { id: 'rect', icon: Square, label: 'Box (B)', key: 'b' },
  { id: 'ellipse', icon: Circle, label: 'Circle (C)', key: 'c' },
  { id: 'text', icon: Type, label: 'Text (T)', key: 't' },
  { id: 'move', icon: Hand, label: 'Move a drawing (M)', key: 'm' },
  { id: 'erase', icon: Eraser, label: 'Eraser — click a drawing to remove it (E)', key: 'e' },
];

const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
/**
 * A freehand stroke as smooth curves through the midpoints of its samples. With `pressW` (a pen or tablet's
 * pressure was recorded) each piece takes its own width from the pressure, so handwriting thickens and thins.
 */
function strokeSmooth(ctx, pts, pressW) {
  if (!pts.length) return;
  if (pts.length < 3) {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    const l = pts[pts.length - 1]; ctx.lineTo(l[0] + (pts.length === 1 ? 0.1 : 0), l[1]);
    if (pressW) ctx.lineWidth = pressW * (0.25 + 1.5 * (pts[0][2] ?? 0.5));
    ctx.stroke(); return;
  }
  if (!pressW) {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) { const m = mid(pts[i], pts[i + 1]); ctx.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]); }
    const l = pts[pts.length - 1]; ctx.lineTo(l[0], l[1]);
    ctx.stroke(); return;
  }
  let from = pts[0];
  for (let i = 1; i < pts.length - 1; i++) {
    const to = mid(pts[i], pts[i + 1]);
    ctx.lineWidth = Math.max(0.6, pressW * (0.25 + 1.5 * (pts[i][2] ?? 0.5)));
    ctx.beginPath(); ctx.moveTo(from[0], from[1]); ctx.quadraticCurveTo(pts[i][0], pts[i][1], to[0], to[1]); ctx.stroke();
    from = to;
  }
  const l = pts[pts.length - 1];
  ctx.beginPath(); ctx.moveTo(from[0], from[1]); ctx.lineTo(l[0], l[1]); ctx.stroke();
}

/** Draw the shapes onto a 2D context whose units are the picture's own pixels. */
export function drawShapes(ctx, shapes, unit = 1) {
  for (const s of shapes) {
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = s.color; ctx.fillStyle = s.color;
    const w = s.w * unit;
    ctx.lineWidth = s.type === 'hl' ? w * 4 : w;
    if (s.type === 'hl') ctx.globalAlpha = 0.35;
    if (s.type === 'pen' || s.type === 'hl') {
      strokeSmooth(ctx, s.pts, s.type === 'pen' && s.pr ? w : 0);
    } else if (s.type === 'line' || s.type === 'arrow') {
      const [x1, y1, x2, y2] = s.box;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      if (s.type === 'arrow') {
        const a = Math.atan2(y2 - y1, x2 - x1), h = Math.max(10 * unit, w * 4);
        ctx.beginPath();
        ctx.moveTo(x2, y2); ctx.lineTo(x2 - h * Math.cos(a - 0.45), y2 - h * Math.sin(a - 0.45));
        ctx.lineTo(x2 - h * Math.cos(a + 0.45), y2 - h * Math.sin(a + 0.45)); ctx.closePath(); ctx.fill();
      }
    } else if (s.type === 'rect') {
      const [x1, y1, x2, y2] = s.box;
      ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    } else if (s.type === 'ellipse') {
      const [x1, y1, x2, y2] = s.box;
      ctx.beginPath(); ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2); ctx.stroke();
    } else if (s.type === 'text') {
      const size = s.size * unit;
      ctx.font = `600 ${size}px Inter, system-ui, sans-serif`; ctx.textBaseline = 'top';
      ctx.lineWidth = Math.max(2, size / 7); ctx.strokeStyle = s.color === '#111111' ? '#ffffff' : 'rgba(0,0,0,0.75)';
      String(s.text).split('\n').forEach((line, i) => { ctx.strokeText(line, s.x, s.y + i * size * 1.2); ctx.fillText(line, s.x, s.y + i * size * 1.2); });
    }
    ctx.restore();
  }
}

const bboxOf = (s, ctx) => {
  if (s.pts) { const xs = s.pts.map((p) => p[0]), ys = s.pts.map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
  if (s.box) { const [a, b, c, d] = s.box; return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)]; }
  ctx.font = `600 ${s.size}px Inter, system-ui, sans-serif`;
  const lines = String(s.text).split('\n');
  return [s.x, s.y, s.x + Math.max(...lines.map((l) => ctx.measureText(l).width)), s.y + lines.length * s.size * 1.2];
};
const distSeg = (px, py, x1, y1, x2, y2) => { const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy; const t = l ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l)) : 0; return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy)); };
/** The top-most shape under a point (in picture pixels), within `tol`. */
function hitTest(shapes, x, y, tol, ctx) {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    const t = tol + (s.w || 2) * (s.type === 'hl' ? 2 : 0.5);
    if (s.pts) { for (let k = 0; k < s.pts.length; k++) { const a = s.pts[k], b = s.pts[k + 1] || a; if (distSeg(x, y, a[0], a[1], b[0], b[1]) <= t) return i; } continue; }
    if (s.type === 'line' || s.type === 'arrow') { if (distSeg(x, y, ...s.box) <= t) return i; continue; }
    const [x1, y1, x2, y2] = bboxOf(s, ctx);
    if (s.type === 'text') { if (x >= x1 - t && x <= x2 + t && y >= y1 - t && y <= y2 + t) return i; continue; }
    if (s.type === 'rect') { const near = (Math.abs(x - x1) <= t || Math.abs(x - x2) <= t) && y >= y1 - t && y <= y2 + t || (Math.abs(y - y1) <= t || Math.abs(y - y2) <= t) && x >= x1 - t && x <= x2 + t; if (near) return i; continue; }
    if (s.type === 'ellipse') { const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = Math.max(1, (x2 - x1) / 2), ry = Math.max(1, (y2 - y1) / 2); const d = Math.hypot((x - cx) / rx, (y - cy) / ry); if (Math.abs(d - 1) * Math.min(rx, ry) <= t) return i; }
  }
  return -1;
}
const moved = (s, dx, dy) => (s.pts ? { ...s, pts: s.pts.map(([x, y]) => [x + dx, y + dy]) } : s.box ? { ...s, box: [s.box[0] + dx, s.box[1] + dy, s.box[2] + dx, s.box[3] + dy] } : { ...s, x: s.x + dx, y: s.y + dy });

/** Which edge or corner of a drawing is under the point: { i, h } with h in n/s/e/w/ne/nw/se/sw (or p1/p2: a line's ends). */
function edgeHit(shapes, x, y, tol, ctx) {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (s.type === 'line' || s.type === 'arrow') {
      const [x1, y1, x2, y2] = s.box;
      if (Math.hypot(x - x2, y - y2) <= tol * 1.4) return { i, h: 'p2' };
      if (Math.hypot(x - x1, y - y1) <= tol * 1.4) return { i, h: 'p1' };
      continue;
    }
    const [x1, y1, x2, y2] = bboxOf(s, ctx);
    if (x < x1 - tol || x > x2 + tol || y < y1 - tol || y > y2 + tol) continue;
    if (s.type !== 'rect') { // its frame is invisible: only the eight handles resize it (so drawing near it still draws)
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, t = tol * 1.3;
      const hs = [['nw', x1, y1], ['n', mx, y1], ['ne', x2, y1], ['e', x2, my], ['se', x2, y2], ['s', mx, y2], ['sw', x1, y2], ['w', x1, my]];
      const f = hs.find(([, hx, hy]) => Math.abs(x - hx) <= t && Math.abs(y - hy) <= t);
      if (f) return { i, h: f[0] };
      continue;
    }
    const L = Math.abs(x - x1) <= tol, R = Math.abs(x - x2) <= tol, T = Math.abs(y - y1) <= tol, B = Math.abs(y - y2) <= tol;
    const h = `${T ? 'n' : B ? 's' : ''}${L ? 'w' : R ? 'e' : ''}`;
    if (h) return { i, h };
  }
  return null;
}
/** A drawing under the point that can be picked up and moved: its own line, the inside of text, or the grip in
 *  the middle of a box or circle (so you can still draw inside them). */
function moveHit(shapes, x, y, tol, ctx, grip) {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (s.type === 'text') { const [x1, y1, x2, y2] = bboxOf(s, ctx); if (x >= x1 && x <= x2 && y >= y1 && y <= y2) return i; continue; }
    if (s.type === 'rect' || s.type === 'ellipse') { const [x1, y1, x2, y2] = bboxOf(s, ctx); if (Math.hypot(x - (x1 + x2) / 2, y - (y1 + y2) / 2) <= grip) return i; if (s.type === 'ellipse' && hitTest([s], x, y, tol, ctx) === 0) return i; continue; }
    if (hitTest([s], x, y, tol, ctx) === 0) return i;
  }
  return -1;
}
const CURSOR = { move: 'move', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize', p1: 'grab', p2: 'grab' };
/** The shape `base` stretched by dragging handle `h` to (x, y). */
function resized(base, h, x, y, ctx, keep) {
  if (h === 'p1' || h === 'p2') { const b = [...base.box]; if (h === 'p1') { b[0] = x; b[1] = y; } else { b[2] = x; b[3] = y; } return { ...base, box: b }; }
  const [ox1, oy1, ox2, oy2] = bboxOf(base, ctx);
  let [nx1, ny1, nx2, ny2] = [ox1, oy1, ox2, oy2];
  if (h.includes('n')) ny1 = Math.min(y, oy2 - 4);
  if (h.includes('s')) ny2 = Math.max(y, oy1 + 4);
  if (h.includes('w')) nx1 = Math.min(x, ox2 - 4);
  if (h.includes('e')) nx2 = Math.max(x, ox1 + 4);
  const ow = Math.max(1, ox2 - ox1), oh = Math.max(1, oy2 - oy1);
  let sx = (nx2 - nx1) / ow, sy = (ny2 - ny1) / oh;
  const corner = h.length === 2;
  if (base.type === 'text' || (keep && corner)) { // text (and Shift on a corner) keeps its proportions
    const k = h === 'n' || h === 's' ? sy : h === 'e' || h === 'w' ? sx : Math.max(sx, sy);
    sx = sy = Math.max(0.05, k);
    if (h.includes('w')) nx1 = ox2 - ow * sx; else nx2 = ox1 + ow * sx;
    if (h.includes('n')) ny1 = oy2 - oh * sy; else ny2 = oy1 + oh * sy;
  }
  const mx = (px) => nx1 + (px - ox1) * sx, my = (py) => ny1 + (py - oy1) * sy;
  if (base.type === 'text') return { ...base, size: Math.max(6, base.size * sx), x: nx1, y: ny1 };
  if (base.pts) return { ...base, pts: base.pts.map(([px, py]) => [mx(px), my(py)]) };
  return { ...base, box: [nx1, ny1, nx2, ny2] };
}

/**
 * @param src the original picture (URL)
 * @param annot { shapes } saved earlier, or null
 * @param onSave async (blob of the flattened picture, annot) => void
 */
export default function ShotEditor({ src, annot, onSave, onClose }) {
  const wrap = useRef(null), cvs = useRef(null), imgRef = useRef(null);
  const [img, setImg] = useState(null);
  const [view, setView] = useState({ scale: 1, w: 0, h: 0 });
  const [shapes, setShapes] = useState(() => annot?.shapes || []);
  const [redo, setRedo] = useState([]);
  const [tool, setTool] = useState('arrow');
  const [color, setColor] = useState(() => { try { return localStorage.getItem('rf-draw-color') || COLORS[0]; } catch { return COLORS[0]; } });
  const [width, setWidth] = useState(4);
  const [draft, setDraft] = useState(null);
  const [hover, setHover] = useState(null); // { i, h } — an edge or corner under the mouse
  const [zoom, setZoom] = useState({ z: 1, x: 0, y: 0 }); // wheel zoom inside the picture's frame; x/y: pan in screen px
  const zRef = useRef(zoom); zRef.current = zoom;
  const space = useRef(false);
  const cache = useRef({ key: '', c: null });
  const S = view.scale * zoom.z; // screen px per picture px
  const [text, setText] = useState(null); // { x, y, value } while typing
  const [saving, setSaving] = useState(false);
  const drag = useRef(null);
  const history = useRef([]);
  const dirty = useRef(false);
  const commit = (next) => { history.current.push(shapes); setShapes(next); setRedo([]); dirty.current = true; };
  const undo = useCallback(() => { const prev = history.current.pop(); if (!prev) return; setRedo((r) => [shapes, ...r]); setShapes(prev); dirty.current = true; }, [shapes]);
  const redoIt = useCallback(() => { const [n, ...rest] = redo; if (!n) return; history.current.push(shapes); setShapes(n); setRedo(rest); dirty.current = true; }, [redo, shapes]);

  useEffect(() => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => setImg(i); i.src = src; imgRef.current = i; }, [src]);
  useEffect(() => { try { localStorage.setItem('rf-draw-color', color); } catch { /* private window */ } }, [color]);
  // fit the picture into the space
  useEffect(() => {
    if (!img || !wrap.current) return undefined;
    const fit = () => {
      if (!wrap.current) return; // closed
      const r = wrap.current.getBoundingClientRect();
      const scale = Math.min(1, (r.width - 24) / img.naturalWidth, (r.height - 24) / img.naturalHeight);
      setView({ scale, w: Math.round(img.naturalWidth * scale), h: Math.round(img.naturalHeight * scale) });
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [img]);
  // paint
  useEffect(() => {
    const c = cvs.current;
    if (!c || !img || !view.w) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(view.w * dpr) || c.height !== Math.round(view.h * dpr)) { c.width = Math.round(view.w * dpr); c.height = Math.round(view.h * dpr); }
    const ctx = c.getContext('2d');
    // the picture and the finished drawings are cached, so a stroke in progress only repaints itself
    const key = `${view.w}|${view.h}|${dpr}|${zoom.z}|${zoom.x}|${zoom.y}`;
    if (cache.current.key !== key || cache.current.shapes !== shapes) {
      const b = cache.current.c || document.createElement('canvas');
      b.width = c.width; b.height = c.height;
      const bx = b.getContext('2d');
      bx.setTransform(1, 0, 0, 1, 0, 0); bx.fillStyle = '#000'; bx.fillRect(0, 0, b.width, b.height);
      bx.setTransform(dpr * S, 0, 0, dpr * S, dpr * zoom.x, dpr * zoom.y);
      bx.imageSmoothingQuality = 'high';
      bx.drawImage(img, 0, 0);
      drawShapes(bx, shapes);
      cache.current = { key, shapes, c: b };
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(cache.current.c, 0, 0);
    ctx.setTransform(dpr * S, 0, 0, dpr * S, dpr * zoom.x, dpr * zoom.y);
    if (draft) drawShapes(ctx, [draft]);
    // the drawing being resized (or about to be): its outline and handles
    const hi = drag.current?.resize != null ? drag.current.resize : hover?.i;
    const hs = hi != null ? shapes[hi] : null;
    if (hs) {
      const px = 1 / S;
      ctx.save();
      ctx.lineWidth = px; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.setLineDash([4 * px, 3 * px]);
      if (hs.type === 'line' || hs.type === 'arrow') {
        const [x1, y1, x2, y2] = hs.box;
        ctx.setLineDash([]); ctx.fillStyle = '#fff';
        for (const [a, b] of [[x1, y1], [x2, y2]]) { ctx.beginPath(); ctx.arc(a, b, 4.5 * px, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      } else {
        const [x1, y1, x2, y2] = bboxOf(hs, ctx);
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        ctx.setLineDash([]); ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        const r = 3.5 * px;
        for (const [a, b] of [[x1, y1], [(x1 + x2) / 2, y1], [x2, y1], [x2, (y1 + y2) / 2], [x2, y2], [(x1 + x2) / 2, y2], [x1, y2], [x1, (y1 + y2) / 2]]) { ctx.fillRect(a - r, b - r, r * 2, r * 2); ctx.strokeRect(a - r, b - r, r * 2, r * 2); }
        if (hs.type === 'rect' || hs.type === 'ellipse') { // the move grip
          const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
          ctx.beginPath(); ctx.arc(cx, cy, 7 * px, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fill(); ctx.stroke();
          ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 1.4 * px; ctx.beginPath();
          ctx.moveTo(cx - 4 * px, cy); ctx.lineTo(cx + 4 * px, cy); ctx.moveTo(cx, cy - 4 * px); ctx.lineTo(cx, cy + 4 * px); ctx.stroke();
        }
      }
      ctx.restore();
    }
  }, [img, view, shapes, draft, hover, zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  const at = (e) => { const r = cvs.current.getBoundingClientRect(); return [(e.clientX - r.left - zoom.x) / S, (e.clientY - r.top - zoom.y) / S]; };
  const clampPan = (z, x, y) => ({ z, x: Math.min(0, Math.max(view.w - img.naturalWidth * view.scale * z, x)), y: Math.min(0, Math.max(view.h - img.naturalHeight * view.scale * z, y)) });
  // the mouse wheel (or a trackpad pinch) zooms where the pointer is
  useEffect(() => {
    const c = cvs.current;
    if (!c || !img) return undefined;
    const wheel = (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect(), cx = e.clientX - r.left, cy = e.clientY - r.top;
      const o = zRef.current;
      const z = Math.max(1, Math.min(10, o.z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
      const k = z / o.z;
      setZoom(z === 1 ? { z: 1, x: 0, y: 0 } : clampPan(z, cx - (cx - o.x) * k, cy - (cy - o.y) * k));
    };
    c.addEventListener('wheel', wheel, { passive: false });
    return () => c.removeEventListener('wheel', wheel);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const unit = img ? Math.max(1, Math.max(img.naturalWidth, img.naturalHeight) / 1400) : 1; // widths read the same on big and small pictures
  const finishText = () => {
    if (text?.value?.trim()) commit([...shapes, { type: 'text', x: text.x, y: text.y, text: text.value.trim(), size: (14 + width * 3) * unit, color }]);
    setText(null);
  };
  const down = (e) => {
    if (!img) return;
    if (e.button === 1 || (e.button === 0 && space.current)) { // pan the zoomed picture
      e.preventDefault(); cvs.current.setPointerCapture?.(e.pointerId);
      drag.current = { pan: true, sx: e.clientX, sy: e.clientY, ox: zoom.x, oy: zoom.y }; return;
    }
    if (e.button > 0) return;
    if (text) { finishText(); return; }
    const [x, y] = at(e);
    cvs.current.setPointerCapture?.(e.pointerId);
    const ctx = cvs.current.getContext('2d');
    // an edge or corner of any drawing: resize it, whatever tool is picked
    const eh = tool === 'erase' ? null : edgeHit(shapes, x, y, 7 / S, ctx);
    if (eh) { drag.current = { resize: eh.i, h: eh.h, base: shapes }; return; }
    // the middle of any drawing: move it
    const mh = tool === 'erase' ? -1 : moveHit(shapes, x, y, 6 / S, ctx, 11 / S);
    if (mh >= 0) { drag.current = { move: mh, x, y, base: shapes }; return; }
    if (tool === 'erase') { const i = hitTest(shapes, x, y, 8 / S, ctx); if (i >= 0) commit(shapes.filter((_, k) => k !== i)); drag.current = { erase: true }; return; }
    if (tool === 'move') {
      let i = hitTest(shapes, x, y, 8 / S, ctx);
      if (i < 0) { // inside a box or circle counts too
        for (let k = shapes.length - 1; k >= 0 && i < 0; k--) { const sh = shapes[k]; if (sh.type === 'rect' || sh.type === 'ellipse') { const [x1, y1, x2, y2] = bboxOf(sh, ctx); if (x >= x1 && x <= x2 && y >= y1 && y <= y2) i = k; } }
      }
      if (i >= 0) drag.current = { move: i, x, y, base: shapes };
      return;
    }
    if (tool === 'text') { e.preventDefault(); setText({ x, y, value: '' }); return; }
    const w = width * unit;
    drag.current = { x, y };
    const pen = e.pointerType === 'pen';
    const r2 = (v) => Math.round(v * 100) / 100;
    setDraft(tool === 'pen' || tool === 'hl' ? { type: tool, pts: [[r2(x), r2(y), pen ? r2(e.pressure || 0.5) : 0.5]], color, w, ...(pen && tool === 'pen' ? { pr: 1 } : {}) } : { type: tool, box: [x, y, x, y], color, w });
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) { // just hovering: show a resize cursor over an edge or corner
      if (!img || text) return;
      const [hx, hy] = at(e);
      const hctx = cvs.current.getContext('2d');
      let eh = tool === 'erase' ? null : edgeHit(shapes, hx, hy, 7 / S, hctx);
      if (!eh && tool !== 'erase') { const mi = moveHit(shapes, hx, hy, 6 / S, hctx, 11 / S); if (mi >= 0) eh = { i: mi, h: 'move' }; }
      setHover((o) => (o?.i === eh?.i && o?.h === eh?.h ? o : eh));
      return;
    }
    if (d.pan) { setZoom((o) => clampPan(o.z, d.ox + e.clientX - d.sx, d.oy + e.clientY - d.sy)); return; }
    const [x, y] = at(e);
    if (d.resize != null) { const ctx = cvs.current.getContext('2d'); setShapes(d.base.map((s, k) => (k === d.resize ? resized(d.base[k], d.h, x, y, ctx, e.shiftKey) : s))); return; }
    if (d.erase) { const ctx = cvs.current.getContext('2d'); const i = hitTest(shapes, x, y, 8 / S, ctx); if (i >= 0) commit(shapes.filter((_, k) => k !== i)); return; }
    if (d.move != null) { setShapes(d.base.map((s, k) => (k === d.move ? moved(s, x - d.x, y - d.y) : s))); return; }
    if (draft?.pts) {
      // every sample the pen or mouse sent since the last frame (tablets send far more than one per frame), lightly
      // smoothed so handwriting comes out clean rather than jittery
      const evs = e.nativeEvent.getCoalescedEvents?.() || [];
      const list = evs.length ? evs : [e.nativeEvent];
      const r = cvs.current.getBoundingClientRect();
      setDraft((s) => {
        if (!s?.pts) return s;
        const pts = [...s.pts];
        for (const ev of list) {
          const rx = (ev.clientX - r.left - zoom.x) / S, ry = (ev.clientY - r.top - zoom.y) / S;
          const last = pts[pts.length - 1];
          const f = 0.55; // how far each new point moves toward the pointer
          const nx = last[0] + (rx - last[0]) * f, ny = last[1] + (ry - last[1]) * f;
          if (Math.hypot(nx - last[0], ny - last[1]) < 0.6 / S) continue;
          const pr = s.pr ? (ev.pressure || last[2] || 0.5) : 0.5;
          pts.push([Math.round(nx * 100) / 100, Math.round(ny * 100) / 100, Math.round((last[2] * 0.4 + pr * 0.6) * 100) / 100]);
        }
        return pts.length === s.pts.length ? s : { ...s, pts };
      });
      return;
    }
    setDraft((s) => {
      if (!s) return s;
      let [x2, y2] = [x, y];
      if (e.shiftKey && (s.type === 'line' || s.type === 'arrow')) { const a = Math.round(Math.atan2(y - d.y, x - d.x) / (Math.PI / 4)) * (Math.PI / 4), l = Math.hypot(x - d.x, y - d.y); x2 = d.x + l * Math.cos(a); y2 = d.y + l * Math.sin(a); }
      if (e.shiftKey && (s.type === 'rect' || s.type === 'ellipse')) { const m = Math.max(Math.abs(x - d.x), Math.abs(y - d.y)); x2 = d.x + Math.sign(x - d.x || 1) * m; y2 = d.y + Math.sign(y - d.y || 1) * m; }
      return { ...s, box: [d.x, d.y, x2, y2] };
    });
  };
  const up = (e) => {
    const d = drag.current; drag.current = null;
    if (d?.pan) return;
    if (d?.resize != null) { history.current.push(d.base); setRedo([]); dirty.current = true; return; }
    if (d?.move != null) { history.current.push(d.base); setRedo([]); dirty.current = true; return; }
    let done = draft;
    if (done?.pts && e?.clientX != null) { // smoothing trails the pointer slightly: end exactly where the pen lifted
      const [ex, ey] = at(e), last = done.pts[done.pts.length - 1];
      if (Math.hypot(ex - last[0], ey - last[1]) > 0.3 / S) done = { ...done, pts: [...done.pts, [Math.round(ex * 100) / 100, Math.round(ey * 100) / 100, last[2]]] };
    }
    if (done) {
      const tiny = done.box && Math.hypot(done.box[2] - done.box[0], done.box[3] - done.box[1]) < 3;
      if (!tiny) commit([...shapes, done]);
      setDraft(null);
    }
  };
  const close = useCallback(() => { if (dirty.current && !window.confirm('Close without saving your drawing?')) return; onClose(); }, [onClose]);
  const save = async () => {
    if (!img) return;
    setSaving(true);
    try {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      drawShapes(ctx, shapes);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      await onSave(blob, { shapes, w: img.naturalWidth, h: img.naturalHeight, v: 1 });
      dirty.current = false;
      onClose();
    } catch (e) { window.alert(`Couldn’t save: ${e.message}`); }
    setSaving(false);
  };
  useEffect(() => {
    const key = (e) => {
      if (text) { if (e.key === 'Escape') { e.stopPropagation(); setText(null); } return; }
      if (e.target.closest?.('input, textarea')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); return; }
      if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); if (!space.current) { space.current = true; setHover((h) => h); setZoom((z) => ({ ...z })); } return; }
      if (e.key === '0' && !mod) { e.stopPropagation(); setZoom({ z: 1, x: 0, y: 0 }); return; }
      if ((e.key === '+' || e.key === '=') && !mod) { e.stopPropagation(); setZoom((o) => { const z = Math.min(10, o.z * 1.4), cx = view.w / 2, cy = view.h / 2, k = z / o.z; return clampPan(z, cx - (cx - o.x) * k, cy - (cy - o.y) * k); }); return; }
      if ((e.key === '-' || e.key === '_') && !mod) { e.stopPropagation(); setZoom((o) => { const z = Math.max(1, o.z / 1.4), cx = view.w / 2, cy = view.h / 2, k = z / o.z; return z === 1 ? { z: 1, x: 0, y: 0 } : clampPan(z, cx - (cx - o.x) * k, cy - (cy - o.y) * k); }); return; }
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); if (e.shiftKey) redoIt(); else undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); e.stopPropagation(); redoIt(); return; }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); e.stopPropagation(); save(); return; }
      if (!mod && !e.altKey) { const t = TOOLS.find((x) => x.key === e.key.toLowerCase()); if (t) { e.stopPropagation(); setTool(t.id); } }
    };
    window.addEventListener('keydown', key, true);
    const keyUp = (e) => { if (e.key === ' ' && space.current) { space.current = false; setZoom((z) => ({ ...z })); } };
    window.addEventListener('keyup', keyUp, true);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('keyup', keyUp, true); };
  }); // eslint-disable-line react-hooks/exhaustive-deps

  return createPortal(
    <div className="se-overlay">
      <div className="se-bar">
        <div className="se-group">
          {TOOLS.map((t) => <button key={t.id} type="button" className={`se-tool ${tool === t.id ? 'on' : ''}`} title={t.label} onClick={() => setTool(t.id)}><t.icon size={17} /></button>)}
        </div>
        <div className="se-group">
          {COLORS.map((c) => <button key={c} type="button" className={`se-color ${color === c ? 'on' : ''}`} style={{ '--c': c }} title={c} onClick={() => setColor(c)} />)}
        </div>
        <div className="se-group">
          {WIDTHS.map((w) => <button key={w.v} type="button" className={`se-tool ${width === w.v ? 'on' : ''}`} title={w.label} onClick={() => setWidth(w.v)}><i className="se-dot" style={{ width: 3 + w.v * 1.4, height: 3 + w.v * 1.4 }} /></button>)}
        </div>
        <div className="se-group">
          <button type="button" className="se-tool" title="Undo (Ctrl+Z)" disabled={!history.current.length} onClick={undo}><Undo2 size={17} /></button>
          <button type="button" className="se-tool" title="Redo (Ctrl+Shift+Z)" disabled={!redo.length} onClick={redoIt}><Redo2 size={17} /></button>
          <button type="button" className="se-tool" title="Remove all drawings" disabled={!shapes.length} onClick={() => commit([])}><Trash2 size={17} /></button>
        </div>
        <div className="grow" />
        <button type="button" className="se-zoom" title="Scroll to zoom where the pointer is; hold Space (or the middle button) and drag to move around. Click to fit (0)." onClick={() => setZoom({ z: 1, x: 0, y: 0 })}>{Math.round(zoom.z * 100)}%</button>
        <button type="button" className="btn sm" onClick={close}><X size={14} /> Cancel</button>
        <button type="button" className="btn sm white" disabled={saving || !img} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
      <div ref={wrap} className="se-stage">
        {!img && <div className="muted">Loading…</div>}
        {img && (
          <div className="se-canvas-wrap" style={{ width: view.w, height: view.h }}>
            <canvas ref={cvs} style={{ width: view.w, height: view.h, cursor: drag.current?.pan ? 'grabbing' : space.current ? 'grab' : hover ? CURSOR[hover.h] : tool === 'move' ? 'move' : tool === 'erase' ? 'cell' : tool === 'text' ? 'text' : 'crosshair' }}
              onPointerLeave={() => { if (!drag.current) setHover(null); }}
              onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
            {text && (
              <textarea autoFocus className="se-text" value={text.value} placeholder="Type, then click away"
                style={{ left: text.x * S + zoom.x, top: text.y * S + zoom.y, color, fontSize: (14 + width * 3) * unit * S }}
                onChange={(e) => setText({ ...text, value: e.target.value })} onBlur={finishText}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finishText(); } }} />
            )}
          </div>
        )}
      </div>
      <div className="se-hint">Drag a drawing’s middle to move it, or an edge or corner to resize it. Scroll to zoom; hold Space and drag to pan. Drawings stay editable — reopen Edit any time.</div>
    </div>,
    document.body,
  );
}
