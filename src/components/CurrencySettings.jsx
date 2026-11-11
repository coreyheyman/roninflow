import { useEffect, useState } from 'react';
import { RefreshCw, TriangleExclamationPoint as TriangleAlert, Check } from 'lucide-react';
import { useStore } from '../store/store';
import { Modal, ModalHead, Switch, useToast } from './ui';
import { CURRENCIES, fmtDate, fmtTime12 } from '../lib/stats';

/** USD → `code` exchange rate from free public APIs (no key). Returns a number or throws. */
export async function fetchRate(code) {
  if (code === 'USD') return 1;
  const sources = [
    async () => (await (await fetch('https://open.er-api.com/v6/latest/USD', { cache: 'no-store' })).json()).rates?.[code],
    async () => (await (await fetch(`https://api.frankfurter.app/latest?from=USD&to=${code}`, { cache: 'no-store' })).json()).rates?.[code],
  ];
  for (const src of sources) {
    try {
      const r = Number(await src());
      if (r > 0) return r;
    } catch { /* try the next source */ }
  }
  throw new Error('Could not reach the exchange-rate service');
}

/** Keeps the rate fresh (every 12 hours) while a converted currency is selected. */
export function useCurrencyAutoRate() {
  const { state, setSetting } = useStore();
  const c = state.settings.currency || {};
  useEffect(() => {
    if (!c.code || c.code === 'USD' || c.convert === false || c.auto === false) return;
    const age = c.updatedAt ? Date.now() - new Date(c.updatedAt).getTime() : Infinity;
    if (age < 12 * 3600 * 1000 && c.rateFor === c.code) return;
    let dead = false;
    fetchRate(c.code)
      .then((rate) => { if (!dead) setSetting('currency', (cur) => (cur.code === c.code ? { ...cur, rate, rateFor: c.code, updatedAt: new Date().toISOString() } : cur)); })
      .catch(() => {});
    return () => { dead = true; };
  }, [c.code, c.convert, c.auto, c.updatedAt, c.rateFor, setSetting]);
}

export default function CurrencySettings({ open, onClose }) {
  const { state, setSetting } = useStore();
  const toast = useToast();
  const saved = state.settings.currency || { code: 'USD', convert: true, rate: 1, auto: true };
  const [f, setF] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (open) { setF(state.settings.currency || saved); setErr(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const def = CURRENCIES.find((c) => c.code === f.code) || CURRENCIES[0];
  const isUsd = f.code === 'USD';
  const getRate = async (code = f.code) => {
    setBusy(true); setErr('');
    try {
      const rate = await fetchRate(code);
      setF((x) => ({ ...x, code, rate, rateFor: code, updatedAt: new Date().toISOString(), auto: true }));
    } catch (e) {
      setErr(`${e.message}. Enter the rate yourself below.`);
      setF((x) => ({ ...x, code, rateFor: null }));
    } finally { setBusy(false); }
  };
  const pick = (code) => {
    if (code === 'USD') return setF((x) => ({ ...x, code, rate: 1, rateFor: 'USD' }));
    setF((x) => ({ ...x, code }));
    if (f.convert !== false) getRate(code);
  };
  const rateOk = isUsd || f.convert === false || Number(f.rate) > 0;
  const sample = 1000 * (isUsd || f.convert === false ? 1 : Number(f.rate) || 0);
  const fmtIn = (v) => `${def.symbol}${v.toLocaleString('en-US', { minimumFractionDigits: def.dp ?? 2, maximumFractionDigits: def.dp ?? 2 })}`;
  const save = () => {
    setSetting('currency', { ...f, rate: isUsd ? 1 : Number(f.rate) || 1 });
    toast(`Showing values in ${def.code}`);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} width={560}>
      <ModalHead title="Display currency" sub="Choose the currency every amount on the site is shown in" onClose={onClose} />
      <div className="modal-body col gap16">
        <div className="field">
          <label className="label">Currency</label>
          <select className="input" value={f.code} onChange={(e) => pick(e.target.value)}>
            {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name} ({c.symbol.trim()})</option>)}
          </select>
        </div>

        {!isUsd && (
          <div className="panel col gap12" style={{ padding: 16 }}>
            <div className="row between">
              <div>
                <div style={{ fontWeight: 500 }}>Convert from US dollars</div>
                <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>Your trades are recorded in USD. Turn this off if your account is already in {def.code}.</div>
              </div>
              <Switch on={f.convert !== false} onChange={(v) => { setF((x) => ({ ...x, convert: v })); if (v && !(Number(f.rate) > 0 && f.rateFor === f.code)) getRate(); }} />
            </div>
            {f.convert !== false && (
              <>
                <div className="row gap8 wrap" style={{ alignItems: 'flex-end' }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label className="label">1 USD =</label>
                    <div className="row gap8">
                      <input className="input" style={{ width: 140 }} type="number" step="0.0001" min="0" value={f.rateFor === f.code || f.auto === false ? f.rate : ''} placeholder={busy ? 'Loading…' : 'Rate'} onChange={(e) => setF((x) => ({ ...x, rate: e.target.value, rateFor: x.code, auto: false, updatedAt: new Date().toISOString() }))} />
                      <span className="muted">{def.code}</span>
                    </div>
                  </div>
                  <button className="btn" onClick={() => getRate()} disabled={busy}><RefreshCw size={13} className={busy ? 'spin' : ''} /> Get live rate</button>
                </div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  {f.auto === false ? 'Manual rate — it won’t change until you update it.' : f.updatedAt && f.rateFor === f.code ? `Live rate from ${fmtDate(f.updatedAt)} ${fmtTime12(f.updatedAt)}, refreshed automatically every 12 hours.` : 'Fetching the live rate…'}
                </div>
              </>
            )}
          </div>
        )}

        {err && <div className="badge neg-soft" style={{ padding: '8px 12px', whiteSpace: 'normal' }}><TriangleAlert size={14} /> {err}</div>}

        <div className="panel row between" style={{ padding: '12px 16px' }}>
          <span className="muted">Preview</span>
          <span>$1,000.00 USD → <b style={{ fontWeight: 600 }}>{rateOk ? fmtIn(sample) : '—'}</b></span>
        </div>
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          Amounts you type in — trades, account balances, risk limits — are still entered in USD (fields are labelled “USD”).
          Ratios like profit factor, Performance Ratio and ROMAD don’t change.
        </div>
      </div>
      <div className="modal-foot">
        <div className="grow" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn white" onClick={save} disabled={!rateOk || busy}><Check size={14} /> Save</button>
      </div>
    </Modal>
  );
}
