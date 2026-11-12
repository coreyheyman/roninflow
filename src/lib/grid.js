// Dashboard grid layout: pure functions (no React) so they can be tested.
// A layout is a list of { id, x, y, w, h } in grid units on a COLS-wide grid that grows downwards.
// Widgets float up into free space ("vertical compaction"), and an item that's moved or resized
// pushes whatever it lands on out of the way.

export const COLS = 12;

export const overlaps = (a, b) => a.id !== b.id && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
export const readingOrder = (layout) => [...layout].sort((a, b) => a.y - b.y || a.x - b.x);
export const bottom = (layout) => layout.reduce((m, it) => Math.max(m, it.y + it.h), 0);

/** Place `it` among `placed`: float up as far as it can, then down past anything it overlaps. */
function settle(it, placed) {
  const n = { ...it, y: Math.min(it.y, bottom(placed)) };
  while (n.y > 0 && !placed.some((p) => overlaps({ ...n, y: n.y - 1 }, p))) n.y--;
  for (let hit = placed.find((p) => overlaps(n, p)); hit; hit = placed.find((p) => overlaps(n, p))) n.y = hit.y + hit.h;
  return n;
}

/** Float every widget up into free space. `fixed` (an id) is placed first and doesn't move. */
export function compact(layout, fixed) {
  const placed = [];
  const pin = fixed && layout.find((it) => it.id === fixed);
  if (pin) placed.push({ ...pin });
  for (const it of readingOrder(layout)) if (it.id !== fixed) placed.push(settle(it, placed));
  // let everything (the pinned one too) take up any space left above it, in reading order
  const out = [];
  for (const it of readingOrder(placed)) out.push(settle(it, out));
  return out;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Move one widget to (x, y); others make room. Always works from the layout as it was when the
 *  drag started, so moving back and forth is undone cleanly. */
export function moveItem(layout, id, x, y) {
  const it = layout.find((i) => i.id === id);
  if (!it) return layout;
  const target = { ...it, x: clamp(Math.round(x), 0, COLS - it.w), y: Math.max(0, Math.round(y)) };
  const others = layout.filter((i) => i.id !== id);
  // dropped squarely on a widget of the same size: the two swap places
  const hits = others.filter((o) => overlaps(target, o));
  if (hits.length === 1 && hits[0].w === it.w && hits[0].h === it.h && hits[0].x === target.x && hits[0].y === target.y) {
    return compact([...others.map((o) => (o === hits[0] ? { ...o, x: it.x, y: it.y } : o)), target]);
  }
  // otherwise: with the moved widget lifted out, anything whose middle is above its new top stays
  // above it, and the rest goes below it
  const base = compact(others);
  const placed = [];
  const rest = [];
  for (const o of readingOrder(base)) (o.y + o.h / 2 <= target.y + 0.5 ? placed : rest).push(o);
  const pin = { ...target };
  for (let hit = placed.find((p) => overlaps(pin, p)); hit; hit = placed.find((p) => overlaps(pin, p))) pin.y = hit.y + hit.h;
  placed.push(pin);
  for (const o of rest) placed.push(settle(o, placed));
  return compact(placed);
}

/** Resize one widget (kept within its min size and the grid); others make room. */
export function resizeItem(layout, id, w, h, min = {}) {
  const it = layout.find((i) => i.id === id);
  if (!it) return layout;
  const nw = clamp(Math.round(w), min.minW || 1, Math.min(min.maxW || COLS, COLS - it.x));
  const nh = clamp(Math.round(h), min.minH || 1, min.maxH || 99);
  return compact(layout.map((i) => (i.id === id ? { ...i, w: nw, h: nh } : i)), id);
}

/** The first free spot (top to bottom, left to right) a w×h widget fits in. */
export function firstFit(layout, w, h) {
  const width = Math.min(w, COLS);
  for (let y = 0; y <= bottom(layout); y++) {
    for (let x = 0; x + width <= COLS; x++) {
      const probe = { id: '\0probe', x, y, w: width, h };
      if (!layout.some((p) => overlaps(probe, p))) return { x, y };
    }
  }
  return { x: 0, y: bottom(layout) };
}

export function addItem(layout, id, w, h) {
  if (layout.some((i) => i.id === id)) return layout;
  const width = Math.min(w, COLS);
  const at = firstFit(layout, width, h);
  return compact([...layout, { id, ...at, w: width, h }]);
}

export const removeItem = (layout, id) => compact(layout.filter((i) => i.id !== id));

/** Clean a saved layout: drop unknown/duplicate widgets, keep sizes within limits, fix overlaps. */
export function normalize(layout, specs) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(layout) ? layout : []) {
    const spec = raw && specs[raw.id];
    if (!spec || seen.has(raw.id)) continue;
    seen.add(raw.id);
    const w = clamp(Math.round(Number(raw.w) || spec.w), spec.minW || 1, COLS);
    const h = clamp(Math.round(Number(raw.h) || spec.h), spec.minH || 1, 99);
    out.push({ id: raw.id, w, h, x: clamp(Math.round(Number(raw.x) || 0), 0, COLS - w), y: Math.max(0, Math.round(Number(raw.y) || 0)), ...(raw.opts ? { opts: raw.opts } : {}) });
  }
  return compact(out);
}

/** Lay out widgets in order, each at its default size, packing left to right. */
export function pack(ids, specs) {
  let l = [];
  for (const id of ids) if (specs[id]) l = addItemAtEnd(l, id, specs[id].w, specs[id].h);
  return l;
}

/** Like addItem, but only after (never above) the last widget, so the order is kept. */
function addItemAtEnd(layout, id, w, h) {
  const last = layout[layout.length - 1];
  let x = last ? last.x + last.w : 0, y = last ? last.y : 0;
  if (x + w > COLS) { x = 0; y = bottom(layout); }
  while (layout.some((p) => overlaps({ id, x, y, w, h }, p))) y++;
  return [...layout, { id, x, y, w, h }];
}

/** Pixel position of a grid cell. */
export function cellBox(it, colW, rowH, gap) {
  return { left: it.x * (colW + gap), top: it.y * (rowH + gap), width: it.w * colW + (it.w - 1) * gap, height: it.h * rowH + (it.h - 1) * gap };
}

/** Grid position nearest a pixel offset (for dragging). */
export function cellAt(px, py, colW, rowH, gap) {
  return { x: Math.round(px / (colW + gap)), y: Math.round(py / (rowH + gap)) };
}

/** Grid size nearest a pixel size (for resizing). */
export function spanFor(pw, ph, colW, rowH, gap) {
  return { w: Math.max(1, Math.round((pw + gap) / (colW + gap))), h: Math.max(1, Math.round((ph + gap) / (rowH + gap))) };
}

const sameLayout = (a, b) => a.length === b.length && a.every((i) => { const j = b.find((x) => x.id === i.id); return j && j.x === i.x && j.y === i.y && j.w === i.w && j.h === i.h; });

/** Keyboard move: one step left/right/up/down — far enough that something actually changes. */
export function nudge(layout, id, dx, dy) {
  const it = layout.find((i) => i.id === id);
  if (!it) return layout;
  for (let k = 1; k <= bottom(layout) + 1; k++) {
    const m = moveItem(layout, id, it.x + dx * k, it.y + dy * k);
    if (!sameLayout(m, layout)) return m;
    if (dx) break; // sideways: one column at a time (or nothing, at the edge)
  }
  return layout;
}
