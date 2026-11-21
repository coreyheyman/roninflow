// The full-screen chart: a day's candles with your executions, drawing tools (lines, rays, rectangles, Fibonacci,
// measure, long/short positions, brush, text), indicators (EMA, SMA, VWAP, Bollinger, volume, RSI, MACD) and a
// bar-by-bar replay. Built on TradingView Lightweight Charts™; the drawings are our own layer on top of it and are
// saved per instrument, so they show on every day of that market.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  MousePointer2, Slash, MoveUpRight, Minus, ChevronsRight, SeparatorVertical, Square, AlignVerticalSpaceAround, Ruler,
  CircleArrowUp, CircleArrowDown, Brush, Type, Magnet, Eye, EyeOff, Trash2, Undo2, Camera, Maximize, Maximize2, Minimize, X,
  Palette, Play, Pause, StepForward, StepBack, SkipBack, SkipForward, History, Layers, Check, ChevronDown, RefreshCw, Crosshair,
  ChevronRight, ChevronLeft, ShieldCheck, Calendar, AlignStartVertical, Activity, ChevronsRight as TickStep,
} from 'lucide-react';
import { useStore } from '../store/store';
import { IS_VIEWER } from '../lib/shareMode';
import { fmtMoney, fmtTime12, fmtDate, todayKey } from '../lib/stats';
import { Popover, fileToDataUrl } from './ui';
import { saveImage } from '../lib/imageStore';
import { ivSec, TIMEFRAMES, SPAN_DAYS, tfLabel, barTime, aggregate, sessionStart, fromLocal, toLocal } from '../lib/bars';
import { volumeProfile, sessionsIn } from '../lib/volprofile';
import { sma, ema, vwap, bollinger, rsi, macd } from '../lib/indicators';
import { loadLib, chartColors, buildExecutions, TICKS, rootOf, decimals, alpha, ChartColors } from './ExecChart';
import Range from './Range';
import { store, GROUP_DIST, GROUP_KEY, GROUP_DEFAULT, strokeSmooth, joinsGroup } from '../lib/ink';
import { marketOrder, flatten, stepOrders, toTrade, posQty, posAvg, openPnl, nextWeekday, localIso as localIsoOf } from '../lib/backtest';

const TOOLS = [
  [{ id: 'cursor', icon: MousePointer2, label: 'Cursor', key: 'Esc' }],
  [
    { id: 'trend', icon: Slash, label: 'Trend line', key: 'Alt+T' },
    { id: 'ray', icon: MoveUpRight, label: 'Ray' },
    { id: 'hline', icon: Minus, label: 'Horizontal line', key: 'Alt+H' },
    { id: 'hray', icon: ChevronsRight, label: 'Horizontal ray' },
    { id: 'vline', icon: SeparatorVertical, label: 'Vertical line', key: 'Alt+V' },
  ],
  [
    { id: 'rect', icon: Square, label: 'Rectangle', key: 'Alt+R' },
    { id: 'fib', icon: AlignVerticalSpaceAround, label: 'Fib retracement', key: 'Alt+F' },
    { id: 'measure', icon: Ruler, label: 'Measure', key: 'Alt+M' },
    { id: 'vprofile', icon: AlignStartVertical, label: 'Fixed range volume profile' },
  ],
  [
    { id: 'long', icon: CircleArrowUp, label: 'Long position' },
    { id: 'short', icon: CircleArrowDown, label: 'Short position' },
  ],
  [
    { id: 'brush', icon: Brush, label: 'Brush' },
    { id: 'text', icon: Type, label: 'Text' },
  ],
];
const TOOL_BY_ID = Object.fromEntries(TOOLS.flat().map((t) => [t.id, t]));
const ONE_POINT = new Set(['hline', 'hray', 'vline', 'text']);
const KEYS = { t: 'trend', h: 'hline', v: 'vline', r: 'rect', f: 'fib', m: 'measure' };
const SWATCHES = ['#4da3e5', '#2bc48a', '#e5484d', '#e8b043', '#a78bfa', '#f472b6', '#e5e7eb', '#94a3b8'];
const DEFAULT_COLOR = { trend: '#4da3e5', ray: '#4da3e5', hline: '#e8b043', hray: '#e8b043', vline: '#94a3b8', rect: '#a78bfa', fib: '#e8b043', measure: '#4da3e5', long: '#2bc48a', short: '#e5484d', brush: '#f472b6', text: '#e5e7eb', vprofile: '#e8b043' };
const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const SPEEDS = [1, 2, 5, 10, 30, 60]; // bars a second
const TICK_SPEEDS = [1, 2, 5, 10, 30, 60]; // with ticks: times real time (1× = as it happened)

const DEFAULT_IND = {
  ema1: { on: true, n: 9 }, ema2: { on: true, n: 21 }, sma: { on: false, n: 50 }, vwap: { on: true },
  bb: { on: false, n: 20, k: 2 }, volume: { on: true }, rsi: { on: false, n: 14 }, macd: { on: false },
  vpvr: { on: false, n: 70 }, vpsess: { on: false, n: 40 }, gex: { on: false },
};
const IND_INFO = [
  ['ema1', 'EMA', '#f5a623', 'n'], ['ema2', 'EMA', '#4da3e5', 'n'], ['sma', 'SMA', '#c084fc', 'n'], ['vwap', 'VWAP', '#e5e7eb'],
  ['bb', 'Bollinger Bands', '#64748b', 'n'], ['volume', 'Volume'], ['rsi', 'RSI', '#a78bfa', 'n'], ['macd', 'MACD (12, 26, 9)'],
  ['vpvr', 'Volume profile (visible range)', '#e8b043'], ['vpsess', 'Session volume profile', '#e8b043'],
  ['gex', 'GEX levels', '#8b6dff'],
];

// ---------- GEX levels indicator (saved by Macro → GEX on the journal's server) ----------
const GEX_FUT = new Set(['ES', 'MES', 'NQ', 'MNQ', 'RTY', 'M2K']);
const gexStore = { key: '', list: [] }; // levels of the days on the chart, oldest first
const nyDay = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
function gexSeries(bars, key) {
  const L = gexStore.list;
  if (!L.length) return [];
  let j = -1;
  return bars.map((b) => {
    const ms = fromLocal(b.time) * 1000;
    while (j + 1 < L.length && L[j + 1].t <= ms) j++;
    const p = j >= 0 ? L[j] : null;
    return p && p[key] != null && nyDay(p.t) === nyDay(ms) ? { time: b.time, value: p[key] } : { time: b.time };
  });
}

// ---------- volume profile drawing (indicator and the fixed-range tool) ----------
const vpCache = new Map(); // profiles are recomputed only when their range or data changes
function profileFor(data, from, to) {
  const end = Math.min(to, data.until + 1);
  const key = `${data.key}|${data.tick}|${from}|${end}`;
  if (vpCache.has(key)) return vpCache.get(key);
  const p = end > from ? volumeProfile(data.rows, from, end, { tick: data.tick }) : null;
  if (vpCache.size > 400) vpCache.clear();
  vpCache.set(key, p);
  return p;
}
/**
 * One profile on the overlay: bars from `x` growing right (side 'left') or from `x` growing left (side 'right'), longest
 * = `width` px. Value area brighter, POC line across `lineTo` (x), VAH / VAL dashed.
 */
function drawProfile(ctx, p, v, x, width, side, c, fmtP, lineTo, showLabels = true, strong = 0.42) {
  const dir = side === 'right' ? -1 : 1;
  // one bar per tick; zoomed out so far that a tick is under ~1.5 px, neighbouring ticks share a pixel row
  const y0 = v.toY(p.lo), y1 = v.toY(p.lo + p.step);
  const px = y0 != null && y1 != null ? Math.abs(y0 - y1) : 2;
  const g = px >= 1.5 ? 1 : Math.ceil(1.5 / Math.max(px, 0.01));
  let max = p.max;
  if (g > 1) { max = 0; for (let r = 0; r < p.n; r += g) { let s2 = 0; for (let k = r; k < r + g && k < p.n; k++) s2 += p.vol[k]; if (s2 > max) max = s2; } }
  for (let r = 0; r < p.n; r += g) {
    let vol = 0, upv = 0;
    for (let k = r; k < r + g && k < p.n; k++) { vol += p.vol[k]; upv += p.up[k]; }
    if (!vol) continue;
    const yTop = v.toY(p.lo + Math.min(p.n, r + g) * p.step), yBot = v.toY(p.lo + r * p.step);
    if (yTop == null || yBot == null) continue;
    const h = Math.max(1, yBot - yTop - (yBot - yTop > 4 ? 1 : 0));
    const len = (vol / max) * width;
    const upLen = len * (upv / vol);
    const inVa = r + g - 1 >= p.vaLo && r <= p.vaHi;
    ctx.fillStyle = alpha(c.up, inVa ? strong : strong * 0.4);
    ctx.fillRect(dir > 0 ? x : x - upLen, yTop, upLen, h);
    ctx.fillStyle = alpha(c.down, inVa ? strong : strong * 0.4);
    ctx.fillRect(dir > 0 ? x + upLen : x - len, yTop, len - upLen, h);
  }
  const yPoc = v.toY(p.poc), yVah = v.toY(p.vah), yVal = v.toY(p.val);
  const x0 = Math.min(x, lineTo), x1 = Math.max(x, lineTo);
  ctx.lineWidth = 1;
  if (yVah != null && yVal != null) {
    ctx.strokeStyle = alpha(c.text, 0.45); ctx.setLineDash([4, 3]);
    for (const y of [yVah, yVal]) { ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); }
    ctx.setLineDash([]);
  }
  if (yPoc != null) {
    ctx.strokeStyle = '#e8b043'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x0, yPoc); ctx.lineTo(x1, yPoc); ctx.stroke();
    if (showLabels) {
      const lx = side === 'right' ? x1 - 2 : x1 + 2;
      label(ctx, `POC ${fmtP(p.poc)}`, lx, yPoc, '#e8b043', '#000', side === 'right' ? 'right' : 'left');
      if (yVah != null && Math.abs(yVah - yPoc) > 16) label(ctx, `VAH ${fmtP(p.vah)}`, lx, yVah, alpha(c.text, 0.25), c.text, side === 'right' ? 'right' : 'left');
      if (yVal != null && Math.abs(yVal - yPoc) > 16) label(ctx, `VAL ${fmtP(p.val)}`, lx, yVal, alpha(c.text, 0.25), c.text, side === 'right' ? 'right' : 'left');
    }
  }
}
const vpBox = new WeakMap(); // the fixed-range profile's on-screen box, for clicking it

const uid = () => Math.random().toString(36).slice(2, 10);
const dist = (x1, y1, x2, y2) => Math.hypot(x1 - x2, y1 - y2);
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l = dx * dx + dy * dy;
  const k = l ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l)) : 0;
  return dist(px, py, x1 + k * dx, y1 + k * dy);
}
/** where the line through a→b leaves the pane, going past b */
function rayEnd(x1, y1, x2, y2, w, h) {
  const dx = x2 - x1, dy = y2 - y1;
  if (!dx && !dy) return [x2, y2];
  let k = Infinity;
  if (dx > 0) k = Math.min(k, (w - x1) / dx); else if (dx < 0) k = Math.min(k, -x1 / dx);
  if (dy > 0) k = Math.min(k, (h - y1) / dy); else if (dy < 0) k = Math.min(k, -y1 / dy);
  if (!Number.isFinite(k)) k = 1;
  return [x1 + dx * Math.max(k, 1), y1 + dy * Math.max(k, 1)];
}

// text notes: a size (px) and an angle (radians), drawn rotated around their anchor point
const TEXT_FONT = (size) => `${size}px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif`;
let measureCtx = null;
function textBox(d) {
  const size = d.size || 14;
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = TEXT_FONT(size);
  const w = Math.max(size, measureCtx.measureText(d.text || '').width);
  return { w, size, x0: -4, x1: w + 4, y0: -size * 1.05, y1: size * 0.35 };
}
const rot = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
/** text handles in screen pixels: resize (bottom-right corner) and rotate (above the middle) */
function textHandles(d, v) {
  const ax = v.toX(d.p[0].t), ay = v.toY(d.p[0].p), a = d.angle || 0, b = textBox(d);
  const at = (lx, ly) => { const [rx, ry] = rot(lx, ly, a); return { x: ax + rx, y: ay + ry }; };
  return { anchor: { x: ax, y: ay }, size: at(b.x1, b.y1), rot: at(b.w / 2, b.y0 - 18), top: at(b.w / 2, b.y0), corners: [at(b.x0, b.y0), at(b.x1, b.y0), at(b.x1, b.y1), at(b.x0, b.y1)] };
}

// freehand: one drawing's points in a single list, `brk` marking where each further stroke starts (handwriting
// written as a group), each point with the pen's pressure `pr` when a tablet or stylus drew it
const strokesOf = (d, v) => {
  const out = [];
  const brk = d.brk || [];
  let from = 0;
  for (const to of [...brk, d.p.length]) {
    out.push(d.p.slice(from, to).map((q) => [v.toX(q.t), v.toY(q.p), q.pr ?? 0.5]));
    from = to;
  }
  return out;
};
/** The box around a brush drawing or a rectangle, in pixels: [x1, y1, x2, y2]. */
function pxBox(d, v) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const q of d.p) { const x = v.toX(q.t), y = v.toY(q.p); if (x == null || y == null) continue; x1 = Math.min(x1, x); x2 = Math.max(x2, x); y1 = Math.min(y1, y); y2 = Math.max(y2, y); }
  if (!Number.isFinite(x1)) return null;
  if (d.type === 'brush') { const pad = (d.width || 2) / 2 + 3; return [x1 - pad, y1 - pad, x2 + pad, y2 + pad]; }
  return [x1, y1, x2, y2];
}
const BOXED = new Set(['brush', 'rect']);
function boxHandles(d, v) {
  const b = pxBox(d, v);
  if (!b) return [];
  const [x1, y1, x2, y2] = b, mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  return [['nw', x1, y1], ['n', mx, y1], ['ne', x2, y1], ['e', x2, my], ['se', x2, y2], ['s', mx, y2], ['sw', x1, y2], ['w', x1, my]].map(([h, x, y]) => ({ i: `b:${h}`, x, y, box: true }));
}
const BOX_CURSOR = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };
const partCursor = (part) => (part === null ? '' : part === 'body' ? 'move' : part === 'rot' ? 'alias' : part === 'size' ? 'nwse-resize' : typeof part === 'string' && part.startsWith('b:') ? BOX_CURSOR[part.slice(2)] : 'grab');
/** `o` stretched by dragging its box handle `part` ('b:ne'…) to (x, y); Shift on a corner keeps its proportions. */
function resizeBox(o, part, x, y, v, keep) {
  const h = part.slice(2);
  const b = pxBox(o, v);
  if (!b) return o;
  const pad = o.type === 'brush' ? (o.width || 2) / 2 + 3 : 0;
  const [ox1, oy1, ox2, oy2] = [b[0] + pad, b[1] + pad, b[2] - pad, b[3] - pad];
  let [nx1, ny1, nx2, ny2] = [ox1, oy1, ox2, oy2];
  if (h.includes('n')) ny1 = Math.min(y + pad, oy2 - 4);
  if (h.includes('s')) ny2 = Math.max(y - pad, oy1 + 4);
  if (h.includes('w')) nx1 = Math.min(x + pad, ox2 - 4);
  if (h.includes('e')) nx2 = Math.max(x - pad, ox1 + 4);
  const ow = Math.max(1, ox2 - ox1), oh = Math.max(1, oy2 - oy1);
  let sx = (nx2 - nx1) / ow, sy = (ny2 - ny1) / oh;
  if (keep && h.length === 2) {
    sx = sy = Math.max(0.05, Math.max(sx, sy));
    if (h.includes('w')) nx1 = ox2 - ow * sx; else nx2 = ox1 + ow * sx;
    if (h.includes('n')) ny1 = oy2 - oh * sy; else ny2 = oy1 + oh * sy;
  }
  const p = o.p.map((q) => ({ ...q, t: v.fromX(nx1 + (v.toX(q.t) - ox1) * sx), p: v.fromY(ny1 + (v.toY(q.p) - oy1) * sy) }));
  if (o.type !== 'brush') return { ...o, p };
  const k = h.length === 2 ? Math.sqrt(sx * sy) : h === 'e' || h === 'w' ? Math.sqrt(sx) : Math.sqrt(sy);
  return { ...o, p, width: Math.round(Math.max(0.5, Math.min(60, (o.width || 2) * k)) * 10) / 10 };
}
/** Lines that run across the whole chart: grabbed with the cursor only, so drawing over them still draws. */
const SPANS = new Set(['hline', 'vline', 'hray', 'ray']);
/** The latest time a drawing reaches (local seconds). */
const lastTime = (d) => d.p.reduce((m, q) => Math.max(m, q.t), -Infinity);

/** Pixel positions of a drawing's handles. */
function handles(d, v) {
  const P = d.p.map((q) => ({ x: v.toX(q.t), y: v.toY(q.p) }));
  switch (d.type) {
    case 'hline': return [{ i: 0, x: 40, y: P[0].y }];
    case 'vline': return [{ i: 0, x: P[0].x, y: v.h / 2 }];
    case 'hray': return [{ i: 0, ...P[0] }];
    case 'text': { const t = textHandles(d, v); return [{ i: 'size', ...t.size }, { i: 'rot', ...t.rot }]; }
    case 'brush': return boxHandles(d, v);
    case 'rect': return boxHandles(d, v);
    case 'long': case 'short': return [{ i: 0, ...P[0] }, { i: 1, x: P[1].x, y: P[1].y }, { i: 2, x: P[1].x, y: P[2].y }];
    default: return P.map((q, i) => ({ i, ...q }));
  }
}

