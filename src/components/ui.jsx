import { StatLabel } from './StatInfo';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { X, ChevronDown, CalendarDays, Check, TrendingUp, TrendingDown, Wallet } from 'lucide-react';
import { useStore } from '../store/store';
import { fmtMoney, fmtDate, datePresets, MONTHS_LONG, keyOf, pad } from '../lib/stats';

/** Money that respects privacy mode (eye icon in the top bar). */
export function Money({ v, prefix = '$', sign = false, colored = false, className = '', dp = 2 }) {
  const { state } = useStore();
  const cls = `${colored ? (v > 0 ? 'pos' : v < 0 ? 'neg' : '') : ''} ${state.settings.privacy ? 'hidden-val' : ''} ${className}`;
  return <span className={cls}>{fmtMoney(v, { prefix, sign, dp })}</span>;
}
export function Private({ children, className = '' }) {
  const { state } = useStore();
  return <span className={`${state.settings.privacy ? 'hidden-val' : ''} ${className}`}>{children}</span>;
}

export function TrendBadge({ value, label, soft = false, suffix = '%' }) {
  const up = value >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`badge ${up ? 'pos' : 'neg'}${soft ? '-soft' : ''}`}>
      <Icon size={13} strokeWidth={2.2} />
      {label ?? `${up ? '+' : ''}${Math.abs(value) >= 1000 ? value.toFixed(1) : value.toFixed(1)}${suffix}`}
    </span>
  );
}

