// Upload screenshots in bulk — a whole folder or a selection — for a period, filed on the trades and diary days they
// belong to. ShotPicker is the shared part (used inside the trade import); ShotUploadModal stands on its own.
import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FolderOpen, Images, X } from 'lucide-react';
import { Modal, ModalHead, useToast } from './ui';
import { useStore } from '../store/store';
import { planShots, planSummary, fileShots, isImage } from '../lib/shotImport';
import { fmtDate } from '../lib/stats';

/** Pick a folder or pictures, and the dates to take them from. */
export function ShotPicker({ files, onFiles, from, to, onFrom, onTo, summary, compact }) {
  const dirRef = useRef(null), fileRef = useRef(null);
  const add = (list) => { const imgs = [...list].filter(isImage); if (imgs.length) onFiles([...files, ...imgs]); };
  return (
    <div className="col shot-picker" style={{ gap: 10 }}>
      <div className="row gap8 wrap">
        <button type="button" className="btn sm" onClick={() => dirRef.current?.click()}><FolderOpen size={14} /> Choose a folder</button>
        <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}><Images size={14} /> Choose pictures</button>
        {files.length > 0 && <span className="muted row" style={{ fontSize: 12.5, gap: 4, whiteSpace: 'nowrap' }}>{files.length} picture{files.length === 1 ? '' : 's'} chosen <button type="button" className="icon-btn" style={{ width: 22, height: 22 }} title="Clear" onClick={() => onFiles([])}><X size={12} /></button></span>}
        <input ref={dirRef} type="file" hidden multiple webkitdirectory="" directory="" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
        <input ref={fileRef} type="file" hidden multiple accept="image/*" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
      </div>
      <div className="row gap8 wrap" style={{ alignItems: 'center', fontSize: 13 }}>
        <span className="muted">Taken from</span>
        <input type="date" className="input" style={{ height: 32, width: 150 }} value={from} onChange={(e) => onFrom(e.target.value)} />
        <span className="muted">to</span>
        <input type="date" className="input" style={{ height: 32, width: 150 }} value={to} onChange={(e) => onTo(e.target.value)} />
      </div>
      {summary && summary.total > 0 && (
        <div className="muted" style={{ fontSize: 12.5 }}>
          {summary.trades > 0 && <span><b style={{ color: 'var(--fg)' }}>{summary.trades}</b> on {summary.tradeCount} trade{summary.tradeCount === 1 ? '' : 's'}</span>}
          {summary.trades > 0 && summary.days > 0 && ' · '}
          {summary.days > 0 && <span><b style={{ color: 'var(--fg)' }}>{summary.days}</b> on {summary.dayCount} diary day{summary.dayCount === 1 ? '' : 's'}</span>}
          {summary.outside > 0 && <span> · {summary.outside} outside these dates (skipped)</span>}
        </div>
      )}
      {!compact && <div className="muted2" style={{ fontSize: 12 }}>Each picture goes on the trade that was open when it was taken (or closed within 10 minutes), otherwise on that day’s diary. The time comes from the file name when it has one (Snipping Tool, macOS, TradingView, ShareX), otherwise from the file’s date.</div>}
    </div>
  );
}

/** Settings → Screenshots → “Upload screenshots”: any period, against the trades already in the journal. */
export function ShotUploadModal({ open, onClose }) {
  const { state, updateTrade, saveDiary } = useStore();
  const ref = useRef(state); ref.current = state;
  const toast = useToast();
  const days = useMemo(() => state.trades.map((t) => String(t.entry).slice(0, 10)).filter(Boolean).sort(), [state.trades]);
  const [files, setFiles] = useState([]);
  const [from, setFrom] = useState(days[0] || '');
  const [to, setTo] = useState(days[days.length - 1] || '');
  const [prog, setProg] = useState(null);
  const plan = useMemo(() => planShots(files, state.trades, { from, to }), [files, state.trades, from, to]);
  const sum = planSummary(plan);
  const go = async () => {
    setProg([0, sum.total - sum.outside]);
    const r = await fileShots(plan, { getState: () => ref.current, updateTrade, saveDiary, onProgress: (d, n) => setProg([d, n]) });
    toast(`Added ${r.tradeShots + r.dayShots} screenshot${r.tradeShots + r.dayShots === 1 ? '' : 's'}${r.failed ? ` (${r.failed} couldn’t be read)` : ''}`);
    setProg(null); setFiles([]); onClose();
  };
  if (!open) return null;
  return createPortal(
    <Modal open onClose={prog ? () => {} : onClose} width={620} className="lle-modal">
      <ModalHead title="Upload screenshots" sub={days.length ? `Your trades run from ${fmtDate(days[0])} to ${fmtDate(days[days.length - 1])}` : 'Filed on your trades and diary days by the time they were taken'} onClose={prog ? undefined : onClose} />
      <div className="modal-body">
        <ShotPicker files={files} onFiles={setFiles} from={from} to={to} onFrom={setFrom} onTo={setTo} summary={sum} />
        {prog && <div className="shot-prog"><i style={{ width: `${(prog[0] / Math.max(1, prog[1])) * 100}%` }} /><span>Adding {prog[0]} of {prog[1]}…</span></div>}
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose} disabled={!!prog}>Cancel</button>
        <button className="btn white" disabled={!!prog || !(sum.trades + sum.days)} onClick={go}>Add {sum.trades + sum.days || ''} screenshot{sum.trades + sum.days === 1 ? '' : 's'}</button>
      </div>
    </Modal>,
    document.body,
  );
}
