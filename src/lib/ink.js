// Freehand ink shared by the screenshot editor and the chart's brush: smooth pressure-aware strokes, and the
// handwriting grouping settings (strokes written close together, one after another, become one drawing).

export const store = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } },
};

/** How far apart strokes may be and still join the open group: × the larger of 40px, 8 line widths, 60% of its height. */
export const GROUP_DIST = [{ v: 1, label: 'Close' }, { v: 2, label: 'Normal' }, { v: 4, label: 'Far' }];
export const GROUP_KEY = 'rf-draw-group';
export const GROUP_DEFAULT = { on: true, secs: 5, dist: 2 };

/** Does a new stroke's box [x1, y1, x2, y2] reach the open group's box? */
export function joinsGroup(group, stroke, dist, unit, width) {
  const reach = dist * Math.max(40 * unit, width * 8, (group[3] - group[1]) * 0.6);
  const gx = Math.max(0, stroke[0] - group[2], group[0] - stroke[2]), gy = Math.max(0, stroke[1] - group[3], group[1] - stroke[3]);
  return gx <= reach && gy <= reach;
}

const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
/**
 * A freehand stroke ([[x, y, pressure]]) as smooth curves through the midpoints of its samples. With `pressW` (a pen
 * or tablet's pressure was recorded) each piece takes its own width from the pressure, so handwriting thickens and thins.
 */
export function strokeSmooth(ctx, pts, pressW) {
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