export function Modal({ open, onClose, width = 560, children, className = '' }) {
  useEffect(() => {
    if (!open) return;
    const k = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${className}`} style={{ maxWidth: width }}>
        {children}
      </div>
    </div>
  );
}
export const CloseX = ({ onClick }) => (
  <button className="close-x" onClick={onClick} aria-label="Close">
    <X size={13} strokeWidth={3} />
  </button>
);
export function ModalHead({ title, sub, onClose }) {
  return (
    <div className="modal-head">
      <div>
        <div className="modal-title">{title}</div>
        {sub && <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{sub}</div>}
      </div>
      {onClose && <CloseX onClick={onClose} />}
    </div>
  );
}

export function Drawer({ open, onClose, children }) {
  useEffect(() => {
    if (!open) return;
    const k = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="overlay" onMouseDown={onClose} style={{ zIndex: 50 }} />
      <div className="drawer">{children}</div>
    </>
  );
}

/** Click-outside popover anchored under its trigger. */
export function Popover({ trigger, children, align = 'left', width, className = '', up = false, block = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative', display: block ? 'flex' : 'inline-flex', width: block ? '100%' : undefined }} className={className}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div className="pop" style={{ [up ? 'bottom' : 'top']: 'calc(100% + 6px)', [align]: 0, width }}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}

export function Seg({ options, value, onChange, icon = false }) {
  return (
    <div className={`seg ${icon ? 'icon' : ''}`}>
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)} title={o.title || o.label}>
          {o.icon && <o.icon size={icon ? 15 : 15} />}
          {o.label && !icon && <span>{o.label}</span>}
        </button>
      ))}
    </div>
  );
}

export const Switch = ({ on, onChange }) => <button className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} aria-pressed={on} />;

/** Pick the account the page shows. `compact` renders it as a toolbar button instead of a title. */
export function AccountPicker({ compact = false, counts }) {
  const { state, setSetting } = useStore();
  const cur = state.settings.account;
  const hide = !!state.settings.hideBreached;
  const breached = state.accounts.filter((a) => a.status === 'Breached').length;
  const label = cur === 'all' ? 'All accounts' : cur;
  return (
    <Popover width={compact ? 280 : undefined}
      trigger={({ toggle }) => (compact
        ? <button className="btn acct-btn" onClick={toggle} title="Account"><Wallet size={14} className="muted" /> <span className="truncate">{label}</span> <ChevronDown size={14} className="muted" /></button>
        : (
          <div className="acct-title">
            <button onClick={toggle}>
              {label} <ChevronDown size={16} className="muted" />
            </button>
          </div>
        ))}
    >
      {(close) => (
        <>
          {[{ id: 'all', status: '' }, ...state.accounts.filter((a) => !hide || a.status !== 'Breached' || a.id === cur)].map((a) => (
            <button key={a.id} className={`pop-item ${cur === a.id ? 'on' : ''}`} onClick={() => { setSetting('account', a.id); close(); }}>
              <span className="grow">{a.id === 'all' ? 'All accounts' : a.id}</span>
              {counts && <span className="muted" style={{ fontSize: 11.5 }}>{counts[a.id] || 0}</span>}
              {a.status && <span className={`status ${a.status}`}>{a.status}</span>}
              {cur === a.id && <Check size={14} />}
            </button>
          ))}
          {breached > 0 && (
            <div className="pop-foot" onClick={() => setSetting('hideBreached', !hide)}>
              <span className="grow">Hide breached accounts{!hide && <span className="muted"> ({breached})</span>}</span>
              <span onClick={(e) => e.stopPropagation()}><Switch on={hide} onChange={(v) => setSetting('hideBreached', v)} /></span>
            </div>
          )}
          <div className="pop-foot" style={{ borderTop: breached ? 0 : undefined }} onClick={() => setSetting('maskAccounts', !state.settings.maskAccounts)}>
            <span className="grow">Mask account numbers</span>
            <span onClick={(e) => e.stopPropagation()}><Switch on={!!state.settings.maskAccounts} onChange={(v) => setSetting('maskAccounts', v)} /></span>
          </div>
        </>
      )}
    </Popover>
  );
}

/** Date range button + preset list + mini calendar */
export function DateRange({ value, onChange }) {
  const presets = datePresets();
  const [anchor, setAnchor] = useState(() => new Date());
  const [pick, setPick] = useState(null);
  const label = value?.from || value?.to ? (value.from === value.to ? fmtDate(value.from) : `${value.from ? fmtDate(value.from) : '…'} – ${value.to ? fmtDate(value.to) : '…'}`) : 'Select date range';
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  const first = (new Date(y, m, 1).getDay() + 6) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => `${y}-${pad(m + 1)}-${pad(i + 1)}`)];
  const inSel = (k) => value?.from && value?.to && k >= value.from && k <= value.to;
  return (
    <Popover
      width={470}
      trigger={({ toggle }) => (
        <button className="btn" onClick={toggle}>
          <CalendarDays size={16} />
          {label}
          {(value?.from || value?.to) && (
            <span onClick={(e) => { e.stopPropagation(); onChange({ from: null, to: null }); }} className="muted" style={{ display: 'grid' }}>
              <X size={13} />
            </span>
          )}
        </button>
      )}
    >
      {(close) => (
        <div className="row" style={{ alignItems: 'stretch' }}>
          <div className="col" style={{ width: 150, borderRight: '1px solid var(--border)', paddingRight: 6 }}>
            {presets.map((p) => (
              <button key={p.label} className="pop-item" onClick={() => { onChange({ from: p.from, to: p.to }); close(); }}>{p.label}</button>
            ))}
          </div>
          <div style={{ padding: '6px 10px', flex: 1 }}>
            <div className="row between" style={{ marginBottom: 8 }}>
              <button className="icon-btn" onClick={() => setAnchor(new Date(y, m - 1, 1))}>‹</button>
              <b style={{ fontWeight: 500 }}>{MONTHS_LONG[m]} {y}</b>
              <button className="icon-btn" onClick={() => setAnchor(new Date(y, m + 1, 1))}>›</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, fontSize: 12, textAlign: 'center' }}>
              {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => <div key={d} className="muted" style={{ padding: 4 }}>{d}</div>)}
              {cells.map((k, i) =>
                k ? (
                  <button
                    key={k}
                    onClick={() => {
                      if (!pick) { setPick(k); onChange({ from: k, to: k }); }
                      else { const [a, b] = [pick, k].sort(); onChange({ from: a, to: b }); setPick(null); close(); }
                    }}
                    style={{ padding: '6px 0', borderRadius: 3, background: inSel(k) ? 'var(--primary)' : k === keyOf(new Date()) ? 'var(--card-3)' : 'transparent', color: inSel(k) ? '#fff' : undefined }}
                  >
                    {Number(k.slice(8))}
                  </button>
                ) : <div key={'e' + i} />,
              )}
            </div>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>{pick ? 'Select end date' : 'Click a start date, then an end date'}</div>
          </div>
        </div>
      )}
    </Popover>
  );
}

// ---------- toast ----------
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [msg, setMsg] = useState(null);
  const show = useCallback((m) => {
    setMsg(m);
    clearTimeout(window.__toastT);
    window.__toastT = setTimeout(() => setMsg(null), 2400);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && <div className="toast">{msg}</div>}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function Confirm({ open, title, body, onCancel, onConfirm, confirmText = 'Delete' }) {
  return (
    <Modal open={open} onClose={onCancel} width={420}>
      <ModalHead title={title} onClose={onCancel} />
      <div className="modal-body muted">{body}</div>
      <div className="modal-foot">
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" style={{ background: 'var(--neg-strong)' }} onClick={onConfirm}>{confirmText}</button>
      </div>
    </Modal>
  );
}

export function useSize() {
  const ref = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/** Session score badge; with the session's stats (ctx) it's clickable and explains itself. */
export function ScoreBox({ v, ctx }) {
  const box = <span className={`score ${v >= 50 ? 'good' : v >= 45 ? 'mid' : 'bad'}`}>{v}</span>;
  return ctx ? <StatLabel k="score" v={v} ctx={ctx} className="score-q">{box}</StatLabel> : box;
}

export function Stars({ value = 0, onChange }) {
  return (
    <div className="row gap4">
      {[1, 2, 3, 4, 5].map((i) => (
        <button key={i} onClick={() => onChange?.(i === value ? 0 : i)} style={{ color: i <= value ? 'var(--warn)' : 'var(--muted-2)', fontSize: 18, lineHeight: 1 }}>★</button>
      ))}
    </div>
  );
}

/** Read an image File into a (downscaled) data URL so it fits in localStorage. */
export function fileToDataUrl(file, max = 1400) {
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = img.width * s;
        c.height = img.height * s;
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => res(r.result);
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}
