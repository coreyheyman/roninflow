// When RoninFlow runs inside its own window over an ATAS chart (the RoninFlow Suite opens it in WebView2 with no
// Windows title bar), the page draws the window's controls itself and its top bar is where you drag the window.
// Messages go to the window through WebView2's postMessage; the window answers with its state.
import { useEffect, useState } from 'react';
import { Minus, Square, Copy, X, Pin, PinOff } from 'lucide-react';

export const HOST = typeof window !== 'undefined' ? window.__rfWindow || null : null; // { kind: 'journal' | 'trade', top }
export const hostSend = (msg) => { try { window.chrome?.webview?.postMessage(msg); } catch { /* not in a RoninFlow window */ } };

if (HOST && typeof document !== 'undefined') {
  document.documentElement.classList.add('host-win', `host-${HOST.kind}`);
  // drag the window by any [data-drag] area (a fallback for WebView2 runtimes without CSS app-region support)
  const interactive = 'button, a, input, select, textarea, label, [role="button"], [contenteditable="true"], .no-drag';
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !e.target.closest?.('[data-drag]') || e.target.closest(interactive)) return;
    if (e.detail === 2) hostSend('max'); else hostSend('drag');
  });
}

function useHostState() {
  const [st, setSt] = useState({ max: false, top: HOST?.top !== false });
  useEffect(() => {
    const wv = window.chrome?.webview;
    if (!wv) return undefined;
    const on = (e) => { try { const j = JSON.parse(e.data); if (j && typeof j === 'object') setSt((s) => ({ ...s, ...j })); } catch { /* not ours */ } };
    wv.addEventListener('message', on);
    hostSend('state');
    return () => wv.removeEventListener('message', on);
  }, []);
  return st;
}

/** pin on top · minimise · maximise · close, in RoninFlow's own style */
export function WindowControls({ compact = false }) {
  const st = useHostState();
  if (!HOST) return null;
  return (
    <div className="win-ctl no-drag">
      <button className={`win-btn ${st.top ? 'on' : ''}`} onClick={() => hostSend('top')} title={st.top ? 'Stays on top of ATAS — click to let it go behind' : 'Keep on top of ATAS'}>{st.top ? <Pin size={14} /> : <PinOff size={14} />}</button>
      {!compact && <button className="win-btn" onClick={() => hostSend('min')} title="Minimise"><Minus size={15} /></button>}
      {!compact && <button className="win-btn" onClick={() => hostSend('max')} title={st.max ? 'Restore' : 'Maximise'}>{st.max ? <Copy size={13} /> : <Square size={13} />}</button>}
      <button className="win-btn close" onClick={async () => { await window.__rfSaveNow?.(); hostSend('close'); }} title="Close"><X size={16} /></button>
    </div>
  );
}
