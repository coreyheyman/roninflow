// Click a stat's name to see what it means, how it's worked out and what your number says.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useStore } from '../store/store';
import { fmtMoney } from '../lib/stats';
import { explain, statKey } from '../lib/statInfo';

const TONE = { good: 'pos', ok: 'warn', bad: 'neg', none: 'muted' };

/** Wrap a stat's label: <StatLabel k="profitFactor" v={s.profitFactor} ctx={s}>Profit Factor</StatLabel>
 *  (k can be left out when the label is a known stat name; v defaults to ctx[k]). */
export function StatLabel({ k, v, ctx, children, className = '' }) {
  const key = k || statKey(typeof children === 'string' ? children : '');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  if (!key) return children;
  return (
    <>
      <span ref={ref} role="button" tabIndex={0} className={`stat-q ${open ? 'on' : ''} ${className}`} title="What does this mean?"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((o) => !o); } }}>
        {children}
      </span>
      {open && <StatPop anchor={ref} onClose={close} k={key} v={v !== undefined ? v : key === 'trades' ? ctx?.count : ctx?.[key]} ctx={ctx} />}
    </>
  );
}

function StatPop({ anchor, k, v, ctx, onClose }) {
  const { state } = useStore();
  const priv = state.settings.privacy;
  const money = (x) => (priv ? '•••' : fmtMoney(x, { dp: Math.abs(x) >= 100 ? 0 : 2 }));
  const info = explain(k, v, ctx, money);
  const box = useRef(null);
  const [pos, setPos] = useState({ left: -9999, top: 0 });
  // sits under its stat (above it if there's no room), stays on screen, and follows the stat when the page scrolls
  const place = useCallback(() => {
    const a = anchor.current?.getBoundingClientRect();
    const el = box.current;
    if (!a || !el) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    if (a.bottom < 0 || a.top > vh) { onClose(); return; }
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = Math.min(Math.max(12, a.left), vw - w - 12);
    const below = a.bottom + 8;
    const top = below + h > vh - 12 && a.top - h - 8 > 12 ? a.top - h - 8 : Math.min(below, vh - h - 12);
    setPos({ left, top: Math.max(12, top) });
  }, [anchor, onClose]);
  useLayoutEffect(place, [place]);
  useEffect(() => {
    const out = (e) => { if (box.current && !box.current.contains(e.target) && !anchor.current?.contains(e.target)) onClose(); };
    const key = (e) => e.key === 'Escape' && onClose();
    const move = (e) => { if (!box.current?.contains(e.target)) place(); };
    document.addEventListener('mousedown', out);
    document.addEventListener('touchstart', out, { passive: true });
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', move, true);
    window.addEventListener('resize', place);
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('touchstart', out); document.removeEventListener('keydown', key); window.removeEventListener('scroll', move, true); window.removeEventListener('resize', place); };
  }, [anchor, onClose, place]);
  if (!info) return null;
  const r = info.result;
  return createPortal(
    <div ref={box} className="stat-pop" style={pos} role="dialog" aria-label={info.name} onClick={(e) => e.stopPropagation()}>
      <div className="stat-pop-h"><b>{info.name}</b><button className="icon-btn" onClick={onClose} title="Close"><X size={14} /></button></div>
      <p>{info.what}</p>
      <div className="stat-pop-how"><span>How it’s worked out</span>{info.how}</div>
      {info.bench && <div className="stat-pop-bench">{info.bench}</div>}
      {r && (
        <div className={`stat-pop-you ${r.tone}`}>
          <div className="row gap8"><span className="muted">For you</span><b className={TONE[r.tone]}>{r.verdict}</b></div>
          <p>{r.text}</p>
        </div>
      )}
      {info.small && r?.tone !== 'none' && <div className="stat-pop-note">Based on only {ctx.count} trade{ctx.count === 1 ? '' : 's'} — treat it as a first read.</div>}
    </div>,
    document.body,
  );
}