/** What part of the drawing is under (x, y): a handle index, 'body' or null. */
function hitDrawing(d, v, x, y, strict = false) {
  for (const hd of handles(d, v)) if (hd.box ? Math.abs(x - hd.x) <= 7 && Math.abs(y - hd.y) <= 7 : dist(x, y, hd.x, hd.y) < 8) return hd.i;
  if (d.type === 'rect') { // its edges stretch it, like the corners
    const b = pxBox(d, v);
    if (b) {
      const t = 5, inX = x >= b[0] - t && x <= b[2] + t, inY = y >= b[1] - t && y <= b[3] + t;
      const h = `${inX && Math.abs(y - b[1]) <= t ? 'n' : inX && Math.abs(y - b[3]) <= t ? 's' : ''}${inY && Math.abs(x - b[0]) <= t ? 'w' : inY && Math.abs(x - b[2]) <= t ? 'e' : ''}`;
      if (h) return `b:${h}`;
    }
  }
  if (strict) { // another tool is picked: grab lines, text and strokes themselves, but boxes only by the grip in their middle
    if (SPANS.has(d.type)) return null;
    if (['rect', 'measure', 'fib', 'vprofile', 'long', 'short'].includes(d.type)) {
      const P = d.p.map((q) => ({ x: v.toX(q.t), y: v.toY(q.p) }));
      const cx = (Math.min(...P.map((q) => q.x)) + Math.max(...P.map((q) => q.x))) / 2, cy = (Math.min(...P.map((q) => q.y)) + Math.max(...P.map((q) => q.y))) / 2;
      return dist(x, y, cx, cy) <= 11 ? 'body' : null;
    }
  }
  const P = d.p.map((q) => ({ x: v.toX(q.t), y: v.toY(q.p) }));
  const near = 6;
  const inBox = (a, b) => x >= Math.min(a.x, b.x) - 2 && x <= Math.max(a.x, b.x) + 2 && y >= Math.min(a.y, b.y) - 2 && y <= Math.max(a.y, b.y) + 2;
  switch (d.type) {
    case 'trend': return segDist(x, y, P[0].x, P[0].y, P[1].x, P[1].y) < near ? 'body' : null;
    case 'ray': { const [ex, ey] = rayEnd(P[0].x, P[0].y, P[1].x, P[1].y, v.w, v.h); return segDist(x, y, P[0].x, P[0].y, ex, ey) < near ? 'body' : null; }
    case 'hline': return Math.abs(y - P[0].y) < near ? 'body' : null;
    case 'hray': return x >= P[0].x - near && Math.abs(y - P[0].y) < near ? 'body' : null;
    case 'vline': return Math.abs(x - P[0].x) < near ? 'body' : null;
    case 'rect': case 'measure': case 'fib': return inBox(P[0], P[1]) ? 'body' : null;
    case 'vprofile': { const b = vpBox.get(d); return b && x >= b.x0 - 2 && x <= b.x1 + 2 && y >= b.y0 - 2 && y <= b.y1 + 2 ? 'body' : null; }
    case 'long': case 'short': return x >= Math.min(P[0].x, P[1].x) && x <= Math.max(P[0].x, P[1].x) && y >= Math.min(P[1].y, P[2].y) && y <= Math.max(P[1].y, P[2].y) ? 'body' : null;
    case 'brush': { const brk = new Set(d.brk || []); const tol = near + (d.width || 2) / 2; for (let i = 1; i < P.length; i++) if (!brk.has(i) && segDist(x, y, P[i - 1].x, P[i - 1].y, P[i].x, P[i].y) < tol) return 'body'; return null; }
    case 'text': { const b = textBox(d); const [lx, ly] = rot(x - P[0].x, y - P[0].y, -(d.angle || 0)); return lx >= b.x0 && lx <= b.x1 && ly >= b.y0 && ly <= b.y1 ? 'body' : null; }
    default: return null;
  }
}

function label(ctx, text, x, y, bg, fg = '#fff', align = 'left') {
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  const w = ctx.measureText(text).width + 10;
  const lx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  ctx.fillStyle = bg;
  ctx.fillRect(lx, y - 9, w, 18);
  ctx.fillStyle = fg;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, lx + 5, y);
}

/** Draws one drawing on the overlay canvas. */
function paint(ctx, d, v, selected, fmtP, tick, iv, data) {
  const P = d.p.map((q) => ({ x: v.toX(q.t), y: v.toY(q.p) }));
  if (P.some((q) => q.x == null || q.y == null || !Number.isFinite(q.x) || !Number.isFinite(q.y))) return;
  const col = d.color || DEFAULT_COLOR[d.type];
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.lineWidth = (d.width || 1.5) + (selected ? 0.5 : 0);
  ctx.setLineDash([]);
  const line = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
  switch (d.type) {
    case 'vprofile': {
      const x0 = Math.min(P[0].x, P[1].x), x1 = Math.max(P[0].x, P[1].x);
      const t0 = fromLocal(Math.min(d.p[0].t, d.p[1].t)), t1 = fromLocal(Math.max(d.p[0].t, d.p[1].t));
      const prof = data?.rows?.length ? profileFor(data, t0, t1 + 60) : null;
      ctx.strokeStyle = alpha(col, selected ? 0.9 : 0.35); ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      if (!prof) { ctx.strokeRect(x0, Math.min(P[0].y, P[1].y), x1 - x0, Math.abs(P[1].y - P[0].y)); ctx.setLineDash([]); vpBox.set(d, { x0, x1, y0: Math.min(P[0].y, P[1].y), y1: Math.max(P[0].y, P[1].y) }); break; }
      const yHi = v.toY(prof.lo + prof.n * prof.step), yLo = v.toY(prof.lo);
      ctx.strokeRect(x0, yHi, x1 - x0, yLo - yHi);
      ctx.setLineDash([]);
      drawProfile(ctx, prof, v, x0, Math.max(20, (x1 - x0) * 0.7), 'left', data.c, fmtP, x1, true);
      vpBox.set(d, { x0, x1, y0: yHi, y1: yLo });
      break;
    }
    case 'trend': line(P[0].x, P[0].y, P[1].x, P[1].y); break;
    case 'ray': { const [ex, ey] = rayEnd(P[0].x, P[0].y, P[1].x, P[1].y, v.w, v.h); line(P[0].x, P[0].y, ex, ey); break; }
    case 'hline': line(0, P[0].y, v.w, P[0].y); label(ctx, fmtP(d.p[0].p), v.w - 2, P[0].y, col, '#000', 'right'); break;
    case 'hray': line(P[0].x, P[0].y, v.w, P[0].y); label(ctx, fmtP(d.p[0].p), v.w - 2, P[0].y, col, '#000', 'right'); break;
    case 'vline': line(P[0].x, 0, P[0].x, v.h); break;
    case 'rect': {
      ctx.fillStyle = alpha(col, 0.14);
      ctx.fillRect(Math.min(P[0].x, P[1].x), Math.min(P[0].y, P[1].y), Math.abs(P[1].x - P[0].x), Math.abs(P[1].y - P[0].y));
      ctx.strokeRect(Math.min(P[0].x, P[1].x), Math.min(P[0].y, P[1].y), Math.abs(P[1].x - P[0].x), Math.abs(P[1].y - P[0].y));
      break;
    }
    case 'fib': {
      const x1 = Math.min(P[0].x, P[1].x), x2 = Math.max(P[0].x, P[1].x);
      const lv = FIB.map((l) => { const price = d.p[1].p + (d.p[0].p - d.p[1].p) * l; return { l, price, y: v.toY(price) }; });
      for (let i = 1; i < lv.length; i++) { ctx.fillStyle = alpha(col, i % 2 ? 0.07 : 0.12); ctx.fillRect(x1, lv[i - 1].y, x2 - x1, lv[i].y - lv[i - 1].y); }
      for (const q of lv) {
        ctx.strokeStyle = q.l === 0.5 || q.l === 0.618 ? col : alpha(col, 0.75);
        line(x1, q.y, x2, q.y);
        ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillStyle = col; ctx.textBaseline = 'bottom';
        ctx.fillText(`${q.l} (${fmtP(q.price)})`, x1 + 4, q.y - 2);
      }
      ctx.setLineDash([4, 4]); ctx.strokeStyle = alpha(col, 0.6); line(P[0].x, P[0].y, P[1].x, P[1].y); ctx.setLineDash([]);
      break;
    }
    case 'measure': {
      const up = d.p[1].p >= d.p[0].p;
      const c2 = up ? '#4da3e5' : '#e5484d';
      ctx.fillStyle = alpha(c2, 0.16);
      ctx.fillRect(Math.min(P[0].x, P[1].x), Math.min(P[0].y, P[1].y), Math.abs(P[1].x - P[0].x), Math.abs(P[1].y - P[0].y));
      ctx.strokeStyle = c2; ctx.lineWidth = 1;
      line((P[0].x + P[1].x) / 2, P[0].y, (P[0].x + P[1].x) / 2, P[1].y);
      line(P[0].x, (P[0].y + P[1].y) / 2, P[1].x, (P[0].y + P[1].y) / 2);
      const dp = d.p[1].p - d.p[0].p;
      const bars = Math.round(Math.abs(d.p[1].t - d.p[0].t) / iv);
      const mins = Math.round(Math.abs(d.p[1].t - d.p[0].t) / 60);
      const dur = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
      const txt = `${dp >= 0 ? '+' : ''}${fmtP(dp)}${tick ? ` (${Math.round(dp / tick)} ticks)` : ''} ${((dp / d.p[0].p) * 100).toFixed(2)}% · ${bars} bars, ${dur}`;
      label(ctx, txt, (P[0].x + P[1].x) / 2, up ? Math.min(P[0].y, P[1].y) - 14 : Math.max(P[0].y, P[1].y) + 14, c2, '#fff', 'center');
      break;
    }
    case 'long': case 'short': {
      const x1 = Math.min(P[0].x, P[1].x), x2 = Math.max(P[0].x, P[1].x);
      const entry = d.p[0].p, stop = d.p[1].p, target = d.p[2].p;
      ctx.fillStyle = alpha('#2bc48a', 0.18); ctx.fillRect(x1, Math.min(P[0].y, P[2].y), x2 - x1, Math.abs(P[2].y - P[0].y));
      ctx.fillStyle = alpha('#e5484d', 0.18); ctx.fillRect(x1, Math.min(P[0].y, P[1].y), x2 - x1, Math.abs(P[1].y - P[0].y));
      ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1; line(x1, P[0].y, x2, P[0].y);
      const risk = Math.abs(entry - stop), reward = Math.abs(target - entry);
      const tk = (x) => (tick ? ` · ${Math.round(x / tick)} ticks` : '');
      label(ctx, `Target ${fmtP(target)}${tk(reward)}`, x1, P[2].y + (P[2].y < P[0].y ? -11 : 11), '#1aa87f');
      label(ctx, `Stop ${fmtP(stop)}${tk(risk)}`, x1, P[1].y + (P[1].y > P[0].y ? 11 : -11), '#c53b40');
      label(ctx, `${d.type === 'long' ? 'Long' : 'Short'} ${fmtP(entry)} · R:R ${risk ? (reward / risk).toFixed(2) : '—'}`, x1, P[0].y, '#3f3f46');
      break;
    }
    case 'brush': {
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.lineWidth = d.width || 2;
      for (const st of strokesOf(d, v)) strokeSmooth(ctx, st, d.pr ? d.width || 2 : 0);
      if (selected) { const b = pxBox(d, v); if (b) { ctx.setLineDash([3, 3]); ctx.lineWidth = 1; ctx.strokeStyle = alpha(col, 0.6); ctx.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]); ctx.setLineDash([]); } }
      break;
    }
    case 'text': {
      ctx.save();
      ctx.translate(P[0].x, P[0].y);
      ctx.rotate(d.angle || 0);
      ctx.font = TEXT_FONT(d.size || 14);
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = col;
      ctx.fillText(d.text || '', 0, 0);
      ctx.restore();
      if (selected) {
        const t = textHandles(d, v);
        ctx.setLineDash([3, 3]); ctx.lineWidth = 1; ctx.strokeStyle = alpha(col, 0.7);
        ctx.beginPath(); t.corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y))); ctx.closePath(); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(t.top.x, t.top.y); ctx.lineTo(t.rot.x, t.rot.y); ctx.stroke();
        ctx.fillStyle = '#0a0a0a'; ctx.strokeStyle = col; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(t.rot.x, t.rot.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillRect(t.size.x - 4.5, t.size.y - 4.5, 9, 9); ctx.strokeRect(t.size.x - 4.5, t.size.y - 4.5, 9, 9);
      }
      return;
    }
    default:
  }
  if (selected) {
    for (const hd of handles(d, v)) {
      ctx.fillStyle = '#0a0a0a'; ctx.lineWidth = 1.5; ctx.strokeStyle = col;
      if (hd.box) { ctx.fillRect(hd.x - 4, hd.y - 4, 8, 8); ctx.strokeRect(hd.x - 4, hd.y - 4, 8, 8); continue; }
      ctx.beginPath(); ctx.arc(hd.x, hd.y, 4.5, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }
  }
}

/** Puts new data on a series, using update() when only the last bar changed or one was added (replay). */
function feed(series, data) {
  const n = series.__n || 0;
  const last = series.__last;
  if (n && data.length && ((data.length === n && data[n - 1].time === last) || (data.length === n + 1 && data[n - 1]?.time === last))) series.update(data[data.length - 1]);
  else series.setData(data);
  series.__n = data.length;
  series.__last = data.length ? data[data.length - 1].time : undefined;
}

/**
 * backtest (optional) turns the replay into a trading simulator: { symbol, pv ($ per point), fee (per contract), startTime
 * ('HH:MM' local), strategyId, onTrade(trade), onDay(date), label }. `trades` are then the session's trades on `date`.
 */
