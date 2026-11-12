// Drag-and-drop widget grid for the dashboard.
// Desktop: in edit mode, drag a widget anywhere to move it (others make room), drag its bottom-right
// corner to resize it, or use the arrow keys on its handle (Shift + arrows resizes).
// Narrow screens: widgets stack in one column; they can still be added, removed and configured.
import { useCallback, useEffect, useRef, useState } from 'react';
import { GripVertical, Settings2, X } from 'lucide-react';
import { useSize } from './ui';
import { COLS, bottom, cellAt, cellBox, moveItem, nudge, readingOrder, resizeItem, spanFor } from '../lib/grid';
import { GAP, ROW_H, WIDGETS } from '../lib/widgets';

export const MOBILE_W = 760;

export default function DashGrid({ layout, editing, onChange, renderItem, renderSettings, onRemove }) {
  const [ref, { w }] = useSize();
  const mobile = w > 0 && w < MOBILE_W;
  const colW = Math.max(1, (w - GAP * (COLS - 1)) / COLS);
  const [drag, setDrag] = useState(null); // { id, mode, start, preview, box, grab }
  const [settingsFor, setSettingsFor] = useState(null);
  const dragRef = useRef(null);
  dragRef.current = drag;
  const ptr = useRef({ x: 0, y: 0 });

  useEffect(() => { if (!editing) setSettingsFor(null); }, [editing]);

  // pointer position → where the dragged widget is (px, relative to the grid) and the layout it gives
  const update = useCallback(() => {
    const d = dragRef.current;
    const el = ref.current;
    if (!d || !el) return;
    const r = el.getBoundingClientRect();
    const px = ptr.current.x - r.left, py = ptr.current.y - r.top;
    const item = d.start.find((i) => i.id === d.id);
    let box, preview;
    if (d.mode === 'move') {
      box = { ...d.box, left: px - d.grab.x, top: py - d.grab.y };
      const c = cellAt(box.left, box.top, colW, ROW_H, GAP);
      preview = moveItem(d.start, d.id, c.x, c.y);
    } else {
      const spec = WIDGETS[d.id] || {};
      const width = Math.max(colW, px - d.box.left + d.grab.x), height = Math.max(ROW_H, py - d.box.top + d.grab.y);
      box = { ...d.box, width: Math.min(width, w - d.box.left), height };
      const s = spanFor(box.width, box.height, colW, ROW_H, GAP);
      preview = resizeItem(d.start, d.id, s.w, s.h, spec);
      if (s.w === item.w && s.h === item.h) preview = d.start;
    }
    setDrag({ ...d, box, preview });
  }, [colW, ref, w]);

  // keep scrolling while the pointer is held near the top/bottom of the page
  useEffect(() => {
    if (!drag) return undefined;
    const scroller = scrollParent(ref.current);
    let raf;
    const tick = () => {
      const vh = scroller === document.documentElement ? window.innerHeight : scroller.getBoundingClientRect().bottom;
      const top = scroller === document.documentElement ? 0 : scroller.getBoundingClientRect().top;
      const y = ptr.current.y;
      const step = y < top + 70 ? -Math.ceil((top + 70 - y) / 5) : y > vh - 70 ? Math.ceil((y - (vh - 70)) / 5) : 0;
      if (step) { scroller.scrollTop += step; update(); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [!!drag, update]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = (e, it, mode) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest('.gw-btn')) return;
    e.preventDefault();
    e.stopPropagation();
    const el = ref.current;
    const r = el.getBoundingClientRect();
    const box = cellBox(it, colW, ROW_H, GAP);
    const px = e.clientX - r.left, py = e.clientY - r.top;
    ptr.current = { x: e.clientX, y: e.clientY };
    setSettingsFor(null);
    setDrag({ id: it.id, mode, start: layout, preview: layout, box, grab: mode === 'move' ? { x: px - box.left, y: py - box.top } : { x: box.left + box.width - px, y: box.top + box.height - py } });
    const move = (ev) => { ptr.current = { x: ev.clientX, y: ev.clientY }; update(); };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const d = dragRef.current;
      setDrag(null);
      if (d && d.preview !== d.start) onChange(d.preview);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const onKey = (e, it) => {
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!dir) return;
    e.preventDefault();
    if (e.shiftKey) onChange(resizeItem(layout, it.id, it.w + dir[0], it.h + dir[1], WIDGETS[it.id]));
    else onChange(nudge(layout, it.id, dir[0], dir[1]));
  };

  const shown = drag ? drag.preview : layout;
  const rows = bottom(shown);
  const height = mobile ? undefined : Math.max(0, rows * (ROW_H + GAP) - GAP) + (editing ? 4 * (ROW_H + GAP) : 0);

  const chrome = (it, canMove) => editing && (
    <>
      <div className="gw-tools" onPointerDown={(e) => e.stopPropagation()}>
        {canMove && <span className="gw-btn gw-grip" role="button" tabIndex={0} title="Drag to move · arrow keys move · Shift + arrows resize" aria-label={`Move ${WIDGETS[it.id]?.name}`} onKeyDown={(e) => onKey(e, it)}><GripVertical size={14} /></span>}
        <button className={`gw-btn ${settingsFor === it.id ? 'on' : ''}`} title="Widget settings" aria-label="Widget settings" onClick={() => setSettingsFor(settingsFor === it.id ? null : it.id)}><Settings2 size={14} /></button>
        <button className="gw-btn del" title="Remove widget" aria-label="Remove widget" onClick={() => onRemove(it.id)}><X size={14} /></button>
      </div>
      {settingsFor === it.id && (
        <div className="gw-settings" onPointerDown={(e) => e.stopPropagation()}>
          <div className="gw-settings-h"><b>{WIDGETS[it.id]?.name}</b><button className="icon-btn" onClick={() => setSettingsFor(null)} aria-label="Close settings"><X size={14} /></button></div>
          {renderSettings(it)}
        </div>
      )}
    </>
  );

  if (mobile) {
    return (
      <div ref={ref} className={`dgrid mobile ${editing ? 'editing' : ''}`}>
        {editing && <div className="dgrid-note">Moving and resizing is only available on a wider screen. You can still add, remove and configure widgets here.</div>}
        {readingOrder(layout).map((it) => (
          <div key={it.id} className="gw" data-id={it.id} style={{ height: Math.max(it.h, mobileMin(it)) * ROW_H + (Math.max(it.h, mobileMin(it)) - 1) * GAP }}>
            <div className="gw-body">{renderItem(it)}</div>
            {chrome(it, false)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div ref={ref} className={`dgrid ${editing ? 'editing' : ''} ${drag ? 'dragging' : ''}`} style={{ height }}>
      {editing && w > 0 && <GridCells colW={colW} rows={Math.ceil((height + GAP) / (ROW_H + GAP))} />}
      {drag && (() => {
        const it = drag.preview.find((i) => i.id === drag.id);
        const b = cellBox(it, colW, ROW_H, GAP);
        return <div className="gw-ph" style={{ transform: `translate(${b.left}px, ${b.top}px)`, width: b.width, height: b.height }} />;
      })()}
      {w > 0 && shown.map((it) => {
        const active = drag?.id === it.id;
        const b = active ? drag.box : cellBox(it, colW, ROW_H, GAP);
        return (
          <div key={it.id} data-id={it.id} className={`gw ${active ? 'active' : ''}`}
            style={{ transform: `translate(${b.left}px, ${b.top}px)`, width: b.width, height: b.height }}
            onPointerDown={editing ? (e) => start(e, layout.find((i) => i.id === it.id), 'move') : undefined}>
            <div className="gw-body">{renderItem(it)}</div>
            {chrome(it, true)}
            {editing && <span className="gw-resize" title="Drag to resize" onPointerDown={(e) => start(e, layout.find((i) => i.id === it.id), 'resize')} />}
          </div>
        );
      })}
    </div>
  );
}

// on a phone a widget is the full width, so a few need a bit more height than on desktop
const mobileMin = (it) => ({ hold: 5, longShort: 4, payouts: 4, progress: 4 }[it.id] || 0);

function GridCells({ colW, rows }) {
  return (
    <svg className="dgrid-cells" width="100%" height={rows * (ROW_H + GAP)} aria-hidden="true">
      <defs>
        <pattern id="dgrid-cell" width={colW + GAP} height={ROW_H + GAP} patternUnits="userSpaceOnUse">
          <rect width={colW} height={ROW_H} rx="6" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#dgrid-cell)" />
    </svg>
  );
}

function scrollParent(el) {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement || document.documentElement;
}
