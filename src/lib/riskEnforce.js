// Risk enforcement in ATAS: each account's rules, worked out from its risk tier and Settings → Risk enforcement, and
// sent to the journal server (risk-enforce.js) for the Journal Sync add-on to apply.
import { useEffect, useRef, useState } from 'react';
import { riskState, riskOf } from './playbook';
import { balanceGap } from './balance';
import { homeTimeZone } from './stats';

export const WEEKDAYS = [1, 2, 3, 4, 5];
export const DEFAULT_ENFORCE = { on: false, setAtas: true, dll: null, trail: null, windows: [], days: WEEKDAYS, flatten: true, maxTrades: null, maxConsec: null, consecMin: null, maxContracts: null };

/** An account's enforcement settings, with defaults filled in. */
export const enforceOf = (state, id) => ({ ...DEFAULT_ENFORCE, ...(state.settings.riskEnforce?.[id] || {}) });

const pos = (v) => (Number(v) > 0 ? Number(v) : null);
const posInt = (v) => (Number(v) >= 1 ? Math.floor(Number(v)) : null);

/** Where an account stands in its risk plan right now. */
export function tierOf(state, id) {
  const account = state.accounts.find((a) => a.id === id);
  if (!account) return null;
  const trades = state.trades.filter((t) => t.accountId === id);
  return riskState(trades, { ...account, balanceGap: balanceGap(state, id) }, riskOf(state, id));
}

/** The rules the add-on applies for one account (null when enforcement is off for it). */
export function rulesFor(state, id) {
  const cfg = enforceOf(state, id);
  if (!cfg.on) return null;
  const r = tierOf(state, id);
  if (!r) return null;
  const tierDll = Number(r.tier.dailyLL) || 0;
  const dailyLoss = pos(cfg.dll) ?? tierDll;
  return {
    account: id,
    on: true,
    setAtas: cfg.setAtas !== false,
    tier: { name: r.tier.name, level: r.level, of: r.tiers.length, color: r.tier.color || '', dailyLL: tierDll, riskMin: Number(r.tier.riskMin) || 0, riskMax: Number(r.tier.riskMax) || 0 },
    dailyLoss,
    trail: pos(cfg.trail) ?? dailyLoss, // follows the daily loss limit unless you set your own
    windows: (cfg.windows || []).filter((w) => w?.from && w?.to),
    days: Array.isArray(cfg.days) ? cfg.days : WEEKDAYS,
    flatten: !!cfg.flatten,
    maxTrades: posInt(cfg.maxTrades),
    maxConsec: posInt(cfg.maxConsec),
    consecMin: pos(cfg.consecMin) ?? 0,
    maxContracts: posInt(cfg.maxContracts),
  };
}

export function allRules(state) {
  return state.accounts.map((a) => rulesFor(state, a.id)).filter(Boolean);
}

/** Every account's tier and loss limits, for the RoninFlow HUD on ATAS charts (enforced or not). */
export function allTiers(state) {
  const out = {};
  for (const a of state.accounts) {
    try {
      const r = tierOf(state, a.id);
      if (!r) continue;
      const cfg = enforceOf(state, a.id);
      const dll = pos(cfg.dll) ?? (Number(r.tier.dailyLL) || 0);
      out[a.id] = { name: r.tier.name, level: r.level, of: r.tiers.length, color: r.tier.color || '', dailyLoss: dll, trail: pos(cfg.trail) ?? dll, riskMin: Number(r.tier.riskMin) || 0, riskMax: Number(r.tier.riskMax) || 0, enforced: !!cfg.on, maxTrades: posInt(cfg.maxTrades) };
    } catch { /* an account without trades yet */ }
  }
  return out;
}

/** Keeps the journal server's copy of the rules up to date while the app is open (tiers move as days close). */
export function useRiskEnforceSync(state, enabled) {
  const last = useRef('');
  const at = useRef(0);
  const [tick, setTick] = useState(0);
  useEffect(() => { if (!enabled) return undefined; const iv = setInterval(() => setTick((n) => n + 1), 60e3); return () => clearInterval(iv); }, [enabled]); // a new day moves tiers
  const json = enabled ? JSON.stringify({ tz: homeTimeZone(), accounts: allRules(state), tiers: allTiers(state) }) : '';
  useEffect(() => {
    if (!enabled) return undefined;
    const send = (force) => {
      if (!force && json === last.current) return;
      fetch('/api/atas/risk/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json })
        .then((r) => { if (r.ok) { last.current = json; at.current = Date.now(); } })
        .catch(() => {});
    };
    const t = setTimeout(() => send(false), 800);
    if (Date.now() - at.current > 5 * 60e3) send(true); // now and then anyway: the server may have restarted
    return () => clearTimeout(t);
  }, [json, enabled, tick]);
}