export default function ChartStudio({ date, trades: tradesIn, initialSym, onClose: closeStudio, onOpenTrade, backtest, candleSource, shotTo }) {
  const { state, setSetting, updateTrade, saveDiary } = useStore();
  const stateRef = useRef(state);
  stateRef.current = state;
  const [shotMsg, setShotMsg] = useState('');
  const bt = backtest || null;
  // ---------------------------------------------------------------- backtest position (simulated)
  const [pos, setPosState] = useState(null);
  const posRef = useRef(null);
  const setPos = (p) => { posRef.current = p; setPosState(p); };
  const [order, setOrder] = useState(() => ({ qty: 1, sl: '', tp: '', brk: true, ...(state.settings.btOrder || {}) }));
  // working limit / stop orders (backtest): { id, side, type: 'limit' | 'stop', price, qty }
  const [orders, setOrdersState] = useState([]);
  const ordersRef = useRef([]);
  const setOrders = (o) => { ordersRef.current = o; setOrdersState(o); };
  const [flash, setFlash] = useState(null);
  const trades = useMemo(() => {
    if (!bt || !pos) return tradesIn;
    const live = { id: '__open', symbol: bt.symbol, direction: pos.dir > 0 ? 'Long' : 'Short', qty: posQty(pos), pnl: 0, fills: [...pos.done, ...pos.lots.map((l) => ({ entry: localIsoOf(l.t), entryPrice: l.price, qty: l.qty }))] };
    return [...tradesIn, live];
  }, [tradesIn, pos, bt]);
  const symbols = useMemo(() => {
    if (bt) return [{ s: bt.symbol, c: tradesIn.length }];
    const n = new Map();
    for (const t of trades) n.set(t.symbol, (n.get(t.symbol) || 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([s, c]) => ({ s, c }));
  }, [trades, tradesIn.length, bt]);
  const [sym, setSym] = useState(bt ? bt.symbol : initialSym && symbols.some((x) => x.s === initialSym) ? initialSym : symbols[0]?.s);
  const studio = state.settings.studio || {};
  const setStudio = (patch) => setSetting('studio', { ...(state.settings.studio || {}), ...patch });
  const tf = TIMEFRAMES.includes(studio.tf) ? studio.tf : TIMEFRAMES.includes(state.settings.execTf) ? state.settings.execTf : '1m';
  const ind = useMemo(() => { const o = {}; for (const k of Object.keys(DEFAULT_IND)) o[k] = { ...DEFAULT_IND[k], ...(studio.ind?.[k] || {}) }; return o; }, [studio.ind]);
  const indRef = useRef(ind);
  indRef.current = ind;
  const indKey = JSON.stringify(ind);
  const magnet = !!studio.magnet;
  const showExec = studio.exec !== false;
  const span = Math.max(1, SPAN_DAYS[tf] || 0);
  const root = rootOf(sym);
  const tick = TICKS[root];
  const prec = tick ? decimals(tick) : 2;
  const fmtP = useCallback((v) => Number(v).toFixed(prec), [prec]);
  const themeKey = `${state.settings.themeId}|${state.settings.theme}|${JSON.stringify(state.settings.customThemes || [])}|${JSON.stringify(state.settings.chartColors || {})}`;

  // ---------------------------------------------------------------- data
  const [rec, setRec] = useState({ status: 'loading' });
  const [nonce, setNonce] = useState(0);
  /** One day of candles for this symbol (from the server, or the backtest's own data). */
  const fetchDay = (d, { refresh, want } = {}) => {
    if (candleSource) return Promise.resolve(candleSource(d));
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return fetch(`/api/candles?symbol=${encodeURIComponent(sym)}&date=${d}&tz=${encodeURIComponent(tz)}${refresh ? '&refresh=1' : ''}${want ? '&want=1' : ''}`)
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Error ${r.status}`); return j; });
  };
  useEffect(() => {
    if (!sym) return undefined;
    let alive = true;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const get = (d, refresh) => fetchDay(d, { refresh, want: bt && d === date });
    const extraDays = [];
    for (let i = 1; i <= span; i++) { const x = new Date(`${date}T12:00:00`); x.setDate(x.getDate() - i); if (x.getDay() !== 6) extraDays.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`); }
    setRec({ status: 'loading' });
    Promise.all([get(date, nonce > 0), Promise.all(extraDays.map((d) => get(d).then((j) => j.candles || []).catch(() => [])))])
      .then(([j, more]) => {
        if (!alive) return;
        const byT = new Map();
        for (const c of [...more.flat(), ...(j.candles || [])]) byT.set(c[0], c);
        setRec({ status: 'ok', ...j, candles: [...byT.values()].sort((x, y) => x[0] - y[0]), key: `${sym}|${date}|${span}` });
      })
      .catch((e) => alive && setRec({ status: 'error', error: e.message }));
    return () => { alive = false; };
  }, [sym, date, span, nonce]);
  // Earlier history: scrolling to the chart's left edge loads the days before, a few at a time (like TradingView),
  // without rebuilding the chart or losing your place. It stops where the saved prices get coarser than the
  // timeframe you're on (Yahoo keeps 1-minute bars for 30 days, 2–15 minute for 60 and hourly for 2 years).
  const histKey = `${sym}|${date}|${span}|${tf}`;
  const [histState, setHist] = useState({ key: '' });
  const hist = histState.key === histKey ? histState : { key: histKey, candles: [], back: 0, empty: 0, busy: false, done: '', added: 0, n: 0 };
  const histRef = useRef(hist);
  histRef.current = hist;
  const rows = useMemo(() => {
    const base = rec.status === 'ok' ? rec.candles || [] : [];
    if (!hist.candles.length || !base.length) return base;
    const first = base[0][0];
    return [...hist.candles.filter((c) => c[0] < first), ...base];
  }, [rec, hist.candles]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadEarlier = async () => {
    const h = histRef.current;
    const base = rec.status === 'ok' ? rec.candles || [] : [];
    if (h.busy || h.done || !base.length) return;
    const key = h.key;
    setHist({ ...h, busy: true });
    const show = Math.max(ivSec(tf), ivSec(rec.interval || '1m'));
    const chunk = show >= 3600 ? 10 : 3;
    const days = [];
    let back = h.back;
    while (days.length < chunk && back < 400) {
      back += 1;
      const x = new Date(`${date}T12:00:00`); x.setDate(x.getDate() - span - back);
      if (x.getDay() !== 6) days.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`);
    }
    const recs = await Promise.all(days.map((d) => fetchDay(d, { want: !!bt }).catch(() => null))); // a backtest asks add-ons for days they can fetch
    let empty = h.empty, done = '';
    const got = new Map();
    for (const r of recs) { // newest day first
      if (!r?.candles?.length) { empty += 1; continue; }
      if (ivSec(r.interval || '1m') > show) { done = `Earlier ${sym} prices are ${tfLabel(r.interval)} bars only — switch to ${tfLabel(r.interval)} to scroll further back.`; break; }
      empty = 0;
      for (const c of r.candles) got.set(c[0], c);
    }
    if (!done && empty >= 10) done = `No earlier ${sym} prices.`;
    if (!done && back >= 400) done = 'That’s as far back as the chart scrolls.';
    setHist((cur) => {
      if ((cur.key || '') !== key) return cur; // the symbol, day or timeframe changed meanwhile
      const old = cur.candles || [];
      const first = old.length ? old[0][0] : base[0][0];
      const add = [...got.values()].filter((c) => c[0] < first).sort((a, b) => a[0] - b[0]);
      return { ...cur, key, candles: [...add, ...old], back, empty, busy: false, done, added: add.length, n: (cur.n || 0) + 1 };
    });
  };
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const loadEarlierRef = useRef(loadEarlier);
  loadEarlierRef.current = loadEarlier;
  // backtest: a day without bars yet may be on its way from your platform add-on — look again for a few minutes
  const tries = useRef(0);
  useEffect(() => { tries.current = 0; }, [date, sym]);
  useEffect(() => {
    if (!bt || (rec.status === 'ok' && rows.length) || rec.status === 'loading' || tries.current >= 8) return undefined;
    const id = setTimeout(() => { tries.current += 1; setNonce((n) => n + 1); }, 20000);
    return () => clearTimeout(id);
  }, [rec, bt]); // eslint-disable-line react-hooks/exhaustive-deps
  const srcIv = ivSec(rec.interval || '1m');
  const iv = Math.max(ivSec(tf), srcIv);
  const symTrades = useMemo(() => trades.filter((t) => t.symbol === sym), [trades, sym]);
  const symTradesRef = useRef(symTrades);
  symTradesRef.current = symTrades;

  // ---------------------------------------------------------------- drawings (saved per instrument)
  const saved = state.settings.chartDrawings?.[root];
  const [drawings, setDrawings] = useState(() => saved || []);
  const drawingsRef = useRef(drawings);
  drawingsRef.current = drawings;
  const loadedRoot = useRef(root);
  useEffect(() => { if (loadedRoot.current !== root) { loadedRoot.current = root; setDrawings(state.settings.chartDrawings?.[root] || []); history.current = []; } }, [root]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveTimer = useRef(null);
  useEffect(() => {
    if (IS_VIEWER) return undefined; // a shared journal can be drawn on, but nothing is saved
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const all = state.settings.chartDrawings || {};
      if (JSON.stringify(all[loadedRoot.current] || []) === JSON.stringify(drawings)) return;
      setSetting('chartDrawings', { ...all, [loadedRoot.current]: drawings });
    }, 600);
    return () => clearTimeout(saveTimer.current);
  }, [drawings]); // eslint-disable-line react-hooks/exhaustive-deps
  const history = useRef([]);
  const commit = (next) => { history.current = [...history.current.slice(-49), drawingsRef.current]; drawingsRef.current = next; setDrawings(next); };
  const undo = () => { const prev = history.current.pop(); if (prev) { drawingsRef.current = prev; setDrawings(prev); setSel(null); } };

  const [tool, setToolState] = useState('cursor');
  const toolRef = useRef(tool);
  const setTool = (t) => { toolRef.current = t; setToolState(t); draft.current = null; pendingInk.current = null; setGrpOpen(false); };
  const [sel, setSelState] = useState(null);
  const selRef = useRef(sel);
  const setSel = (id) => { selRef.current = id; setSelState(id); };
  const [hidden, setHidden] = useState(false);
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  const [editing, setEditing] = useState(null); // { id, x, y, text }
  const draft = useRef(null); // drawing being created
  const drag = useRef(null); // { id, part, x0, y0, orig }
  const magnetRef = useRef(magnet);
  magnetRef.current = magnet;
  // the brush: its colour and size (remembered), and handwriting grouping (shared with the screenshot editor)
  const [brushCfg, setBrushCfgS] = useState(() => store.get('rf-chart-brush', { color: DEFAULT_COLOR.brush, width: 2 }));
  const brushRef = useRef(brushCfg);
  brushRef.current = brushCfg;
  const setBrushCfg = (patch) => setBrushCfgS((o) => { const n = { ...o, ...patch }; store.set('rf-chart-brush', n); return n; });
  const [grp, setGrpS] = useState(() => store.get(GROUP_KEY, GROUP_DEFAULT));
  const grpRef = useRef(grp);
  grpRef.current = grp;
  const setGrp = (g) => { setGrpS(g); store.set(GROUP_KEY, g); };
  const [grpOpen, setGrpOpen] = useState(false);
  const pendingInk = useRef(null); // { id, at }: the handwriting group still taking strokes
  // while replaying (or backtesting), drawings that reach past the last bar shown are hidden; local seconds
  const shownUntil = useRef(Infinity);
  const isShown = (d) => { const U = shownUntil.current; return U === Infinity || lastTime(d) <= U || (d.born != null && d.born <= U); };
  /** Made or moved during a replay: stays visible from this point of the replay on, even where it reaches past it. */
  const stamp = (d) => { const U = shownUntil.current; return U === Infinity || lastTime(d) <= U ? d : { ...d, born: d.born != null ? Math.min(d.born, U) : U }; };
  // live changes from a slider: one undo step per drag, not one per pixel
  const sliding = useRef(false);
  const liveSet = (patch) => {
    if (!sliding.current) { history.current = [...history.current.slice(-49), drawingsRef.current]; sliding.current = true; }
    const next = drawingsRef.current.map((d) => (d.id === selRef.current ? { ...d, ...patch } : d));
    drawingsRef.current = next; setDrawings(next);
  };

  // ---------------------------------------------------------------- replay
  const [replay, setReplay] = useState({ mode: 'off', idx: 0, playing: false, speed: 5, tickSpeed: 2, sub: 0, subAt: -1 });
  const replayRef = useRef(replay);
  replayRef.current = replay;

  // ---------------------------------------------------------------- tick-by-tick replay
  // When a source has the day's ticks (Databento with a key; ATAS through Journal Sync 1.5) the replay moves trade by
  // trade inside each bar: the bar builds up tick by tick and orders fill at the traded prices. `sub` = ticks of bar
  // `subAt` (the one after idx) shown so far.
  const tickWanted = studio.ticks !== false && !candleSource && srcIv <= 60;
  const ticksRef = useRef(new Map()); // UTC hour start → [[ms, price, size, side]] | 'pending' | 'none'
  const pendingSince = useRef(new Map());
  const barTicks = useRef(new Map()); // row time → that bar's ticks (cut from its hour once)
  const tickedTimes = useRef(new Set()); // bars already played tick by tick (their orders are done)
  const [tickVer, setTickVer] = useState(0);
  const [tickState, setTickState] = useState({ status: 'idle', source: '' });
  useEffect(() => { ticksRef.current = new Map(); barTicks.current = new Map(); pendingSince.current = new Map(); setTickState({ status: 'idle', source: '' }); }, [sym]);
  /** The ticks of bar i: an array (maybe empty), 'pending' (asked for), 'none', or undefined (not loaded yet). */
  const ticksForBar = (i) => {
    const row = rows[i];
    if (!row) return null;
    if (barTicks.current.has(row[0])) return barTicks.current.get(row[0]);
    const got = ticksRef.current.get(row[0] - (row[0] % 3600));
    if (!Array.isArray(got)) return got;
    const a = row[0] * 1000, b = (row[0] + srcIv) * 1000;
    let lo = 0, hi = got.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (got[m][0] < a) lo = m + 1; else hi = m; }
    let j = lo;
    while (j < got.length && got[j][0] < b) j++;
    const part = got.slice(lo, j);
    barTicks.current.set(row[0], part);
    return part;
  };
  const tickHour = replay.mode === 'on' && rows[replay.idx] ? rows[replay.idx][0] - (rows[replay.idx][0] % 3600) : null;
  // a new day: forget what was still on its way (it's asked for again for the hours you now need)
  useEffect(() => {
    for (const [h, v] of ticksRef.current) if (!Array.isArray(v)) ticksRef.current.delete(h);
    pendingSince.current = new Map();
    barTicks.current = new Map();
    setTickState({ status: 'idle', source: '' });
  }, [date]);
  useEffect(() => {
    if (!tickWanted || tickHour == null) return undefined;
    let alive = true, timer;
    const NAME = { atas: 'ATAS', ninjatrader: 'NinjaTrader', quantower: 'Quantower', metatrader: 'MetaTrader', ctrader: 'cTrader', sierrachart: 'Sierra Chart', databento: 'Databento', polygon: 'Polygon', demo: 'demo', snapshot: 'saved', ...(IS_VIEWER ? { atas: 'saved', ninjatrader: 'saved', quantower: 'saved', metatrader: 'saved', ctrader: 'saved', sierrachart: 'saved' } : {}) };
    const load = async () => {
      // the hour the replay is in and the next one, in one request; 'slow' hours (waited a long time) keep being checked
      const need = [tickHour, tickHour + 3600].filter((h) => { const g = ticksRef.current.get(h); return g === undefined || g === 'pending' || g === 'slow'; });
      if (!need.length) return;
      let again = 0;
      try {
        const from = need[0], to = need[need.length - 1] + 3600;
        const r = await fetch(`/api/candles/ticks?symbol=${encodeURIComponent(sym)}&from=${from}&to=${to}`);
        const j = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!r.ok) {
          for (const h of need) ticksRef.current.set(h, 'none');
          setTickState((x) => (x.status === 'ok' ? x : { status: 'none', source: '' }));
        } else {
          const have = new Set(j.hours?.have || []), pend = new Set(j.hours?.pending || []);
          const byHour = new Map();
          for (const t of j.ticks || []) { const h = Math.floor(t[0] / 1000 / 3600) * 3600; if (!byHour.has(h)) byHour.set(h, []); byHour.get(h).push(t); }
          const via = NAME[j.from] || j.from || '';
          for (const h of need) {
            if (have.has(h)) { ticksRef.current.set(h, byHour.get(h) || []); pendingSince.current.delete(h); setTickState({ status: 'ok', source: j.sources?.[0] || '', name: NAME[j.sources?.[0]] || j.sources?.[0] || '' }); continue; }
            if (pend.has(h)) {
              if (!pendingSince.current.has(h)) pendingSince.current.set(h, Date.now());
              const slow = Date.now() - pendingSince.current.get(h) > 180e3;
              ticksRef.current.set(h, slow ? 'slow' : 'pending'); // slow: replay with bars meanwhile, keep checking
              again = slow ? 10000 : 3000;
              setTickState((x) => (x.status === 'ok' ? x : { status: slow ? 'timeout' : 'pending', source: j.from || '', name: via, addon: j.addon }));
              continue;
            }
            ticksRef.current.set(h, 'none');
            if (!j.canFetch) setTickState((x) => (x.status === 'ok' ? x : { status: 'none', source: '' }));
          }
        }
      } catch { if (alive) again = 10000; }
      barTicks.current = new Map();
      setTickVer((v) => v + 1);
      if (again && alive) timer = setTimeout(load, again);
    };
    load();
    return () => { alive = false; clearTimeout(timer); };
  }, [tickWanted, tickHour, sym, date]); // eslint-disable-line react-hooks/exhaustive-deps
  const tickActive = tickWanted && (tickState.status === 'ok' || tickState.status === 'pending' || tickState.status === 'timeout');
  const hoverX = useRef(null);

  // ---------------------------------------------------------------- chart
  const stage = useRef(null);
  const box = useRef(null);
  const overlay = useRef(null);
  const legend = useRef(null);
  const tipRef = useRef(null);
  const api = useRef({});
  const openRef = useRef(onOpenTrade);
  openRef.current = onOpenTrade;

  const view = () => {
    const a = api.current;
    if (!a.chart || !a.bars?.length) return null;
    const ts = a.chart.timeScale();
    const T = a.barTimes, n = T.length;
    const toLogical = (t) => {
      if (t <= T[0]) return (t - T[0]) / a.iv;
      if (t >= T[n - 1]) return n - 1 + (t - T[n - 1]) / a.iv;
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
      return lo + (t - T[lo]) / (T[hi] - T[lo]);
    };
    const fromLogical = (l) => {
      if (l <= 0) return T[0] + l * a.iv;
      if (l >= n - 1) return T[n - 1] + (l - (n - 1)) * a.iv;
      const i = Math.floor(l);
      return T[i] + (l - i) * (T[i + 1] - T[i]);
    };
    let h = 0;
    try { h = a.chart.paneSize(0).height; } catch { h = (box.current?.clientHeight || 0) - ts.height(); }
    return {
      w: ts.width(), h,
      toX: (t) => ts.logicalToCoordinate(toLogical(t)),
      toY: (p) => a.series.priceToCoordinate(p),
      fromX: (x) => fromLogical(ts.coordinateToLogical(x)),
      fromY: (y) => a.series.coordinateToPrice(y),
      snap: (x, y) => { // magnet: the nearest open/high/low/close of the bar under the pointer
        const l = Math.round(ts.coordinateToLogical(x));
        const b = a.bars[Math.max(0, Math.min(n - 1, l))];
        const pr = [b.open, b.high, b.low, b.close].sort((p1, p2) => Math.abs(a.series.priceToCoordinate(p1) - y) - Math.abs(a.series.priceToCoordinate(p2) - y))[0];
        return { t: b.time, p: pr };
      },
    };
  };

  // build the chart
  useEffect(() => {
    if (rec.status !== 'ok' || !rows.length || !box.current || rec.key !== `${sym}|${date}|${span}`) return undefined;
    let cancelled = false;
    let chart;
    loadLib().then((LW) => {
      if (cancelled || !box.current) return;
      const c = chartColors(state.settings.chartColors);
      chart = LW.createChart(box.current, {
        autoSize: true,
        layout: { background: { type: 'solid', color: c.bg }, textColor: c.text, fontFamily: c.font, fontSize: 11, attributionLogo: true, panes: { separatorColor: c.border } },
        grid: { vertLines: { color: alpha(c.border, 0.5) }, horzLines: { color: alpha(c.border, 0.5) } },
        rightPriceScale: { borderColor: c.border, scaleMargins: { top: 0.08, bottom: ind.volume.on ? 0.18 : 0.08 } },
        timeScale: { borderColor: c.border, timeVisible: iv < 86400, secondsVisible: false, rightOffset: 8, barSpacing: 7, shiftVisibleRangeOnNewBar: true },
        crosshair: { mode: 0 },
      });
      const series = chart.addSeries(LW.CandlestickSeries, {
        upColor: c.up, downColor: c.down, wickUpColor: c.wickUp, wickDownColor: c.wickDown, borderUpColor: c.wickUp, borderDownColor: c.wickDown, borderVisible: c.wickUp !== c.up || c.wickDown !== c.down,
        priceFormat: { type: 'price', precision: prec, minMove: tick || 0.01 }, priceLineVisible: true,
      });
      const line = (color, pane = 0, extra = {}) => chart.addSeries(LW.LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...extra }, pane);
      const inds = [];
      const sess = (b) => sessionStart(fromLocal(b.time));
      if (ind.ema1.on) inds.push({ s: line('#f5a623'), f: (b) => ema(b, ind.ema1.n) });
      if (ind.ema2.on) inds.push({ s: line('#4da3e5'), f: (b) => ema(b, ind.ema2.n) });
      if (ind.sma.on) inds.push({ s: line('#c084fc'), f: (b) => sma(b, ind.sma.n) });
      if (ind.vwap.on && iv < 86400) inds.push({ s: line('#e5e7eb', 0, { lineWidth: 2, lineStyle: 2 }), f: (b) => vwap(b, sess) });
      if (ind.bb.on) {
        let cache = null;
        const bb = (b) => { if (cache?.b !== b) cache = { b, v: bollinger(b, ind.bb.n, ind.bb.k) }; return cache.v; };
        inds.push({ s: line(alpha('#94a3b8', 0.9)), f: (b) => bb(b).upper }, { s: line(alpha('#94a3b8', 0.6), 0, { lineStyle: 2 }), f: (b) => bb(b).mid }, { s: line(alpha('#94a3b8', 0.9)), f: (b) => bb(b).lower });
      }
      if (ind.gex?.on && GEX_FUT.has(rootOf(sym)) && iv < 86400) { // saved levels, stepped where they changed (only up to the replay's time)
        const lvl = (key, color, title, style = 0) => inds.push({ s: line(color, 0, { lineWidth: 1.5, lineStyle: style, lineType: 1, lastValueVisible: true, title }), f: (b) => gexSeries(b, key) });
        lvl('callWall', c.up, 'Call wall'); lvl('putWall', c.down, 'Put wall'); lvl('flip', '#8b6dff', 'Flip', 2);
      }
      if (ind.volume.on) {
        const vol = chart.addSeries(LW.HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false });
        chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.86, bottom: 0 } });
        inds.push({ s: vol, f: (b) => b.map((x) => ({ time: x.time, value: x.volume, color: alpha(x.close >= x.open ? c.up : c.down, 0.45) })) });
      }
      let pane = 1;
      if (ind.rsi.on) {
        const s = line('#a78bfa', pane, { lastValueVisible: true, priceFormat: { type: 'price', precision: 1, minMove: 0.1 } });
        s.createPriceLine({ price: 70, color: alpha(c.text, 0.5), lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
        s.createPriceLine({ price: 30, color: alpha(c.text, 0.5), lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
        inds.push({ s, f: (b) => rsi(b, ind.rsi.n) });
        pane += 1;
      }
      if (ind.macd.on) {
        let cache = null;
        const m = (b) => { if (cache?.b !== b) cache = { b, v: macd(b) }; return cache.v; };
        const hist = chart.addSeries(LW.HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane);
        inds.push(
          { s: hist, f: (b) => m(b).hist.map((p) => ({ ...p, color: alpha(p.value >= 0 ? c.up : c.down, 0.55) })) },
          { s: line('#4da3e5', pane), f: (b) => m(b).line },
          { s: line('#f59e0b', pane), f: (b) => m(b).signal },
        );
        pane += 1;
      }
      // RSI / MACD panes: a fixed share of the height. A height change lands on the next frame and takes room from
      // the other panes, so each pane is set in its own step, a few rounds, until they settle.
      const sizePanes = (step = 0) => {
        if (cancelled) return;
        try {
          const ps = chart.panes();
          if (ps.length < 2 || step > ps.length * 4) return;
          const total = ps.reduce((sum, p) => sum + p.getHeight(), 0);
          const k = Math.max(80, Math.round(total * 0.15));
          const want = (i) => (i ? k : total - k * (ps.length - 1));
          if (ps.every((p, i) => Math.abs(p.getHeight() - want(i)) <= 2)) return;
          const i = step % ps.length;
          ps[i].setHeight(want(i));
          setTimeout(() => sizePanes(step + 1), 20);
        } catch { /* older library */ }
      };
      setTimeout(() => sizePanes(), 30);
      const markers = LW.createSeriesMarkers(series, []);
      // the entry → exit lines (one series per trade, filled as the replay reaches the exit)
      const toBar = (u) => barTime(u, iv);
      const allEx = buildExecutions(symTrades, aggregate(rows, iv).map((x) => x.time), toBar);
      const lineFor = (ln) => line(alpha(ln.pnl >= 0 ? c.win : c.loss, 0.85), 0, { lineStyle: 2, pointMarkersVisible: false });
      const lines = new Map(allEx.lines.map((ln) => [ln.id, lineFor(ln)]));
      api.current = { chart, series, inds, markers, lines, lineFor, iv, toBar, c, bars: [], barTimes: [], allEx };
      render();
      const fit = () => {
        const a = api.current;
        if (replayRef.current.mode === 'on') return;
        if (!Number.isFinite(allEx.first)) { chart.timeScale().fitContent(); return; }
        const pad = Math.max(45 * 60, (allEx.last - allEx.first) * 0.25, iv * 25);
        try { chart.timeScale().setVisibleRange({ from: Math.max(a.barTimes[0], allEx.first - pad), to: Math.min(a.barTimes[a.barTimes.length - 1] + iv * 5, allEx.last + pad) }); } catch { chart.timeScale().fitContent(); }
      };
      api.current.fit = fit;
      requestAnimationFrame(() => !cancelled && (replayRef.current.mode === 'on' ? focusReplay() : fit()));

      // OHLC readout, execution tips and clicks
      const showOhlc = (d) => {
        if (!legend.current) return;
        if (!d) { legend.current.textContent = ''; return; }
        const chg = d.close - d.open;
        legend.current.innerHTML = `O <b>${fmtP(d.open)}</b> H <b>${fmtP(d.high)}</b> L <b>${fmtP(d.low)}</b> C <b style="color:${chg >= 0 ? c.up : c.down}">${fmtP(d.close)}</b> <span style="color:${chg >= 0 ? c.up : c.down}">${chg >= 0 ? '+' : ''}${fmtP(chg)}</span>`;
      };
      api.current.showOhlc = showOhlc;
      const byId = { get: (id) => symTradesRef.current.find((t) => t.id === id) }; // trades taken in a backtest arrive later
      const hitExec = (pt) => {
        if (!pt || !api.current.shownMarkers) return null;
        let best = null, bestD = 14;
        for (const m of api.current.shownMarkers) {
          const x = chart.timeScale().timeToCoordinate(m.time);
          const y0 = series.priceToCoordinate(m.price);
          if (x == null || y0 == null) continue;
          const y = y0 + (m.side === 'buy' ? 9 : -9);
          const dd = Math.hypot(pt.x - x, pt.y - y);
          if (dd < bestD) { bestD = dd; best = { m, x, y }; }
        }
        return best;
      };
      const tip = (h) => {
        const el = tipRef.current;
        if (!el) return;
        if (!h || toolRef.current !== 'cursor') { el.style.display = 'none'; return; }
        const t = byId.get(h.m.ids[0]);
        if (!t) return;
        const priv = state.settings.privacy;
        el.innerHTML = `<b>${h.m.side === 'buy' ? 'Buy' : 'Sell'} ${h.m.qty} @ ${fmtP(h.m.price)}</b><span>${t.direction} ${t.symbol} · ${fmtTime12(t.entry)} → ${fmtTime12(t.exit)}</span><span><em style="color:${t.pnl >= 0 ? c.win : c.loss}">${priv ? '•••' : fmtMoney(t.pnl, { sign: true })}</em></span>${openRef.current ? '<small>Click to review</small>' : ''}`;
        el.style.display = 'block';
        el.style.left = `${Math.min(Math.max(8, h.x + 12), box.current.clientWidth - 210)}px`;
        el.style.top = `${Math.max(8, h.y + (h.m.side === 'buy' ? 12 : -80))}px`;
      };
      chart.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (r && r.from < 3 && !cancelled) loadEarlierRef.current(); });
      chart.subscribeCrosshairMove((p) => {
        showOhlc(p?.seriesData?.get(series) || api.current.bars[api.current.bars.length - 1]);
        tip(hitExec(p?.point));
      });
      chart.subscribeClick((p) => {
        if (toolRef.current !== 'cursor' || drag.current) return;
        const h = hitExec(p?.point);
        const t = h && byId.get(h.m.ids[0]);
        if (t && openRef.current) openRef.current(t);
      });
    }).catch((e) => !cancelled && setRec({ status: 'error', error: e.message }));
    return () => { cancelled = true; if (chart) chart.remove(); api.current = {}; };
  }, [rec, themeKey, tf, indKey, sym, showExec]); // eslint-disable-line react-hooks/exhaustive-deps

  // GEX levels: the saved levels of the days on the chart (today's again every 5 minutes)
  useEffect(() => {
    if (!ind.gex?.on || !GEX_FUT.has(rootOf(sym)) || !rows.length) return undefined;
    const root = rootOf(sym);
    const days = [...new Set([rows[0][0], ...rows.filter((_, i) => i % 60 === 0).map((r) => r[0]), rows[rows.length - 1][0]].map((t) => nyDay(t * 1000)))].slice(-10);
    const key = `${root}|${days.join(',')}`;
    let alive = true;
    const load = () => Promise.all(days.map((d) => fetch(`/api/macro/gex/levels?fut=${root}&date=${d}`).then((r) => (r.ok ? r.json() : { levels: [] })).then((j) => j.levels || []).catch(() => [])))
      .then((all) => { if (!alive) return; gexStore.key = key; gexStore.list = all.flat().sort((x, y) => x.t - y.t); render(); });
    if (gexStore.key !== key) gexStore.list = [];
    load();
    const id = days.includes(nyDay(Date.now())) ? setInterval(load, 5 * 60e3) : null;
    return () => { alive = false; if (id) clearInterval(id); };
  }, [indKey, sym, rows.length ? rows[0][0] : 0, rows.length ? rows[rows.length - 1][0] : 0]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Puts the candles (up to the replay position), indicators and executions on the chart. */
  function render() {
    const a = api.current;
    if (!a.chart || !rows.length) return;
    const r = replayRef.current;
    const hide = r.mode === 'on' || (bt && r.mode === 'pick'); // a backtest never shows bars past the replay
    const end = hide ? Math.min(r.idx, rows.length - 1) : rows.length - 1;
    let vis = hide ? rows.slice(0, end + 1) : rows;
    let tickUntil = null;
    if (hide && r.sub > 0 && r.subAt === end + 1) { // tick replay: the bar being built
      const tk = ticksForBar(end + 1);
      if (Array.isArray(tk) && tk.length) {
        const part = tk.slice(0, r.sub);
        let hi = -Infinity, lo = Infinity, vol = 0;
        for (const t of part) { if (t[1] > hi) hi = t[1]; if (t[1] < lo) lo = t[1]; vol += t[2]; }
        vis = [...vis, [rows[end + 1][0], part[0][1], hi, lo, part[part.length - 1][1], vol]];
        tickUntil = Math.floor(part[part.length - 1][0] / 1000);
      }
    }
    const bars = aggregate(vis, a.iv);
    feed(a.series, bars);
    for (const x of a.inds) feed(x.s, x.f(bars));
    a.bars = bars;
    a.barTimes = bars.map((b) => b.time);
    const until = tickUntil ?? (hide ? rows[end][0] + srcIv - 1 : Infinity);
    const ex = showExec ? buildExecutions(symTrades, a.barTimes, a.toBar, until) : { markers: [], lines: [] };
    a.shownMarkers = ex.markers;
    a.markers.setMarkers(ex.markers.map((m) => ({ time: m.time, position: m.side === 'buy' ? 'atPriceBottom' : 'atPriceTop', price: m.price, shape: m.side === 'buy' ? 'arrowUp' : 'arrowDown', color: m.side === 'buy' ? a.c.buy : a.c.sell, text: m.qty > 1 ? String(m.qty) : '', size: 1 })));
    const shown = new Map(ex.lines.map((ln) => [ln.id, ln.points]));
    for (const ln of ex.lines) if (!a.lines.has(ln.id) && a.lineFor) a.lines.set(ln.id, a.lineFor(ln));
    for (const [id, s] of a.lines) { const pts = shown.get(id) || []; if ((s.__n || 0) !== pts.length) { s.setData(pts); s.__n = pts.length; } }
    drawPosLines();
    a.showOhlc?.(bars[bars.length - 1]);
  }
  /** Backtest: the open position's average price, stop and target as lines on the chart. */
  function drawPosLines() {
    const a = api.current;
    if (!a.series) return;
    if (a.posLinesOn !== a.series) { a.posLines = []; a.posLinesOn = a.series; }
    for (const l of a.posLines) { try { a.series.removePriceLine(l); } catch { /* chart rebuilt */ } }
    a.posLines = [];
    a.tagLines = new Map();
    if (!bt) return;
    const add = (key, price, color, style = 2) => { const l = a.series.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title: '' }); a.posLines.push(l); a.tagLines.set(key, l); };
    const p = posRef.current;
    if (p && posQty(p)) {
      add('pos', posAvg(p), a.c.text, 0);
      if (p.stop != null) add('sl', p.stop, a.c.loss);
      if (p.target != null) add('tp', p.target, a.c.win);
    }
    for (const o of ordersRef.current) add(o.id, o.price, o.side > 0 ? a.c.buy : a.c.sell, 1);
  }
  const renderRef = useRef(render);
  renderRef.current = render;
  useEffect(() => { renderRef.current(); }, [replay.idx, replay.mode, replay.sub]);

  // earlier days arrived: rows moved along by `added`, so the replay position follows and the view stays put
  useEffect(() => {
    const k = hist.added;
    const a = api.current;
    if (!a.chart) return;
    if (!k) { // nothing in those days (a holiday, a weekend): keep going while you're still at the edge
      const r0 = a.chart.timeScale().getVisibleLogicalRange();
      if (hist.n && !hist.done && r0 && r0.from < 3) loadEarlierRef.current();
      return;
    }
    const range = a.chart.timeScale().getVisibleLogicalRange();
    const before = a.bars.length;
    replayRef.current = { ...replayRef.current, idx: replayRef.current.idx + k };
    if (lastIdx.current >= 0) lastIdx.current += k;
    setReplay((r) => ({ ...r, idx: r.idx + k, subAt: r.subAt >= 0 ? r.subAt + k : r.subAt }));
    renderRef.current();
    const moved = a.bars.length - before;
    if (range && moved > 0) { try { a.chart.timeScale().setVisibleLogicalRange({ from: range.from + moved, to: range.to + moved }); } catch { /* */ } }
  }, [hist.n]); // eslint-disable-line react-hooks/exhaustive-deps

  function focusReplay() {
    const a = api.current;
    if (!a.chart) return;
    const n = a.bars.length;
    try { a.chart.timeScale().setVisibleLogicalRange({ from: n - 90, to: n + 25 }); } catch { /* */ }
  }

  // ---------------------------------------------------------------- overlay: drawings, the replay start line
  useEffect(() => {
    let raf;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const cv = overlay.current;
      const v = view();
      if (!cv) return;
      const dpr = window.devicePixelRatio || 1;
      const W = box.current?.clientWidth || 0, H = box.current?.clientHeight || 0;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = `${W}px`; cv.style.height = `${H}px`; }
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const tg = tagsRef.current, a = api.current;
      if (tg && a.series && v) {
        let psw = 0;
        try { psw = a.chart.priceScale('right').width(); } catch { /* */ }
        for (const el of tg.children) {
          const dragging = tagDrag.current?.key === el.dataset.key;
          const price = dragging ? tagDrag.current.price : Number(el.dataset.price);
          const y = a.series.priceToCoordinate(price);
          if (y == null || y < 0 || y > v.h) { el.style.visibility = 'hidden'; continue; }
          el.style.visibility = '';
          el.style.transform = `translateY(${Math.round(y - 11)}px)`;
          el.style.right = `${psw + 8}px`;
          const px = el.querySelector('.ot-px');
          if (px && dragging) px.textContent = fmtP(price);
        }
      }
      if (!v) return;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, v.w, v.h); ctx.clip();
      // volume profile: what's on the chart up to the replay position (never later bars)
      const R = rowsRef.current, rp = replayRef.current;
      const until = R.length ? ((rp.mode === 'on' || (bt && rp.mode === 'pick')) && R[rp.idx] ? R[rp.idx][0] : R[R.length - 1][0]) : 0;
      shownUntil.current = R.length && (rp.mode === 'on' || (bt && rp.mode === 'pick')) && R[rp.idx] ? toLocal(R[rp.idx][0]) : Infinity;
      const pend = pendingInk.current;
      if (pend && Date.now() - pend.at > grpRef.current.secs * 1000) pendingInk.current = null;
      const vdata = { rows: R, until, tick: tick || 0.01, c: api.current.c || chartColors(), key: `${R.length}|${R[0]?.[0]}|${R[R.length - 1]?.[0]}` };
      const indNow = indRef.current;
      if (R.length && indNow.vpsess?.on) {
        const from = fromLocal(v.fromX(0)), to = Math.min(fromLocal(v.fromX(v.w)), until + 60);
        const starts = sessionsIn(R, sessionStart(from), to, sessionStart);
        for (let k = 0; k < starts.length; k++) {
          const s0 = starts[k], s1 = starts[k + 1] ?? s0 + 86400;
          const p = profileFor(vdata, s0, s1);
          if (!p) continue;
          // from the session's first bar (not its 6 PM open, which may be before the data) to its last
          let i0 = 0, lo2 = 0, hi2 = R.length;
          while (lo2 < hi2) { const m = (lo2 + hi2) >> 1; if (R[m][0] < s0) lo2 = m + 1; else hi2 = m; }
          i0 = lo2;
          if (!R[i0]) continue;
          const lastT = Math.min(s1, until + 60) - 60;
          const xa = v.toX(toLocal(R[i0][0])), xb = v.toX(toLocal(Math.max(R[i0][0], lastT)));
          if (xa == null || xb == null || xb < 0 || xa > v.w) continue;
          drawProfile(ctx, p, v, xa, Math.max(16, (xb - xa) * 0.3), 'left', vdata.c, fmtP, xb, xb - xa > 160, 0.3);
        }
      }
      if (R.length && indNow.vpvr?.on) {
        const from = fromLocal(v.fromX(0)), to = fromLocal(v.fromX(v.w)) + 60;
        const p = profileFor(vdata, from, to);
        if (p) drawProfile(ctx, p, v, v.w, v.w * 0.22, 'right', vdata.c, fmtP, 0, true, 0.38);
      }
      if (!hiddenRef.current) {
        for (const d of drawingsRef.current) {
          if (!isShown(d)) continue;
          paint(ctx, d, v, d.id === selRef.current, fmtP, tick, api.current.iv, vdata);
          if (d.id === pendingInk.current?.id) { // handwriting still open for more strokes
            const b = pxBox(d, v);
            if (b) { ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(167,139,250,0.55)'; ctx.strokeRect(b[0] - 2, b[1] - 2, b[2] - b[0] + 4, b[3] - b[1] + 4); ctx.setLineDash([]); }
          }
        }
      }
      if (draft.current) paint(ctx, draft.current, v, true, fmtP, tick, api.current.iv, vdata);
      if (replayRef.current.mode === 'pick' && hoverX.current != null) {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(hoverX.current, 0, v.w - hoverX.current, v.h);
        ctx.strokeStyle = '#4da3e5'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(hoverX.current, 0); ctx.lineTo(hoverX.current, v.h); ctx.stroke();
      }
      ctx.restore();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [fmtP, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- pointer: drawing, selecting, dragging
  useEffect(() => {
    const el = stage.current;
    if (!el) return undefined;
    let handling = false;
    const local = (e) => { const r = box.current.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const pt = (v, x, y, e) => ((magnetRef.current || e?.ctrlKey || e?.metaKey) ? v.snap(x, y) : { t: v.fromX(x), p: v.fromY(y) });
    const block = (e) => { if (handling) { e.stopPropagation(); if (e.cancelable) e.preventDefault(); } };
    const finishDraft = () => {
      const d = draft.current;
      draft.current = null;
      if (!d) return;
      if (d.type === 'text') { const v = view(); setEditing({ id: d.id, x: v.toX(d.p[0].t), y: v.toY(d.p[0].p), text: '', fresh: stamp(d) }); return; }
      commit([...drawingsRef.current, stamp(d)]);
      setSel(d.id);
      setTool('cursor');
    };
    const R2 = (n) => Math.round(n * 100) / 100;
    const pq = (v, x, y, pr) => ({ t: Math.round(v.fromX(x) * 10) / 10, p: Number(v.fromY(y).toPrecision(9)), ...(pr != null ? { pr: R2(pr) } : {}) });
    /** A finished brush stroke: joins the handwriting still being written when it's close by, or starts its own. */
    const finishStroke = (d) => {
      const v = view();
      if (!v || !d.p.length) return;
      if (d.p.length === 1) d.p.push({ ...d.p[0], t: d.p[0].t + 0.01 }); // a dot
      const g = grpRef.current, pend = pendingInk.current;
      const list = drawingsRef.current;
      const gi = g.on && pend ? list.findIndex((x) => x.id === pend.id) : -1;
      const grpD = gi >= 0 ? list[gi] : null;
      if (grpD && grpD.color === d.color && grpD.width === d.width) {
        const a = pxBox(grpD, v), b = pxBox(d, v);
        if (a && b && joinsGroup(a, b, g.dist, 1, d.width)) {
          const merged = stamp({ ...grpD, p: [...grpD.p, ...d.p], brk: [...(grpD.brk || []), grpD.p.length], ...(d.pr || grpD.pr ? { pr: 1 } : {}) });
          commit(list.map((x, k) => (k === gi ? merged : x)));
          pendingInk.current = { id: grpD.id, at: Date.now() };
          return;
        }
      }
      commit([...list, stamp(d)]);
      pendingInk.current = g.on ? { id: d.id, at: Date.now() } : null;
    };
    /** Under (x, y): the top drawing and its part. Another tool than the cursor only grabs handles, edges, lines and grips. */
    const hitAt = (v, x, y, strict) => {
      const list = drawingsRef.current, skip = pendingInk.current?.id;
      for (let i = list.length - 1; i >= 0; i--) {
        const d = list[i];
        if (d.id === skip || !isShown(d)) continue;
        const part = hitDrawing(d, v, x, y, strict);
        if (part !== null) return { d, part };
      }
      return null;
    };
    const down = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (!box.current?.contains(e.target) && e.target !== overlay.current) return;
      const v = view();
      if (!v) return;
      const { x, y } = local(e);
      if (x < 0 || y < 0 || x > v.w || y > v.h) return; // price / time scales: the chart handles those
      const r = replayRef.current;
      if (r.mode === 'pick') { pickStart = { x, y }; return; } // a click picks the bar; a drag scrolls the chart (to earlier days)
      const t = toolRef.current;
      if (t !== 'cursor' && !draft.current?.placing && !hiddenRef.current) {
        // an edge, corner or handle of any drawing resizes it, its middle moves it — whatever tool is picked
        const h = hitAt(v, x, y, true);
        if (h) {
          handling = true; block(e);
          drag.current = { id: h.d.id, part: h.part, x0: x, y0: y, orig: h.d, before: drawingsRef.current, moved: false };
          return;
        }
      }
      if (t === 'brush') {
        handling = true; block(e);
        const b = brushRef.current, pen = e.pointerType === 'pen';
        draft.current = { id: uid(), type: 'brush', color: b.color, width: b.width, ...(pen ? { pr: 1 } : {}), p: [pq(v, x, y, pen ? e.pressure || 0.5 : null)] };
        drag.current = { create: true, x0: x, y0: y, last: [x, y, pen ? e.pressure || 0.5 : 0.5], pen };
        return;
      }
      if (t !== 'cursor') {
        handling = true; block(e);
        const q = pt(v, x, y, e);
        if (draft.current?.placing) { draft.current.p[1] = q; if (draft.current.type === 'long' || draft.current.type === 'short') draft.current.p[2] = { t: q.t, p: draft.current.p[0].p + (draft.current.p[0].p - q.p) * 2 }; finishDraft(); return; }
        const d = { id: uid(), type: t, color: DEFAULT_COLOR[t], width: 1.5, ...(t === 'text' ? { size: 16, angle: 0 } : {}), p: ONE_POINT.has(t) ? [q] : [q, { ...q }] };
        if (t === 'long' || t === 'short') {
          const step = (tick || Math.abs(q.p) * 0.0005) * 20;
          const stop = t === 'long' ? q.p - step : q.p + step;
          d.p = [q, { t: q.t + api.current.iv * 15, p: stop }, { t: q.t + api.current.iv * 15, p: q.p + (q.p - stop) * 2 }];
        }
        draft.current = d;
        drag.current = { create: true, x0: x, y0: y };
        if (ONE_POINT.has(t)) { drag.current = null; finishDraft(); }
        return;
      }
      if (!hiddenRef.current) {
        const h = hitAt(v, x, y, false);
        if (h) {
          const d = h.d;
          handling = true; block(e);
          setSel(d.id);
          drag.current = { id: d.id, part: h.part, x0: x, y0: y, orig: d, before: drawingsRef.current, moved: false };
          if (e.detail === 2 && d.type === 'text') setEditing({ id: d.id, x: v.toX(d.p[0].t), y: v.toY(d.p[0].p), text: d.text || '' });
          return;
        }
      }
      if (selRef.current) setSel(null);
    };
    let pickStart = null;
    const pickAt = (x) => {
      const v = view();
      const r = replayRef.current;
      if (!v || r.mode !== 'pick') return;
      const t = v.fromX(x);
      let idx = rows.findIndex((row) => barTime(row[0], srcIv) > t) - 1;
      if (idx < 0) idx = rows.length - 1;
      if (bt) { btRestartRef.current(Math.max(0, Math.min(idx, r.idx))); return; } // a backtest restarts from that bar (never ahead of where it was)
      setReplay((s) => ({ ...s, mode: 'on', idx: Math.max(0, idx), playing: false, sub: 0, subAt: -1 }));
      requestAnimationFrame(() => requestAnimationFrame(focusReplay));
    };
    const move = (e) => {
      const v = view();
      if (!v || !box.current) return;
      const { x, y } = local(e);
      if (pickStart && dist(x, y, pickStart.x, pickStart.y) > 5) pickStart = null; // dragging: scrolling, not picking
      if (replayRef.current.mode === 'pick') { hoverX.current = x >= 0 && x <= v.w ? x : null; el.style.cursor = 'col-resize'; return; }
      const d = draft.current;
      if (d && (drag.current?.create || d.placing)) {
        const q = pt(v, x, y, e);
        if (d.type === 'brush') {
          const g = drag.current;
          if (!g?.last) return;
          // every sample the pen or mouse sent since the last event (tablets send many per frame), lightly smoothed
          const evs = e.getCoalescedEvents?.() || [];
          const r = box.current.getBoundingClientRect();
          for (const ev of evs.length ? evs : [e]) {
            const rx = ev.clientX - r.left, ry = ev.clientY - r.top, last = g.last;
            const nx = last[0] + (rx - last[0]) * 0.55, ny = last[1] + (ry - last[1]) * 0.55;
            if (Math.hypot(nx - last[0], ny - last[1]) < 0.8) continue;
            const pr = g.pen ? last[2] * 0.4 + (ev.pressure || last[2] || 0.5) * 0.6 : null;
            g.last = [nx, ny, pr ?? 0.5];
            d.p.push(pq(v, nx, ny, pr));
          }
          return;
        }
        if (d.type === 'long' || d.type === 'short') {
          d.p[1] = { t: Math.max(q.t, d.p[0].t + api.current.iv * 3), p: q.p };
          d.p[2] = { t: d.p[1].t, p: d.p[0].p + (d.p[0].p - q.p) * 2 };
        } else d.p[1] = q;
        return;
      }
      const g = drag.current;
      if (g && g.id) {
        if (!g.moved && dist(x, y, g.x0, g.y0) < 3) return;
        g.moved = true;
        const o = g.orig;
        let p = o.p.map((q) => ({ ...q }));
        if (g.part === 'body') {
          const dt = v.fromX(x) - v.fromX(g.x0), dp = v.fromY(y) - v.fromY(g.y0);
          p = p.map((q) => ({ ...q, t: q.t + dt, p: q.p + dp }));
        } else if (typeof g.part === 'string' && g.part.startsWith('b:')) {
          const r = resizeBox(o, g.part, x, y, v, e.shiftKey);
          drawingsRef.current = drawingsRef.current.map((x2) => (x2.id === o.id ? r : x2));
          return;
        } else if (o.type === 'text') {
          const t = textHandles(o, v);
          if (g.part === 'size') {
            const base = Math.hypot(t.size.x - t.anchor.x, t.size.y - t.anchor.y) || 1;
            const size = Math.round(Math.max(8, Math.min(120, (o.size || 14) * (Math.hypot(x - t.anchor.x, y - t.anchor.y) / base))));
            drawingsRef.current = drawingsRef.current.map((x2) => (x2.id === o.id ? { ...o, size } : x2));
          } else {
            const b0 = textBox(o);
            const a0 = Math.atan2(b0.y0 - 18, b0.w / 2);
            let angle = Math.atan2(y - t.anchor.y, x - t.anchor.x) - a0;
            if (e.shiftKey) angle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12); // Shift: 15° steps
            drawingsRef.current = drawingsRef.current.map((x2) => (x2.id === o.id ? { ...o, angle } : x2));
          }
          return;
        } else {
          const q = pt(v, x, y, e);
          if (o.type === 'long' || o.type === 'short') {
            if (g.part === 0) p[0] = { t: q.t, p: q.p };
            else if (g.part === 1) { p[1] = { t: Math.max(q.t, p[0].t + api.current.iv), p: q.p }; p[2] = { ...p[2], t: p[1].t }; }
            else { p[2] = { t: Math.max(q.t, p[0].t + api.current.iv), p: q.p }; p[1] = { ...p[1], t: p[2].t }; }
          } else p[g.part] = q;
        }
        drawingsRef.current = drawingsRef.current.map((x2) => (x2.id === o.id ? { ...o, p } : x2));
        return;
      }
      // hover: show what's clickable
      const strict = toolRef.current !== 'cursor';
      const over = !hiddenRef.current && !draft.current && x >= 0 && y >= 0 && x <= v.w && y <= v.h ? hitAt(v, x, y, strict) : null;
      el.style.cursor = over ? partCursor(over.part) : strict ? 'crosshair' : '';
    };
    const up = (e) => {
      if (pickStart) { const x0 = pickStart.x; pickStart = null; pickAt(x0); return; }
      const g = drag.current;
      if (g?.create && draft.current?.type === 'brush') {
        drag.current = null;
        const d = draft.current;
        draft.current = null;
        const v = view();
        if (v && e?.clientX != null && g.last) { // smoothing trails the pointer a little: end exactly where it lifted
          const { x, y } = local(e);
          if (Math.hypot(x - g.last[0], y - g.last[1]) > 0.5) d.p.push(pq(v, x, y, g.pen ? g.last[2] : null));
        }
        finishStroke(d);
      } else if (g?.create) {
        drag.current = null;
        const d = draft.current;
        if (!d) return;
        const v = view();
        const moved = (v && d.p[1] && dist(v.toX(d.p[0].t), v.toY(d.p[0].p), v.toX(d.p[1].t), v.toY(d.p[1].p)) > 5);
        if (moved) finishDraft(); else d.placing = true; // click, move, click
      } else if (g?.id) {
        drag.current = null;
        if (g.moved) {
          history.current = [...history.current.slice(-49), g.before];
          drawingsRef.current = drawingsRef.current.map((x2) => (x2.id === g.id ? stamp(x2) : x2));
          setDrawings(drawingsRef.current);
        }
      }
      setTimeout(() => { handling = false; }, 0);
    };
    el.addEventListener('pointerdown', down, true);
    el.addEventListener('mousedown', block, true);
    el.addEventListener('touchstart', block, { capture: true, passive: false });
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      el.removeEventListener('pointerdown', down, true);
      el.removeEventListener('mousedown', block, true);
      el.removeEventListener('touchstart', block, true);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [rows, srcIv, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- replay playback
  useEffect(() => {
    if (replay.mode !== 'on' || !replay.playing || tickActive) return undefined;
    const id = setInterval(() => {
      setReplay((s) => (s.idx >= rows.length - 1 ? { ...s, playing: false } : { ...s, idx: s.idx + 1 }));
    }, 1000 / replay.speed);
    return () => clearInterval(id);
  }, [replay.mode, replay.playing, replay.speed, rows.length, tickActive]);
  const execTimes = useMemo(() => {
    const ts = [];
    for (const t of symTrades) for (const f of (t.fills?.length ? t.fills : [t])) for (const iso of [f.entry, f.exit]) if (iso) ts.push(Math.floor(new Date(iso).getTime() / 1000));
    return ts.sort((x, y) => x - y);
  }, [symTrades]);
  const startReplay = (where) => {
    if (!rows.length) return;
    if (where === 'pick') { setReplay((s) => ({ ...s, mode: 'pick', playing: false })); setTool('cursor'); setSel(null); return; }
    const first = execTimes[0];
    let idx = 0;
    if (where === 'trade' && first) { idx = rows.findIndex((r) => r[0] >= first - 30 * 60); if (idx < 0) idx = 0; }
    setReplay((s) => ({ ...s, mode: 'on', idx, playing: false, sub: 0, subAt: -1 }));
    requestAnimationFrame(() => requestAnimationFrame(focusReplay));
  };
  const stopReplay = () => { setReplay((s) => ({ ...s, mode: 'off', playing: false })); requestAnimationFrame(() => requestAnimationFrame(() => api.current.fit?.())); };
  const stepTo = (idx) => {
    const s0 = replayRef.current;
    const to = Math.max(bt ? s0.idx : 0, Math.min(rows.length - 1, idx));
    // a backtest moving ahead with ticks plays the stretch through, so every order sees every tick
    if (bt && tickActive && to > s0.idx && rows[to]) { advanceRef.current((rows[to][0] + srcIv) * 1000 - 1); setReplay((s) => ({ ...s, playing: false })); return; }
    setReplay((s) => (to === s.idx ? { ...s, playing: false } : { ...s, idx: to, playing: false, sub: 0, subAt: -1 }));
  };
  const nextExec = () => {
    const now = rows[replay.idx]?.[0] ?? 0;
    const t = execTimes.find((x) => x > now + srcIv - 1);
    if (t == null) return;
    const idx = rows.findIndex((r) => r[0] + srcIv > t);
    stepTo(idx < 0 ? rows.length - 1 : idx);
  };
  const replayUntil = replay.mode === 'on' && rows[replay.idx] ? rows[replay.idx][0] + srcIv - 1 : Infinity;
  const replayDone = symTrades.filter((t) => t.exit && Math.floor(new Date(t.exit).getTime() / 1000) <= replayUntil);
  const replayPnl = replayDone.reduce((s, t) => s + (Number(t.pnl) || 0), 0);
  const openPos = replay.mode === 'on' ? symTrades.find((t) => Math.floor(new Date(t.entry).getTime() / 1000) <= replayUntil && !(Math.floor(new Date(t.exit).getTime() / 1000) <= replayUntil)) : null;

  // ---------------------------------------------------------------- backtest: start the day, fill orders, stops and targets
  const tickSize = tick || 0.01;
  const lastIdx = useRef(-1);
  const btTime = useRef(0);
  useEffect(() => { if (bt && replay.mode === 'on' && rows[replay.idx]) btTime.current = rows[replay.idx][0]; }, [replay.idx, replay.mode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!bt || rec.status !== 'ok' || !rows.length || rec.key !== `${sym}|${date}|${span}`) return;
    if (replayRef.current.mode === 'on' && lastIdx.current >= 0 && btTime.current) { // same day, another timeframe (more days loaded)
      let k = rows.length - 1;
      while (k > 0 && rows[k][0] > btTime.current) k--;
      lastIdx.current = k;
      setReplay((r) => ({ ...r, idx: k, sub: 0, subAt: -1 }));
      return;
    }
    const [hh, mm] = String(bt.startTime || '').split(':').map(Number);
    const at = Number.isFinite(hh) ? Math.floor(new Date(`${date}T${String(hh).padStart(2, '0')}:${String(mm || 0).padStart(2, '0')}:00`).getTime() / 1000) : 0;
    let idx = rows.findIndex((r) => r[0] >= at);
    if (idx < 0) idx = rows.length - 1;
    idx = Math.max(0, idx - 1); // the bar before the start time is the last one you see
    lastIdx.current = idx;
    setReplay((r) => ({ ...r, mode: 'on', idx, playing: false, sub: 0, subAt: -1 }));
    requestAnimationFrame(() => requestAnimationFrame(focusReplay));
  }, [rec, bt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { lastIdx.current = -1; btTime.current = 0; setReplay((r) => ({ ...r, mode: 'off', playing: false })); }, [date]); // eslint-disable-line react-hooks/exhaustive-deps
  const record = (closed, why) => {
    if (!closed) return;
    const t = toTrade(closed, { symbol: bt.symbol, pv: bt.pv, feePerContract: bt.fee, strategyId: bt.strategyId || null });
    bt.onTrade(t);
    setFlash({ text: `${why ? `${why} · ` : ''}${t.direction} ${t.qty} closed ${t.pnl >= 0 ? '+' : ''}${fmtMoney(t.pnl)}`, good: t.pnl >= 0, at: Date.now() });
  };
  useEffect(() => { if (!flash) return undefined; const id = setTimeout(() => setFlash(null), 3500); return () => clearTimeout(id); }, [flash]);
  /** What a bar (or a tick) did to the position and the working orders. */
  function applyStep(r) {
    if (r.pos !== posRef.current) setPos(r.pos);
    if (r.orders.length !== ordersRef.current.length) setOrders(r.orders);
    for (const c of r.closed) record(c.closed, c.why === 'stop' ? 'Stopped out' : c.why === 'target' ? 'Target hit' : 'Order filled');
    if (r.filled.length && !r.closed.length) { const f = r.filled[r.filled.length - 1]; setFlash({ text: `${f.order.side > 0 ? 'Bought' : 'Sold'} ${f.order.qty} @ ${fmtP(f.price)} (${f.order.type})`, good: true, at: Date.now() }); }
  }
  // each new bar the replay shows is checked against the stop and target
  useEffect(() => {
    if (!bt || replay.mode !== 'on' || lastIdx.current < 0) return;
    const to = replay.idx;
    for (let i = lastIdx.current + 1; i <= to && i < rows.length; i++) {
      if (!posRef.current && !ordersRef.current.length) continue;
      if (tickedTimes.current.has(rows[i][0])) continue; // played tick by tick: its orders are done
      applyStep(stepOrders(posRef.current, ordersRef.current, rows[i], srcIv, bracketsFor));
    }
    lastIdx.current = Math.max(lastIdx.current, to);
  }, [replay.idx, replay.mode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { drawPosLines(); }, [pos, orders]); // eslint-disable-line react-hooks/exhaustive-deps
  const nowBar = rows[replay.idx];
  const curSub = replay.subAt === replay.idx + 1 ? replay.sub : 0;
  const partTicks = curSub > 0 ? ticksForBar(replay.idx + 1) : null;
  const lastTick = Array.isArray(partTicks) && partTicks.length ? partTicks[Math.min(curSub, partTicks.length) - 1] : null;
  const lastPrice = lastTick ? lastTick[1] : nowBar ? nowBar[4] : null;
  const barEnd = lastTick ? Math.floor(lastTick[0] / 1000) : nowBar ? nowBar[0] + srcIv - 1 : 0;
  const roundTick = (p) => Number((Math.round(p / tickSize) * tickSize).toFixed(Math.max(prec, 2)));
  const orderRef = useRef(order);
  orderRef.current = order;
  /** SL / TP (ticks from the fill) for a position an order opens, when SL/TP is on. */
  function bracketsFor(side, px) {
    const o = orderRef.current;
    if (!o.brk) return {};
    const sl = Number(o.sl) > 0 ? Number(o.sl) : null, tp = Number(o.tp) > 0 ? Number(o.tp) : null;
    return { stop: sl ? roundTick(px - side * sl * tickSize) : null, target: tp ? roundTick(px + side * tp * tickSize) : null };
  }
  const canTrade = !!bt && replay.mode === 'on' && lastPrice != null;
  /** Market order at the last price. */
  const place = (side, qty = order.qty) => {
    if (!canTrade) return;
    const r = marketOrder(posRef.current, side, qty, lastPrice, barEnd, bracketsFor(side, lastPrice));
    setPos(r.pos);
    record(r.closed);
  };
  /** A working limit or stop order; it fills on a later bar that reaches its price. */
  const addOrder = (side, type, price, qty = order.qty) => {
    if (!canTrade || !Number.isFinite(price)) return;
    setOrders([...ordersRef.current, { id: uid(), side, type, price: roundTick(price), qty: Math.max(1, Math.floor(Number(qty) || 1)) }]);
  };
  const cancelOrders = (keep) => setOrders(ordersRef.current.filter(keep));
  const closeAll = (why) => { if (!bt || !posRef.current || lastPrice == null) return; const r = flatten(posRef.current, lastPrice, barEnd); setPos(null); record(r.closed, why); };
  const reverse = () => { const p = posRef.current; if (canTrade && p && posQty(p)) place(-p.dir, posQty(p) * 2); };
  const breakEven = () => { const p = posRef.current; if (p) setPos({ ...p, stop: roundTick(posAvg(p)) }); };
  const setOrderField = (patch) => { const next = { ...order, ...patch }; setOrder(next); setSetting('btOrder', { qty: next.qty, sl: next.sl, tp: next.tp, brk: next.brk }); };
  const onClose = () => { if (bt && posRef.current) closeAll('Closed at the chart’s last bar'); setOrders([]); closeStudio(); };
  const nextDay = () => { if (posRef.current) closeAll('Closed at the end of the day'); setOrders([]); bt.onDay(nextWeekday(date)); };
  /**
   * Tick replay: show everything that traded up to market time `ms` — ticks of the next bar one by one (each checked
   * against the position and orders), finished bars, and whole bars where there are no ticks.
   * Returns { waiting (ticks still on their way), at (ms reached), end (no more bars) }.
   */
  const advance = (ms) => {
    const r0 = replayRef.current;
    let idx = r0.idx, s = r0.subAt === r0.idx + 1 ? r0.sub : 0, changed = false, waiting = false, at = ms;
    for (let guard = 0; guard < 500000; guard++) {
      const next = rows[idx + 1];
      if (!next) break;
      const tk = ticksForBar(idx + 1);
      if (Array.isArray(tk) && tk.length) {
        if (s < tk.length) {
          if (tk[s][0] > ms) break;
          const t = tk[s];
          if (bt && (posRef.current || ordersRef.current.length)) applyStep(stepOrders(posRef.current, ordersRef.current, [Math.floor(t[0] / 1000), t[1], t[1], t[1], t[1], t[2]], 1, bracketsFor));
          s += 1; changed = true; continue;
        }
        if ((next[0] + srcIv) * 1000 > ms) break;
        idx += 1; s = 0; tickedTimes.current.add(next[0]); changed = true; continue;
      }
      if (tickWanted && (tk === 'pending' || tk === undefined) && tickState.status !== 'timeout') { waiting = true; at = Math.min(ms, next[0] * 1000); break; } // ticks on their way
      if ((next[0] + srcIv) * 1000 > ms) break;
      idx += 1; s = 0; changed = true;
    }
    if (changed) {
      replayRef.current = { ...replayRef.current, idx, sub: s, subAt: idx + 1 };
      setReplay((x) => ({ ...x, idx, sub: s, subAt: idx + 1 }));
    }
    return { waiting, at, end: !rows[idx + 1] };
  };
  const advanceRef = useRef(advance);
  advanceRef.current = advance;
  /** Market time (ms) the replay has reached. */
  const replayMs = () => {
    const r = replayRef.current;
    const tk = r.sub > 0 && r.subAt === r.idx + 1 ? ticksForBar(r.idx + 1) : null;
    if (Array.isArray(tk) && tk.length) return tk[Math.min(r.sub, tk.length) - 1][0];
    return rows[r.idx] ? (rows[r.idx][0] + srcIv) * 1000 - 1 : 0;
  };
  /** One bar forward: the rest of the next bar's ticks (or the whole bar). */
  const forwardBar = () => {
    const r = replayRef.current;
    const next = rows[r.idx + 1];
    if (!next) return;
    if (tickActive && Array.isArray(ticksForBar(r.idx + 1))) { advance((next[0] + srcIv) * 1000); setReplay((x) => ({ ...x, playing: false })); return; }
    stepTo(r.idx + 1);
  };
  const forwardBarRef = useRef(forwardBar);
  forwardBarRef.current = forwardBar;
  /** One tick forward. */
  const forwardTick = () => {
    const r = replayRef.current;
    const tk = ticksForBar(r.idx + 1);
    const s = r.subAt === r.idx + 1 ? r.sub : 0;
    if (!Array.isArray(tk) || !tk.length) { forwardBar(); return; }
    advance(s < tk.length ? tk[s][0] : (rows[r.idx + 1][0] + srcIv) * 1000);
    setReplay((x) => ({ ...x, playing: false }));
  };
  // playback on a market clock: `speed` bars a second, or real time
  useEffect(() => {
    if (replay.mode !== 'on' || !replay.playing || !tickActive) return undefined;
    let raf, last = performance.now(), clock = replayMs();
    const loop = (now) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      const target = clock + dt * (replayRef.current.tickSpeed || 1) * 1000; // times real time
      const res = advanceRef.current(target);
      clock = res.waiting ? res.at : target;
      if (res.end) { setReplay((x) => ({ ...x, playing: false })); return; }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [replay.mode, replay.playing, tickActive]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Backtest: restart the replay from an earlier bar (scroll back to reach earlier days). The open position closes first. */
  const btRestart = (idx) => {
    if (!bt || !rows[idx]) return;
    if (posRef.current) closeAll('Closed — replay restarted');
    setOrders([]);
    lastIdx.current = idx;
    btTime.current = rows[idx][0];
    setReplay((s) => ({ ...s, mode: 'on', idx, playing: false, sub: 0, subAt: -1 }));
    requestAnimationFrame(() => requestAnimationFrame(focusReplay));
  };
  const btRestartRef = useRef(btRestart);
  btRestartRef.current = btRestart;
  /** Backtest: go to another day. */
  const goToDay = (d) => {
    if (!bt || !/^\d{4}-\d{2}-\d{2}$/.test(d || '') || d === date) return;
    if (posRef.current) closeAll('Closed — moved to another day');
    setOrders([]);
    bt.onDay(d);
  };
  const lastPriceRef = useRef(lastPrice);
  lastPriceRef.current = lastPrice;
  const tagsRef = useRef(null);
  const ghostRef = useRef(null);
  const tagDrag = useRef(null);
  /** Order / stop / target tags on the chart: drag to move the price, × to cancel. */
  const tags = !bt ? [] : [
    ...(pos && posQty(pos) ? [
      { key: 'pos', price: posAvg(pos), cls: pos.dir > 0 ? 'buy' : 'sell', label: `${pos.dir > 0 ? 'Long' : 'Short'} ${posQty(pos)}`, money: lastPrice != null ? openPnl(pos, lastPrice, bt.pv) : null, x: () => closeAll(), xTitle: 'Close the position at market' },
      ...(pos.stop != null ? [{ key: 'sl', price: pos.stop, cls: 'sl', label: 'SL', money: (pos.stop - posAvg(pos)) * pos.dir * posQty(pos) * bt.pv, drag: true, x: () => setPos({ ...posRef.current, stop: null }), xTitle: 'Remove the stop' }] : []),
      ...(pos.target != null ? [{ key: 'tp', price: pos.target, cls: 'tp', label: 'TP', money: (pos.target - posAvg(pos)) * pos.dir * posQty(pos) * bt.pv, drag: true, x: () => setPos({ ...posRef.current, target: null }), xTitle: 'Remove the target' }] : []),
    ] : []),
    ...orders.map((o) => ({ key: o.id, price: o.price, cls: o.side > 0 ? 'buy' : 'sell', label: `${o.side > 0 ? 'Buy' : 'Sell'} ${o.type === 'limit' ? 'LMT' : 'STP'} ${o.qty}`, drag: true, x: () => cancelOrders((x) => x.id !== o.id), xTitle: 'Cancel the order' })),
  ];
  const startTagDrag = (e, tag) => {
    if (!tag.drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault(); e.stopPropagation();
    const r = box.current.getBoundingClientRect();
    tagDrag.current = { key: tag.key, price: tag.price, moved: false };
    const mv = (ev) => {
      const a = api.current;
      const p = a.series?.coordinateToPrice(ev.clientY - r.top);
      if (p == null || !tagDrag.current) return;
      tagDrag.current.price = roundTick(p); tagDrag.current.moved = true;
      a.tagLines?.get(tag.key)?.applyOptions({ price: tagDrag.current.price });
    };
    const upf = () => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', upf);
      const d = tagDrag.current; tagDrag.current = null;
      if (!d?.moved) return;
      if (tag.key === 'sl') setPos({ ...posRef.current, stop: d.price });
      else if (tag.key === 'tp') setPos({ ...posRef.current, target: d.price });
      else setOrders(ordersRef.current.map((o) => (o.id === tag.key ? { ...o, price: d.price } : o)));
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', upf);
  };
  /** Drag a Buy / Sell LMT or STP button onto the chart: the order goes where you drop it. */
  const startOrderDrag = (e, side, type) => {
    if (!canTrade || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    let moved = false, drop = null;
    const g = ghostRef.current;
    const mv = (ev) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      moved = true;
      const v = view();
      const r = box.current.getBoundingClientRect();
      const x = ev.clientX - r.left, y = ev.clientY - r.top;
      drop = v && x >= 0 && x <= v.w && y >= 0 && y <= v.h ? roundTick(api.current.series.coordinateToPrice(y)) : null;
      if (!g) return;
      if (drop == null) { g.style.display = 'none'; return; }
      const now = lastPriceRef.current;
      const instant = type === 'limit' ? (side > 0 ? drop >= now : drop <= now) : (side > 0 ? drop <= now : drop >= now);
      g.style.display = 'block'; g.style.top = `${y}px`; g.style.width = `${v.w}px`;
      g.className = `studio-ghost ${side > 0 ? 'buy' : 'sell'}`;
      g.firstChild.textContent = `${side > 0 ? 'Buy' : 'Sell'} ${type === 'limit' ? 'LMT' : 'STP'} ${orderRef.current.qty} @ ${fmtP(drop)}${instant ? ` · on the ${side > 0 === (type === 'limit') ? 'high' : 'low'} side of the price — fills on the next bar` : ''}`;
    };
    const upf = () => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', upf);
      if (g) g.style.display = 'none';
      if (!moved) { setFlash({ text: 'Drag the button onto the chart, to the price you want the order at', good: true, at: Date.now() }); return; }
      if (drop != null) addOrder(side, type, drop);
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', upf);
  };
  const dayTrades = tradesIn;
  const dayPnl = bt ? dayTrades.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0) : 0;
  const atEnd = replay.mode === 'on' && replay.idx >= rows.length - 1;

  // ---------------------------------------------------------------- replay progress bar
  const trackRef = useRef(null);
  const trackDrag = useRef(false);
  const [trackHover, setTrackHover] = useState(null);
  const rowAt = (t) => { let lo = 0, hi = rows.length - 1; if (hi < 0) return 0; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (rows[m][0] <= t) lo = m; else hi = m - 1; } return lo; };
  const trackMarks = useMemo(() => {
    const n = Math.max(1, rows.length - 1), days = [], exec = [];
    let last = '';
    rows.forEach((r, i) => { const d = localIsoOf(r[0]).slice(0, 10); if (last && d !== last) days.push({ at: (i / n) * 100, d }); last = d; });
    for (const t of execTimes) if (rows.length && t >= rows[0][0] && t <= rows[rows.length - 1][0] + srcIv) exec.push((rowAt(t) / n) * 100);
    return { days, exec };
  }, [rows, execTimes]); // eslint-disable-line react-hooks/exhaustive-deps
  const idxAtX = (clientX) => { const r = trackRef.current.getBoundingClientRect(); return Math.round(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * Math.max(0, rows.length - 1)); };
  const hhmmss = (ms) => { const d = new Date(ms); return `${fmtTime12(d.toISOString()).replace(/\s?([AP]M)$/i, '')}:${String(d.getSeconds()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`; };
  const timeLabel = (i) => { const r = rows[i]; if (!r) return ''; const d = localIsoOf(r[0]).slice(0, 10); return `${d !== date ? `${fmtDate(d)} · ` : ''}${fmtTime12(new Date(r[0] * 1000).toISOString())}`; };
  const progress = rows.length > 1 ? Math.min(100, ((replay.idx + (curSub && Array.isArray(partTicks) && partTicks.length ? curSub / partTicks.length : 0)) / (rows.length - 1)) * 100) : 0;
  const tickLabel = { ok: tickState.name || 'on', pending: `waiting for ${tickState.name || 'your platform'}…`, timeout: `${tickState.name || 'your platform'} is slow — bars meanwhile`, none: 'not available', idle: '…' }[tickState.status] || '…';
  const addonSays = tickState.source === 'atas' ? (tickState.addon ? ` Journal Sync says (${tickState.addon.ago}s ago, ${tickState.addon.symbol}): ${tickState.addon.state}.` : ' Journal Sync hasn’t reported on ticks yet — it needs version 1.5.1 or newer.') : '';
  const tickTitle = tickState.status === 'ok' ? `Replaying tick by tick from ${tickLabel}. Click to replay bar by bar.`
    : tickState.status === 'pending' ? `Asked ${tickState.name || 'your platform'} for this hour’s ticks — its RoninFlow add-on sends them while the platform is open.${addonSays}`
      : tickState.status === 'timeout' ? `${tickState.name || 'Your platform'} hasn’t sent this hour’s ticks yet — replaying bar by bar meanwhile, and still checking.${addonSays}`
        : IS_VIEWER ? 'This shared journal has no ticks saved for this hour — replaying bar by bar.'
        : 'No tick data for this day. Tick replay needs Databento or Polygon (Settings → Price data), or a platform add-on that sends ticks: ATAS, NinjaTrader, Quantower, MetaTrader 5, cTrader or Sierra Chart (update the add-on). Replaying bar by bar.';

  const placeRef = useRef(place);
  placeRef.current = place;
  const closeRef = useRef(closeAll);
  closeRef.current = () => closeAll();
  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    const key = (e) => {
      if (/input|textarea|select/i.test(e.target?.tagName) || colorsRef.current) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selRef.current) { e.preventDefault(); commit(drawingsRef.current.filter((d) => d.id !== selRef.current)); setSel(null); return; }
      if (e.altKey && KEYS[e.key.toLowerCase()]) { e.preventDefault(); setTool(KEYS[e.key.toLowerCase()]); return; }
      if (replayRef.current.mode === 'on') {
        if (e.key === ' ') { e.preventDefault(); setReplay((s) => ({ ...s, playing: !s.playing })); return; }
        if (e.key === 'ArrowRight' && e.shiftKey) { e.preventDefault(); forwardBarRef.current(); return; }
        if (e.key === 'ArrowLeft' && e.shiftKey && !bt) { e.preventDefault(); setReplay((s) => ({ ...s, idx: Math.max(0, s.idx - 1), playing: false })); return; }
        if (bt && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
          const k = e.key.toLowerCase();
          if (k === 'b') { e.preventDefault(); placeRef.current(1); return; }
          if (k === 's') { e.preventDefault(); placeRef.current(-1); return; }
          if (k === 'x') { e.preventDefault(); closeRef.current(); return; }
          if (e.key === 'ArrowRight') { e.preventDefault(); forwardBarRef.current(); return; }
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (document.querySelector('.lightbox')) return; // a screenshot viewer on top closes first
        e.stopPropagation(); // only the chart closes, not the trade drawer or diary behind it
        if (draft.current || toolRef.current !== 'cursor') setTool('cursor');
        else if (selRef.current) setSel(null);
        else if (replayRef.current.mode === 'pick') setReplay((s) => ({ ...s, mode: bt ? 'on' : 'off' }));
        else if (document.fullscreenElement) document.exitFullscreen?.();
        else onClose();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [rows.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- full screen, screenshot
  const [isFull, setIsFull] = useState(false);
  const [colorsOpen, setColorsOpen] = useState(false);
  const colorsRef = useRef(false);
  colorsRef.current = colorsOpen;
  useEffect(() => { const h = () => setIsFull(!!document.fullscreenElement); document.addEventListener('fullscreenchange', h); return () => document.removeEventListener('fullscreenchange', h); }, []);
  const toggleFull = () => { if (document.fullscreenElement) document.exitFullscreen?.(); else stage.current?.closest('.studio')?.requestFullscreen?.().catch(() => {}); };
  // the camera: opened from a trade → that trade's screenshots; from a diary day → that day's screenshots;
  // anywhere else (or Shift-click) → a PNG download
  const shotFlash = (m) => { setShotMsg(m); setTimeout(() => setShotMsg((x) => (x === m ? '' : x)), 2800); };
  const screenshot = async (e) => {
    const a = api.current;
    if (!a.chart) return;
    const shot = a.chart.takeScreenshot();
    const ctx = shot.getContext('2d');
    if (overlay.current) ctx.drawImage(overlay.current, 0, 0, shot.width, shot.height);
    const name = `${sym}-${date}-${tf}.png`;
    const download = () => { const link = document.createElement('a'); link.download = name; link.href = shot.toDataURL('image/png'); link.click(); };
    if (!shotTo || e?.shiftKey || IS_VIEWER) { download(); return; }
    try {
      const blob = await new Promise((r) => shot.toBlob(r, 'image/png'));
      const file = new File([blob], name, { type: 'image/png' });
      if (shotTo.trade) {
        const url = await fileToDataUrl(file);
        const t = stateRef.current.trades.find((x) => x.id === shotTo.trade);
        if (!t) { download(); return; }
        updateTrade(t.id, { screenshots: [...(t.screenshots || []), url] });
        shotFlash(`Saved to this trade’s screenshots`);
      } else if (shotTo.date) {
        const img = await saveImage(file);
        const caption = `${sym} ${tfLabel(tf)}`;
        const cur = stateRef.current.diary?.[shotTo.date]?.images || [];
        saveDiary(shotTo.date, { images: [...cur, { ...img, caption }] });
        shotFlash(`Saved to ${fmtDate(shotTo.date)} in your diary`);
      } else download();
    } catch (err) {
      shotFlash(`Couldn’t save it (${err.message}) — downloading instead`);
      download();
    }
  };

  const selected = drawings.find((d) => d.id === sel);
  const setSelected = (patch) => commit(drawings.map((d) => (d.id === sel ? { ...d, ...patch } : d)));
  const commitText = (text) => {
    const e = editing;
    setEditing(null);
    if (!e) return;
    if (e.fresh) { if (text.trim()) { commit([...drawingsRef.current, { ...e.fresh, text: text.trim() }]); setSel(e.fresh.id); } setTool('cursor'); return; }
    if (!text.trim()) commit(drawingsRef.current.filter((d) => d.id !== e.id));
    else commit(drawingsRef.current.map((d) => (d.id === e.id ? { ...d, text: text.trim() } : d)));
  };
  const setInd = (k, patch) => setStudio({ ind: { ...(studio.ind || {}), [k]: { ...ind[k], ...patch } } });

  return createPortal(
    <div className="studio" role="dialog" aria-label={`${sym} chart`}>
      <div className="studio-top">
        <div className="row gap6 studio-syms">
          {symbols.map(({ s, c }) => <button key={s} className={`chip ${s === sym ? 'on' : ''}`} onClick={() => { setSym(s); setReplay((r) => ({ ...r, mode: 'off', playing: false })); setSel(null); }}>{s} <span className="muted" style={{ marginLeft: 4 }}>{c}</span></button>)}
        </div>
        {bt ? (
          <Popover align="left" width={250} trigger={({ toggle, open }) => <button className={`btn sm studio-datebtn ${open ? 'on' : ''}`} onClick={toggle} title="Go to another day"><Calendar size={13} /> {fmtDate(date)} <ChevronDown size={12} /></button>}>
            {(close) => (
              <div className="studio-datepop">
                <form className="row gap6" onSubmit={(e) => { e.preventDefault(); const v = e.currentTarget.elements.day.value; if (v && v <= todayKey()) { goToDay(v); close(); } }}>
                  <input name="day" type="date" className="input grow" defaultValue={date} max={todayKey()} autoFocus onKeyDown={(e) => { if (e.key === 'Escape') e.stopPropagation(); }} aria-label="Day to replay" />
                  <button type="submit" className="btn sm white">Go</button>
                </form>
                <div className="row gap6">
                  <button className="btn xs" onClick={() => { goToDay(nextWeekday(date, -1)); close(); }}><ChevronLeft size={12} /> Previous day</button>
                  <button className="btn xs" disabled={nextWeekday(date) > todayKey()} onClick={() => { goToDay(nextWeekday(date)); close(); }}>Next day <ChevronRight size={12} /></button>
                </div>
                <div className="muted" style={{ fontSize: 11.5 }}>{pos ? 'Your open position closes at the current price first.' : 'Prices for that day load from your platform or data feed.'}</div>
              </div>
            )}
          </Popover>
        ) : <span className="muted studio-date">{fmtDate(date)}</span>}
        {bt && <span className="badge neutral studio-btlabel" title="Backtest session">{bt.label || 'Backtest'}</span>}
        <div className="grow" />
        <Popover align="right" width={140} trigger={({ toggle, open }) => <button className={`btn sm ${open ? 'on' : ''}`} onClick={toggle} title="Timeframe">{ivSec(tf) < srcIv ? tfLabel(rec.interval) : tf} <ChevronDown size={12} /></button>}>
          {(close) => TIMEFRAMES.map((x) => <button key={x} className={`pop-item ${x === tf ? 'on' : ''}`} disabled={ivSec(x) < srcIv} onClick={() => { setStudio({ tf: x }); close(); }}><span className="grow">{x}</span>{x === tf && <Check size={13} className="accent" />}</button>)}
        </Popover>
        <Popover align="right" width={290} trigger={({ toggle, open }) => <button className={`btn sm ${open ? 'on' : ''}`} onClick={toggle}><Layers size={14} /> <span className="hide-m">Indicators</span></button>}>
          {() => (
            <div className="studio-inds">
              {IND_INFO.map(([k, name, color, param]) => (
                <label key={k} className="studio-ind">
                  <input type="checkbox" className="cbx" checked={ind[k].on} onChange={(e) => setInd(k, { on: e.target.checked })} />
                  {color && <i style={{ background: color }} />}
                  <span className="grow">{name}</span>
                  {param && <input type="number" className="input" min={2} max={400} value={ind[k].n} onChange={(e) => setInd(k, { n: Math.max(2, Math.min(400, Number(e.target.value) || DEFAULT_IND[k].n)) })} title={k.startsWith('vp') ? 'Price rows (more = finer)' : 'Length'} />}
                </label>
              ))}
            </div>
          )}
        </Popover>
        <button className={`btn sm ${showExec ? 'on' : ''}`} onClick={() => setStudio({ exec: !showExec })} title="Show your executions"><Crosshair size={14} /> <span className="hide-m">Executions</span></button>
        {bt ? <button className="btn sm" onClick={nextDay} title="Go to the next trading day">Next day <ChevronRight size={14} /></button> : replay.mode === 'off'
          ? (
            <Popover align="right" width={240} trigger={({ toggle }) => <button className="btn sm" onClick={toggle} title="Replay the day bar by bar"><History size={14} /> <span className="hide-m">Replay</span></button>}>
              {(close) => (
                <>
                  <button className="pop-item" onClick={() => { startReplay('pick'); close(); }}>Select a start point on the chart</button>
                  {execTimes.length > 0 && <button className="pop-item" onClick={() => { startReplay('trade'); close(); }}>30 minutes before your first trade</button>}
                  <button className="pop-item" onClick={() => { startReplay('start'); close(); }}>From the first bar</button>
                </>
              )}
            </Popover>
          )
          : <button className="btn sm on" onClick={stopReplay}><History size={14} /> Exit replay</button>}
        <button className="icon-btn" onClick={() => setColorsOpen(true)} title="Chart colours"><Palette size={15} /></button>
        <button className="icon-btn" onClick={() => api.current.fit?.()} title="Fit your executions"><Maximize2 size={15} /></button>
        <button className="icon-btn" onClick={screenshot} title={shotTo?.trade ? 'Save a picture to this trade’s screenshots (Shift-click to download)' : shotTo?.date ? 'Save a picture to this day in your diary (Shift-click to download)' : 'Save a picture of the chart'}><Camera size={15} /></button>
        {shotMsg && <span className="studio-shotmsg">{shotMsg}</span>}
        <button className="icon-btn" onClick={toggleFull} title={isFull ? 'Exit full screen' : 'Full screen'}>{isFull ? <Minimize size={15} /> : <Maximize size={15} />}</button>
        <button className="icon-btn" onClick={onClose} title="Close (Esc)"><X size={16} /></button>
      </div>

      <div className="studio-main">
        <div className="studio-tools" role="toolbar" aria-label="Drawing tools">
          {TOOLS.map((group, gi) => (
            <div key={gi} className="studio-group">
              {group.map((t) => <button key={t.id} className={`studio-tool ${tool === t.id ? 'on' : ''}`} title={`${t.label}${t.key ? ` (${t.key})` : ''}`} aria-label={t.label} onClick={() => setTool(t.id)}><t.icon size={17} /></button>)}
            </div>
          ))}
          <div className="studio-group">
            <button className={`studio-tool ${magnet ? 'on' : ''}`} title="Magnet: snap to open / high / low / close (or hold Ctrl)" onClick={() => setStudio({ magnet: !magnet })}><Magnet size={17} /></button>
            <button className="studio-tool" title={hidden ? 'Show drawings' : 'Hide drawings'} onClick={() => setHidden((h) => !h)}>{hidden ? <EyeOff size={17} /> : <Eye size={17} />}</button>
            <button className="studio-tool" title="Undo (Ctrl+Z)" disabled={!history.current.length} onClick={undo}><Undo2 size={17} /></button>
            <button className="studio-tool" title={`Remove all ${root} drawings`} disabled={!drawings.length} onClick={() => { commit([]); setSel(null); }}><Trash2 size={17} /></button>
          </div>
        </div>

        <div ref={stage} className={`studio-stage ${tool !== 'cursor' || replay.mode === 'pick' ? 'drawing' : ''}`}>
          <div className="ec-legend studio-legend">
            <span className="ec-sym">{sym} · {ivSec(tf) < srcIv ? tfLabel(rec.interval) : tf}</span>
            <span ref={legend} />
          </div>
          <div className="studio-indlegend">
            {IND_INFO.filter(([k, , color]) => ind[k].on && color && !(k === 'vwap' && iv >= 86400)).map(([k, name, color]) => <span key={k}><i style={{ background: color }} />{name}{IND_INFO.find((x) => x[0] === k)[3] ? ` ${ind[k].n}` : ''}</span>)}
          </div>
          <div ref={box} className="studio-canvas" />
          {(hist.busy || hist.done || srcIv > 60) && rec.status === 'ok' && rows.length > 0 && (
              <div className="studio-histnote">
                {hist.busy ? 'Loading earlier days…' : hist.done || ''}
                {!hist.busy && !hist.done && srcIv > 60 ? `Only ${tfLabel(rec.interval)} prices for this day${/Yahoo/.test(rec.source || '') ? ' — Yahoo keeps 1-minute bars for 30 days and 2–15 minute bars for 60. For 1-minute bars further back, download your platform’s history (Backtesting → Automated → Download history).' : '.'}` : ''}
              </div>
            )}
          <canvas ref={overlay} className="studio-overlay" />
          {bt && (
            <div ref={tagsRef} className="studio-otags">
              {tags.map((t) => (
                <div key={t.key} data-key={t.key} data-price={t.price} className={`otag ${t.cls} ${t.drag ? 'drag' : ''}`} onPointerDown={(e) => startTagDrag(e, t)} title={t.drag ? 'Drag to move' : undefined}>
                  <b>{t.label}</b>
                  <span className="ot-px">{fmtP(t.price)}</span>
                  {t.money != null && <span className={t.money >= 0 ? 'pos' : 'neg'}>{state.settings.privacy ? '•••' : fmtMoney(t.money, { sign: true })}</span>}
                  <button className="ot-x" title={t.xTitle} onPointerDown={(e) => e.stopPropagation()} onClick={t.x}><X size={11} /></button>
                </div>
              ))}
            </div>
          )}
          {bt && <div ref={ghostRef} className="studio-ghost" style={{ display: 'none' }}><span /></div>}
          <div ref={tipRef} className="ec-tip" />
          {selected && (
            <div className="studio-edit" onPointerDown={(e) => e.stopPropagation()}>
              {SWATCHES.map((c) => <button key={c} className={`studio-sw ${selected.color === c ? 'on' : ''}`} style={{ background: c }} title="Colour" onClick={() => setSelected({ color: c })} />)}
              <span className="studio-sep" />
              {selected.type === 'text' ? (
                <>
                  <label className="studio-size" title="Text size (or drag its corner handle)">
                    A<Range min={8} max={120} step={1} value={selected.size || 14} onChange={(z) => liveSet({ size: z })} onPointerUp={() => { sliding.current = false; }} onKeyUp={() => { sliding.current = false; }} /><span>{selected.size || 14}</span>
                  </label>
                  <span className="studio-sep" />
                  <button className="studio-w studio-fs" title="Rotate 15° left" onClick={() => setSelected({ angle: (selected.angle || 0) - Math.PI / 12 })}>↺</button>
                  <button className="studio-w studio-fs" title="Rotate 15° right" onClick={() => setSelected({ angle: (selected.angle || 0) + Math.PI / 12 })}>↻</button>
                  {Math.abs(selected.angle || 0) > 0.001 && <button className="studio-w studio-fs" title="Straighten" onClick={() => setSelected({ angle: 0 })}>0°</button>}
                  <button className="icon-btn" title="Edit text (or double-click it)" onClick={() => { const v = view(); setEditing({ id: selected.id, x: v.toX(selected.p[0].t), y: v.toY(selected.p[0].p), text: selected.text || '' }); }}><Type size={14} /></button>
                </>
              ) : (
                <label className="studio-size" title="Thickness">
                  <i className="se-dot" style={{ width: Math.min(16, 3 + (selected.width || 1.5) * 0.6), height: Math.min(16, 3 + (selected.width || 1.5) * 0.6), color: selected.color || DEFAULT_COLOR[selected.type] }} />
                  <Range min={0.5} max={selected.type === 'brush' ? 40 : 12} step={0.5} value={selected.width || 1.5} onChange={(w) => liveSet({ width: w })} onPointerUp={() => { sliding.current = false; }} onKeyUp={() => { sliding.current = false; }} /><span>{selected.width || 1.5}</span>
                </label>
              )}
              <span className="studio-sep" />
              <button className="icon-btn" title="Delete (Del)" onClick={() => { commit(drawings.filter((d) => d.id !== sel)); setSel(null); }}><Trash2 size={14} /></button>
            </div>
          )}
          {editing && (
            <input
              className="studio-text" autoFocus defaultValue={editing.text} placeholder="Type a note, Enter to save"
              style={{ left: Math.max(4, editing.x), top: Math.max(4, editing.y - 22) }}
              onKeyDown={(e) => { if (e.key === 'Enter') commitText(e.currentTarget.value); if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); if (editing.fresh) setTool('cursor'); } }}
              onBlur={(e) => commitText(e.currentTarget.value)}
            />
          )}
          {bt && flash && <div className={`studio-hint studio-flash ${flash.good ? 'good' : 'bad'}`}>{flash.text}</div>}
          {bt && atEnd && !flash && <div className="studio-hint">End of this day’s prices <button className="btn xs" onClick={nextDay}>Next day <ChevronRight size={12} /></button></div>}
          {replay.mode === 'pick' && <div className="studio-hint">{bt ? `Click the bar to restart from — scroll left for earlier days${pos ? '. Your open position closes first' : ''}` : 'Click on the chart where the replay should start'} <button className="btn xs" onClick={() => setReplay((s) => ({ ...s, mode: bt ? 'on' : 'off' }))}>Cancel</button></div>}
          {tool === 'brush' && !replay.mode.startsWith('p') && (
            <div className="studio-edit studio-brush" onPointerDown={(e) => e.stopPropagation()}>
              {SWATCHES.map((c) => <button key={c} className={`studio-sw ${brushCfg.color === c ? 'on' : ''}`} style={{ background: c }} title="Brush colour" onClick={() => setBrushCfg({ color: c })} />)}
              <span className="studio-sep" />
              <label className="studio-size" title="Brush size">
                <i className="se-dot" style={{ width: Math.min(16, 3 + brushCfg.width * 0.5), height: Math.min(16, 3 + brushCfg.width * 0.5), color: brushCfg.color }} />
                <Range min={0.5} max={40} step={0.5} value={brushCfg.width} onChange={(w) => setBrushCfg({ width: w })} /><span>{brushCfg.width}</span>
              </label>
              <span className="studio-sep" />
              <div className="studio-grp">
                <button className={`studio-w studio-fs ${grp.on ? 'on-soft' : ''}`} title="Handwriting: strokes written close together become one drawing" onClick={() => setGrpOpen((o) => !o)}>Group {grp.on ? 'on' : 'off'}</button>
                {grpOpen && (
                  <div className="studio-pop">
                    <label className="row gap8"><input type="checkbox" className="cbx" checked={grp.on} onChange={(e) => setGrp({ ...grp, on: e.target.checked })} /> Group handwriting</label>
                    <div className="se-pop-t">While you write, each stroke stays part of the same note — and can’t be grabbed or resized — until you stop for a moment. Then the whole note becomes one drawing you can move or resize.</div>
                    <div className="se-pop-row"><span>Stop for</span><Range min={1} max={15} step={1} value={grp.secs} disabled={!grp.on} onChange={(v) => setGrp({ ...grp, secs: v })} /><b>{grp.secs}s</b></div>
                    <div className="se-pop-row"><span>Strokes within</span><div className="seg sm">{GROUP_DIST.map((d) => <button key={d.v} type="button" disabled={!grp.on} className={grp.dist === d.v ? 'on' : ''} onClick={() => setGrp({ ...grp, dist: d.v })}>{d.label}</button>)}</div></div>
                  </div>
                )}
              </div>
              <span className="studio-sep" />
              <button className="studio-w studio-fs" title="Stop drawing (Esc)" onClick={() => setTool('cursor')}>Done</button>
            </div>
          )}
          {tool !== 'cursor' && tool !== 'brush' && !replay.mode.startsWith('p') && <div className="studio-hint subtle">{TOOL_BY_ID[tool].label}: {ONE_POINT.has(tool) ? 'click to place' : tool === 'brush' ? 'drag to draw' : 'drag, or click two points'} · Esc to cancel</div>}
          {rec.status === 'loading' && <div className="ec-msg muted">Loading {sym} candles…</div>}
          {rec.status === 'error' && (
            <div className="ec-msg">
              <div style={{ color: 'var(--fg)', fontWeight: 500 }}>Couldn’t load {sym} prices</div>
              <div className="muted" style={{ fontSize: 12.5, maxWidth: 360 }}>{rec.error}</div>
              <div className="row gap8" style={{ marginTop: 6 }}>
                <button className="btn" onClick={() => setNonce((n) => n + 1)}><RefreshCw size={14} /> Try again</button>
                {bt && <button className="btn" onClick={nextDay}>Next day <ChevronRight size={14} /></button>}
              </div>
            </div>
          )}
          {rec.status === 'ok' && !rows.length && <div className="ec-msg muted">No {sym} prices for this day.{bt ? ' If your platform add-on is running it has been asked for them — this checks again every 20 seconds. Or skip to the next day.' : ''}{bt && <button className="btn" style={{ marginTop: 8 }} onClick={nextDay}>Next day <ChevronRight size={14} /></button>}</div>}
        </div>
        {bt && (
          <aside className="studio-trade" aria-label="Order entry">
            <div className={`st-pos ${pos ? (pos.dir > 0 ? 'long' : 'short') : ''}`}>
              {pos && posQty(pos) ? (
                <>
                  <b>{pos.dir > 0 ? 'Long' : 'Short'} {posQty(pos)} @ {fmtP(posAvg(pos))}</b>
                  <span className={openPnl(pos, lastPrice ?? posAvg(pos), bt.pv) >= 0 ? "pos" : "neg"}>{state.settings.privacy ? "•••" : fmtMoney(openPnl(pos, lastPrice ?? posAvg(pos), bt.pv), { sign: true })}</span>
                </>
              ) : <span className="muted">Flat{orders.length ? ` · ${orders.length} working` : ''}</span>}
            </div>
            <div className="st-label">Qty</div>
            <div className="st-qty">
              <input type="number" className="input" min={1} max={999} value={order.qty} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.stopPropagation(); e.currentTarget.blur(); } }} onChange={(e) => setOrderField({ qty: Math.max(1, Math.min(999, Math.floor(Number(e.target.value) || 1))) })} aria-label="Contracts" />
              {[1, 2, 5, 10].map((q) => <button key={q} className={`chip ${order.qty === q ? 'on' : ''}`} onClick={() => setOrderField({ qty: q })}>{q}</button>)}
            </div>
            <div className="st-grid">
              <button className="st-btn buy" disabled={!canTrade} onClick={() => place(1)} title="Buy at market (B)">Buy MKT</button>
              <button className="st-btn sell" disabled={!canTrade} onClick={() => place(-1)} title="Sell at market (S)">Sell MKT</button>
              <button className="st-btn buy soft" disabled={!canTrade} onClick={() => addOrder(1, 'limit', lastPrice - tickSize)} title="Buy limit one tick under the last price (joins the bid)">Buy Bid</button>
              <button className="st-btn sell soft" disabled={!canTrade} onClick={() => addOrder(-1, 'limit', lastPrice + tickSize)} title="Sell limit one tick over the last price (joins the ask)">Sell Ask</button>
            </div>
            <div className="st-label">Drag onto the chart</div>
            <div className="st-grid">
              {[[1, 'limit', 'Buy LMT'], [-1, 'limit', 'Sell LMT'], [1, 'stop', 'Buy STP'], [-1, 'stop', 'Sell STP']].map(([side, type, label]) => (
                <button key={label} className={`st-btn st-drag ${side > 0 ? 'buy' : 'sell'} soft`} disabled={!canTrade} onPointerDown={(e) => startOrderDrag(e, side, type)} title={`Drag onto the chart to place a ${side > 0 ? 'buy' : 'sell'} ${type} order at that price`}>{label}</button>
              ))}
            </div>
            <div className="st-grid">
              <button className="st-btn" disabled={!orders.some((o) => o.side > 0)} onClick={() => cancelOrders((o) => o.side < 0)}>Canc. Bids</button>
              <button className="st-btn" disabled={!orders.some((o) => o.side < 0)} onClick={() => cancelOrders((o) => o.side > 0)}>Canc. Asks</button>
              <button className="st-btn" disabled={!orders.length} onClick={() => setOrders([])}>Cancel All</button>
              <button className="st-btn" disabled={!canTrade || !pos} onClick={reverse} title="Close and open the other way, same size">Reverse</button>
            </div>
            <button className="st-btn wide" disabled={!pos} onClick={breakEven} title="Move the stop to your average price"><ShieldCheck size={13} /> Breakeven</button>
            <button className="st-btn wide close" disabled={!canTrade || !pos} onClick={() => closeAll()} title="Close the position at market (X)">Close</button>
            <div className="st-brk">
              <label className="st-switch"><span>SL/TP</span><input type="checkbox" checked={!!order.brk} onChange={(e) => setOrderField({ brk: e.target.checked })} /><i /></label>
              <label title={`Profit target, in ticks from the fill (one tick = ${tickSize})`}><span>TP</span><input type="number" className="input" min={0} placeholder="—" disabled={!order.brk} value={order.tp} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.stopPropagation(); e.currentTarget.blur(); } }} onChange={(e) => setOrderField({ tp: e.target.value })} /><em>ticks</em></label>
              <label title={`Stop loss, in ticks from the fill (one tick = ${tickSize})`}><span>SL</span><input type="number" className="input" min={0} placeholder="—" disabled={!order.brk} value={order.sl} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.stopPropagation(); e.currentTarget.blur(); } }} onChange={(e) => setOrderField({ sl: e.target.value })} /><em>ticks</em></label>
            </div>
            {!canTrade && <div className="st-note muted">Orders open once the replay is running.</div>}
            {canTrade && <div className="st-note muted">Drag order, stop and target tags on the chart to move them.</div>}
          </aside>
        )}
      </div>

      {colorsOpen && <ChartColors onClose={() => setColorsOpen(false)} />}
      {replay.mode === 'on' && (
        <div className="studio-replay">
          <div className="row gap4">
            {!bt && <button className="icon-btn" title="Back to the start" onClick={() => stepTo(0)}><SkipBack size={15} /></button>}
            {!bt && <button className="icon-btn" title="One bar back (Shift+←)" onClick={() => stepTo(replay.idx - 1)}><StepBack size={15} /></button>}
            {bt && <button className="btn sm" title="Restart the replay from an earlier bar — scroll back for earlier days" onClick={() => { setReplay((s) => ({ ...s, mode: 'pick', playing: false })); setTool('cursor'); setSel(null); }}><History size={14} /> <span className="hide-m">Start from a bar</span></button>}
            <button className="btn sm white studio-play" title="Play / pause (Space)" onClick={() => setReplay((s) => ({ ...s, playing: !s.playing && s.idx < rows.length - 1 }))}>{replay.playing ? <Pause size={15} /> : <Play size={15} />}</button>
            <button className="icon-btn" title={bt ? 'One bar forward (→)' : 'One bar forward (Shift+→)'} onClick={forwardBar}><StepForward size={15} /></button>
            {tickActive && <button className="icon-btn" title="One tick forward" onClick={forwardTick}><TickStep size={15} /></button>}
            {!bt && <button className="icon-btn" title="Jump to your next execution" disabled={!execTimes.some((t) => t > replayUntil)} onClick={nextExec}><SkipForward size={15} /></button>}
          </div>
          <div className="row gap4 studio-speed">
            {tickActive
              ? TICK_SPEEDS.map((x) => <button key={x} className={`chip ${replay.tickSpeed === x ? 'on' : ''}`} onClick={() => setReplay((s) => ({ ...s, tickSpeed: x }))} title={x === 1 ? 'Real time — as fast as it happened' : `${x} times real time (a minute in ${+(60 / x).toFixed(1)} s)`}>{x}×</button>)
              : SPEEDS.map((x) => <button key={x} className={`chip ${replay.speed === x ? 'on' : ''}`} onClick={() => setReplay((s) => ({ ...s, speed: x }))} title={`${x} bar${x === 1 ? '' : 's'} a second`}>{x}×</button>)}
            {!candleSource && srcIv <= 60 && <button className={`chip rp-ticks ${tickActive ? 'on' : ''} ${studio.ticks !== false && !tickActive && tickState.status !== 'idle' ? 'off' : ''}`} onClick={() => setStudio({ ticks: studio.ticks === false })} title={studio.ticks === false ? 'Replay tick by tick when a source has the ticks' : tickTitle}><Activity size={12} /> Ticks{studio.ticks !== false ? ` · ${tickLabel}` : ' off'}</button>}
          </div>
          <div
            ref={trackRef} className={`rp-track ${bt ? 'bt' : ''}`} role="slider" tabIndex={0} aria-label="Replay position"
            aria-valuemin={0} aria-valuemax={Math.max(0, rows.length - 1)} aria-valuenow={replay.idx} aria-valuetext={timeLabel(replay.idx)}
            onPointerDown={(e) => { if (e.pointerType === 'mouse' && e.button !== 0) return; e.currentTarget.setPointerCapture?.(e.pointerId); trackDrag.current = true; stepTo(idxAtX(e.clientX)); }}
            onPointerMove={(e) => { const i = idxAtX(e.clientX); setTrackHover({ x: e.clientX - trackRef.current.getBoundingClientRect().left, i }); if (trackDrag.current && !bt) stepTo(i); }}
            onPointerUp={() => { trackDrag.current = false; }}
            onPointerLeave={() => { if (!trackDrag.current) setTrackHover(null); }}
          >
            <div className="rp-rail"><div className="rp-fill" style={{ width: `${progress}%` }} /></div>
            {trackMarks.days.map((m) => <i key={m.d} className="rp-day" style={{ left: `${m.at}%` }} title={fmtDate(m.d)} />)}
            {trackMarks.exec.map((x, k) => <i key={k} className="rp-exec" style={{ left: `${x}%` }} />)}
            <div className="rp-thumb" style={{ left: `${progress}%` }} />
            {trackHover && <div className="rp-tip" style={{ left: Math.max(30, Math.min((trackRef.current?.clientWidth || 0) - 30, trackHover.x)) }}>{bt && trackHover.i > replay.idx ? 'Jump ahead to ' : ''}{timeLabel(trackHover.i)}</div>}
          </div>
          {bt ? (
            <div className="studio-clock">
              <b>{lastTick ? `${localIsoOf(Math.floor(lastTick[0] / 1000)).slice(0, 10) !== date ? `${fmtDate(localIsoOf(Math.floor(lastTick[0] / 1000)).slice(0, 10))} · ` : ''}${hhmmss(lastTick[0])}` : timeLabel(replay.idx)}</b>
              <span className="muted"> · today {dayTrades.length} trade{dayTrades.length === 1 ? '' : 's'} </span>
              <span className={dayPnl >= 0 ? 'pos' : 'neg'}>{state.settings.privacy ? '•••' : fmtMoney(dayPnl, { sign: true })}</span>
            </div>
          ) : (
            <div className="studio-clock">
              <b>{lastTick ? `${localIsoOf(Math.floor(lastTick[0] / 1000)).slice(0, 10) !== date ? `${fmtDate(localIsoOf(Math.floor(lastTick[0] / 1000)).slice(0, 10))} · ` : ''}${hhmmss(lastTick[0])}` : timeLabel(replay.idx)}</b>
              {openPos && <span className="muted"> · in a {openPos.direction.toLowerCase()} {openPos.qty > 1 ? `×${openPos.qty} ` : ''}from {fmtP(openPos.entryPrice)}</span>}
              <span className="muted"> · {replayDone.length} closed </span>
              <span className={replayPnl >= 0 ? 'pos' : 'neg'}>{state.settings.privacy ? '•••' : fmtMoney(replayPnl, { sign: true })}</span>
            </div>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}

