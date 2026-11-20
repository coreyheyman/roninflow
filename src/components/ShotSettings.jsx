// Settings → Screenshots: pick the folder your screenshots save to and they're filed automatically — on the trade
// that was open when you took it (or had just closed), otherwise on that day's diary.
import { useEffect, useState } from 'react';
import { Check, Upload, FolderOpen, TriangleExclamationPoint as TriangleAlert } from 'lucide-react';
import { Switch, useToast } from './ui';
import { ShotUploadModal } from './ShotUpload';
import { fmtDate, fmtTime12, wallClock } from '../lib/stats';

const jsonOf = async (r) => ((r.headers.get('content-type') || '').includes('json') ? r.json() : null);

export default function ShotSettings() {
  const toast = useToast();
  const [cfg, setCfg] = useState(null);
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState(false);
  const load = () => fetch('/api/shots/config', { cache: 'no-store' }).then((r) => (r.ok ? jsonOf(r) : false)).then((j) => { setCfg(j || false); if (j) setFolder(j.folder || ''); }).catch(() => setCfg(false));
  useEffect(() => { load(); const id = setInterval(load, 10e3); return () => clearInterval(id); }, []);
  const save = async (patch, ok) => {
    setBusy(true);
    try {
      const r = await fetch('/api/shots/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
      const j = await jsonOf(r);
      if (!r.ok) throw new Error(j?.error || 'Couldn’t save');
      setCfg(j); setFolder(j.folder || '');
      if (ok) toast(ok);
    } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const backfill = async (hours) => {
    setBusy(true);
    try {
      const r = await fetch('/api/shots/backfill', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hours }) });
      const j = await jsonOf(r);
      if (!r.ok) throw new Error(j?.error || 'Couldn’t look');
      setCfg(j); toast(j.added ? `${j.added} screenshot${j.added === 1 ? '' : 's'} found — filing them now` : 'No new screenshots in that time');
    } catch (e) { toast(e.message); }
    setBusy(false);
  };
  if (cfg === null) return <div className="muted">Loading…</div>;
  if (cfg === false) return <div className="muted">This needs the journal server running on your computer (it watches a folder there). Update RoninFlow if you’re running an older version.</div>;
  const dirty = folder.trim() !== (cfg.folder || '');
  return (
    <div className="col gap16">
      <div className="muted" style={{ fontSize: 13 }}>
        Pick the folder your screenshots save to and every new one is filed for you — on the trade that was open when you took it, or the one that had just closed, otherwise on that day’s diary. Works with any app: Snipping Tool, Win+Shift+S, ShareX, your platform’s screenshot button, or TradingView’s downloads.
      </div>
      <div className="panel col gap10" style={{ padding: 14 }}>
        <div className="row between gap8">
          <b style={{ fontWeight: 600 }}>Import screenshots automatically</b>
          <div className="row gap8">
            {cfg.on && cfg.exists && <span className="badge pos-soft"><Check size={12} /> Watching</span>}
            <Switch on={!!cfg.on} onChange={(v) => { if (v && !cfg.folder && !folder.trim()) { toast('Choose a folder first'); return; } save(v && dirty ? { folder, on: true } : { on: v }, v ? 'Watching for new screenshots' : 'Stopped'); }} />
          </div>
        </div>
        <div className="field">
          <label className="label">Screenshot folder (on the computer running RoninFlow)</label>
          <div className="row gap8">
            <input className="input grow" value={folder} placeholder="C:\Users\you\Pictures\Screenshots" onChange={(e) => setFolder(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && dirty) save({ folder }, 'Folder saved'); }} />
            <button className="btn" disabled={!dirty || busy} onClick={() => save({ folder }, 'Folder saved')}>Save</button>
          </div>
          {cfg.suggestions?.length > 0 && (
            <div className="row gap6 wrap" style={{ marginTop: 8 }}>
              {cfg.suggestions.map((s) => (
                <button key={s.path} type="button" className={`chip ${cfg.folder === s.path ? 'on' : ''}`} title={s.path} onClick={() => save({ folder: s.path, ...(cfg.on ? {} : { on: true }) }, `Watching ${s.label}`)}><FolderOpen size={12} /> {s.label}</button>
              ))}
            </div>
          )}
          {cfg.folder && !cfg.exists && <div className="ec-warn" style={{ marginTop: 8 }}><TriangleAlert size={14} /> That folder can’t be found right now.</div>}
          {cfg.error && cfg.exists && <div className="ec-warn" style={{ marginTop: 8 }}>{cfg.error}</div>}
        </div>
        <div className="field">
          <label className="label">Still counts for a trade up to</label>
          <div className="row gap8">
            <select className="select" style={{ width: 240 }} value={cfg.after} onChange={(e) => save({ after: Number(e.target.value) })}>
              {[0, 2, 5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m ? `${m} min after it closes` : 'only while it’s open'}</option>)}
            </select>
            <span className="muted" style={{ fontSize: 12.5 }}>Later ones go on that day’s diary.</span>
          </div>
        </div>
        <div className="row gap8 wrap" style={{ fontSize: 12.5 }}>
          <span className="muted">{cfg.imported ? `${cfg.imported} imported${cfg.lastAt ? ` · last ${fmtDate(wallClock(new Date(cfg.lastAt)).slice(0, 10))} ${fmtTime12(wallClock(new Date(cfg.lastAt)))}` : ''}` : 'Nothing imported yet'}{cfg.pending ? ` · ${cfg.pending} waiting to be filed` : ''}</span>
          <div className="grow" />
          {cfg.folder && <>
            <span className="muted">Pick up ones already there from:</span>
            <button className="btn xs" disabled={busy} onClick={() => backfill(24)}>Last 24 hours</button>
            <button className="btn xs" disabled={busy} onClick={() => backfill(24 * 7)}>Last 7 days</button>
          </>}
        </div>
      </div>
      <div className="panel col gap8" style={{ padding: 14 }}>
        <div className="row between gap8 wrap">
          <div className="col" style={{ gap: 2 }}>
            <b style={{ fontWeight: 600 }}>Upload screenshots from a period</b>
            <span className="muted" style={{ fontSize: 12.5 }}>Moving from another journal, or have a folder of old charts? Choose the folder and the dates — every picture is filed on its trade or diary day.</span>
          </div>
          <button className="btn" onClick={() => setUpload(true)}><Upload size={14} /> Upload screenshots</button>
        </div>
      </div>
      <ShotUploadModal open={upload} onClose={() => setUpload(false)} />
      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
        How it’s matched: by the time the picture was taken, against your trades’ entry and exit times. If several markets were open at once and the coach’s AI is set up, it reads the instrument off the picture to pick the right trade. A picture taken during a trade that hasn’t synced yet waits until it does. Diary screenshots get a caption with the market and timeframe. Only new pictures are picked up — use the buttons above for earlier ones.
      </div>
    </div>
  );
}
