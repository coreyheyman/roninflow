// "Update now": asks the server to download, verify and install the newest release (Windows installer copies),
// follows it through the restart, then reloads the page on the new version. Docker / source copies get the commands.
import { useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, Check, TriangleExclamationPoint as TriangleAlert, Loader } from 'lucide-react';
import { Modal, ModalHead } from './ui';

const jsonOf = async (r) => ((r.headers.get('content-type') || '').includes('json') ? r.json() : null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RESTART_LIMIT = 4 * 60e3; // give up waiting for the restart after this long

const plain = (t) => String(t || '').split('\n---')[0].replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1$2').trim();
/** Everything new since your version: the notes of each release in between, newest first. */
function WhatsNew({ info }) {
  const since = (info.notesSince || []).filter((n) => n.notes);
  if (!since.length) return info.notes ? <pre className="upd-notes">{plain(info.notes)}</pre> : null;
  return (
    <div className="upd-notes upd-since">
      {since.length > 1 && <div className="upd-since-h">{since.length} updates since your version {info.version} — you get all of them in this one update:</div>}
      {since.map((n) => (
        <div key={n.version} className="upd-ver">
          <div className="upd-ver-h">{n.version}{n.date && <span className="muted"> · {new Date(n.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>}</div>
          <pre>{plain(n.notes)}</pre>
        </div>
      ))}
    </div>
  );
}

export default function UpdateDialog({ open, info, onClose }) {
  const [phase, setPhase] = useState('confirm'); // confirm | running | restarting | done | error
  const [prog, setProg] = useState({ state: 'downloading', progress: 0 });
  const [err, setErr] = useState(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [was, setWas] = useState(open);
  if (was !== open) { setWas(open); if (open) { setPhase('confirm'); setErr(null); } }
  if (!open || !info) return null;

  const target = info.latest;
  const auto = !!info.update?.canAutoUpdate;
  const busy = phase === 'running' || phase === 'restarting';

  async function go() {
    setPhase('running'); setErr(null);
    try {
      const r = await fetch('/api/system/update', { method: 'POST', headers: { 'x-tj-update': '1' } });
      const j = await jsonOf(r);
      if (!r.ok) throw new Error(j?.error || `Couldn’t start the update (${r.status})`);
    } catch (e) { setErr(e.message); setPhase('error'); return; }
    const started = Date.now();
    let down = false;
    while (alive.current && Date.now() - started < RESTART_LIMIT) {
      await sleep(1000);
      try {
        const r = await fetch('/api/system/info', { cache: 'no-store' });
        const j = r.ok ? await jsonOf(r) : null;
        if (!j) throw new Error('down');
        if (j.version === target) { setPhase('done'); await sleep(1200); window.location.reload(); return; }
        const u = j.update || {};
        if (u.state === 'error') { setErr(u.error); setPhase('error'); return; }
        if (down && u.state === 'idle') { setErr(`RoninFlow restarted but is still on ${j.version}. Download the installer from GitHub and run it instead.`); setPhase('error'); return; }
        if (['downloading', 'verifying', 'installing'].includes(u.state)) setProg(u);
      } catch {
        down = true; // the installer has stopped the server: wait for it to come back
        setPhase('restarting');
      }
    }
    if (alive.current) { setErr('RoninFlow hasn’t come back yet. Open it from the Start menu, or download the installer from GitHub.'); setPhase('error'); }
  }

  const step = prog.state === 'downloading' ? `Downloading… ${Math.round((prog.progress || 0) * 100)}%`
    : prog.state === 'verifying' ? 'Checking the download…' : 'Installing…';

  return (
    <Modal open onClose={busy ? undefined : onClose} width={520}>
      <ModalHead title={auto ? `Update to RoninFlow ${target}` : `RoninFlow ${target} is available`} sub={`You have ${info.version}`} onClose={busy ? undefined : onClose} />
      <div className="modal-body col gap14" style={{ fontSize: 13.5, lineHeight: 1.55 }}>
        {phase === 'confirm' && (auto ? (
          <>
            <div>RoninFlow downloads the new version from GitHub, checks it hasn’t been tampered with, backs up your journal and installs it.
              It closes for about a minute and opens again on its own — your trades, settings and connections are kept.</div>
            <WhatsNew info={info} />
          </>
        ) : (
          <>
            <div>{{
              docker: 'This copy runs in Docker, which can’t replace itself from inside the app. On the server, in the folder with docker-compose.yml, run:',
              unix: 'RoninFlow isn’t running as a background service right now, so it can’t restart itself. In a terminal, run:',
            }[info.update?.installType] || 'This copy runs from the source code. In the RoninFlow folder, run:'}</div>
            <pre className="upd-cmd">{{
              docker: 'docker compose pull && docker compose up -d',
              unix: 'roninflow update',
            }[info.update?.installType] || 'git pull\nnpm install\nnpm run build\nnpm run autostart:restart   # or restart "npm start"'}</pre>
            <div className="muted" style={{ fontSize: 12.5 }}>Your journal and settings are kept.</div>
            <WhatsNew info={info} />
          </>
        ))}
        {(phase === 'running' || phase === 'restarting') && (
          <div className="col gap10">
            <div className="row gap8"><Loader size={15} className="spin" /> {phase === 'restarting' ? 'Installing and restarting RoninFlow…' : step}</div>
            <div className="upd-bar"><i style={{ width: `${phase === 'restarting' ? 100 : prog.state === 'downloading' ? Math.round((prog.progress || 0) * 90) : 95}%` }} /></div>
            <div className="muted" style={{ fontSize: 12.5 }}>Keep this page open — it reloads by itself when the new version is running.</div>
          </div>
        )}
        {phase === 'done' && <div className="row gap8 pos"><Check size={16} /> Updated to {target}. Reloading…</div>}
        {phase === 'error' && (
          <div className="row gap8" style={{ alignItems: 'flex-start' }}><TriangleAlert size={16} className="neg" style={{ flexShrink: 0, marginTop: 2 }} /><span>{err}</span></div>
        )}
      </div>
      <div className="modal-foot row gap8" style={{ justifyContent: 'flex-end' }}>
        {info.updateUrl && <a className="btn" href={info.updateUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> {phase === 'error' ? 'Download from GitHub' : 'What’s new'}</a>}
        {phase === 'confirm' && auto && <button className="btn primary" onClick={go}><Download size={14} /> Update now</button>}
        {(phase === 'confirm' && !auto) || phase === 'error' ? <button className="btn white" onClick={onClose}>Close</button> : null}
      </div>
    </Modal>
  );
}
