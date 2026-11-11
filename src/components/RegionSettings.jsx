import { useState } from 'react';
import { Check } from 'lucide-react';
import { useStore } from '../store/store';
import { Modal, ModalHead, useToast } from './ui';
import { LANGS } from '../lib/i18n';
import { homeTimeZone } from '../lib/stats';

const ZONES = (() => {
  try { return Intl.supportedValuesOf('timeZone'); } catch { return ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Shanghai', 'Australia/Sydney']; }
})();

/** Language & region: interface language and the time zone trades are recorded in. */
export default function RegionSettings({ open, onClose, onCurrency }) {
  const { state, setSetting } = useStore();
  const toast = useToast();
  const [lang, setLang] = useState(state.settings.language || 'en');
  const [tz, setTz] = useState(state.settings.timeZone || 'device');
  const [was, setWas] = useState(open);
  if (was !== open) { setWas(open); if (open) { setLang(state.settings.language || 'en'); setTz(state.settings.timeZone || 'device'); } }
  if (!open) return null;
  const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const save = () => { setSetting('language', lang); setSetting('timeZone', tz); toast('Saved'); onClose(); };
  return (
    <Modal open onClose={onClose} width={560}>
      <ModalHead title="Language & region" sub="How the journal talks to you and which clock your trades are recorded in" onClose={onClose} />
      <div className="modal-body col gap16">
        <div className="field">
          <label className="label">Language</label>
          <div className="lang-grid">
            {LANGS.map((l) => (
              <button key={l.code} type="button" className={`chip ${lang === l.code ? 'on' : ''}`} onClick={() => setLang(l.code)}>{lang === l.code && <Check size={12} />}{l.label}</button>
            ))}
          </div>
          <span className="muted" style={{ fontSize: 12, marginTop: 6 }}>Menus, buttons and headings are translated. Your own notes, and some detailed text, stay as written.</span>
        </div>
        <div className="field">
          <label className="label">Your time zone</label>
          <select className="select no-i18n" value={tz} onChange={(e) => setTz(e.target.value)}>
            <option value="device">This device ({device})</option>
            {ZONES.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
          </select>
          <span className="muted" style={{ fontSize: 12, marginTop: 6 }}>Trades from live sync and broker connections are recorded in this time zone{tz === 'device' ? '' : ` (now: ${homeTimeZone()})`}. Set it if you travel or open the journal from devices in other time zones, so session days and times stay the same.</span>
        </div>
        <div className="field">
          <label className="label">Currency</label>
          <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => { onClose(); onCurrency?.(); }}>{state.settings.currency?.code || 'USD'} — change…</button>
        </div>
      </div>
      <div className="modal-foot">
        <div className="grow" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn white" onClick={save}><Check size={15} /> Save</button>
      </div>
    </Modal>
  );
}
