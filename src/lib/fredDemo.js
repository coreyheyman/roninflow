// FRED / New York Fed series for the public demo (no server there): the real data from the demo site's snapshot when
// it has the series, otherwise seeded, mean-reverting sample walks ending at each series' demo value. Demo site only.
import { SERIES } from './fredSeries';
import { snap } from './demoSnap';

const DAY = 86400000;
const SIGNED = new Set(['T10Y2Y', 'T10Y3M', 'CFNAI', 'STLFSI4', 'NFCI', 'ANFCI', 'IRSTCI01CHM156N', 'CPALTT01CHM659N']);
// total change over the last n observations (display units)
const SHOCK = {
  BAMLH0A0HYM2: [0.54, 22], BAMLC0A0CM: [0.1, 22], BAMLH0A3HYC: [1.3, 22], VIXCLS: [8.8, 22], SP500: [-522, 22], NASDAQCOM: [-2744, 22], NASDAQ100: [-2900, 22], DJIA: [-2300, 22],
  DGS10: [-0.08, 22], DGS2: [-0.07, 22], DGS5: [-0.13, 22], DTWEXBGS: [2.3, 22], DTWEXEMEGS: [2.1, 22], DCOILWTICO: [-21, 22], DCOILBRENTEU: [-31, 22],
  CFNAI: [-0.3, 3], WTREGEN: [70, 4], WALCL: [-28, 4], PCOPPUSDM: [-0.45, 2], STLFSI4: [0.51, 4], T10Y2Y: [-0.01, 22], DEXUSEU: [-0.02, 22], DEXUSAL: [-0.025, 22],
};
// shared daily factors so related demo markets move together (equities, the dollar)
const FACTOR = {
  SP500: ['eq', 0.95], NASDAQ100: ['eq', 0.9], NASDAQCOM: ['eq', 0.92], DJIA: ['eq', 0.85], VIXCLS: ['eq', -0.7], BAMLH0A0HYM2: ['eq', -0.45],
  DTWEXBGS: ['usd', 0.9], DEXUSEU: ['usd', -0.85], DEXUSUK: ['usd', -0.75], DEXSZUS: ['usd', 0.8], DEXJPUS: ['usd', 0.55], DEXCAUS: ['usd', 0.6], DEXUSAL: ['usd', -0.72], DEXUSNZ: ['usd', -0.7],
};
const factors = {};
const factor = (name, n) => {
  if (!factors[name] || factors[name].length < n) { const r = rng(hash(name)); factors[name] = Array.from({ length: n }, () => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r())); }
  return factors[name];
};
const hash = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

function dates(freq, n, now) {
  const out = [];
  const d = new Date(now);
  if (freq === 'd') { let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - DAY; while (out.length < n) { const wd = new Date(t).getUTCDay(); if (wd && wd !== 6) out.push(iso(t)); t -= DAY; } }
  else if (freq === 'w') { let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); while (new Date(t).getUTCDay() !== 3) t -= DAY; t -= 7 * DAY; while (out.length < n) { out.push(iso(t)); t -= 7 * DAY; } }
  else { const step = freq === 'q' ? 3 : 1; let y = d.getUTCFullYear(), m = d.getUTCMonth() - (freq === 'q' ? 4 : 1); m -= ((m % step) + step) % step; while (out.length < n) { const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12; out.push(iso(Date.UTC(yy, mm, 1))); m -= step; } }
  return out.reverse();
}

function make(id, now) {
  const def = SERIES[id];
  if (!def?.demo) return [];
  const [last, freq, vol, drift = 0] = def.demo;
  const scale = def.scale || 1;
  const n = { d: 3200, w: 640, m: 160, q: 56 }[freq];
  const ds = dates(freq, n, now);
  const r = rng(hash(id));
  const gauss = () => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
  const k = { d: 0.012, w: 0.03, m: 0.06, q: 0.1 }[freq];
  const [shock = 0, sn = 1] = SHOCK[id] || [];
  const [fname, load = 0] = FACTOR[id] || [];
  const f = fname ? factor(fname, n) : null;
  const noise = (back) => (f ? load * f[back] + Math.sqrt(1 - load * load) * gauss() : gauss());
  const vals = new Array(n);
  let v = last;
  vals[n - 1] = v;
  for (let i = n - 2; i >= 0; i--) {
    const back = n - 1 - i;
    const anchor = last - drift * back - (back >= sn ? shock : (shock * back) / sn);
    v = v - drift - (back <= sn ? shock / sn : 0) + k * (anchor - v) + vol * noise(back) * (back <= sn ? 0.4 : 1);
    if (last > 0 && !SIGNED.has(id)) v = Math.max(last * 0.12, v);
    vals[i] = v;
  }
  const dp = Math.abs(last) < 10 ? 4 : 2;
  return ds.map((d, i) => [d, +(vals[i] / scale).toFixed(dp + (scale < 0.01 ? 0 : 0))]);
}

export async function demoFred(u, { real = true } = {}) {
  const ids = (u.searchParams.get('ids') || '').split(',').filter(Boolean);
  const from = u.searchParams.get('from');
  const now = Date.now();
  const series = {};
  let realCount = 0, at = null;
  const index = real ? await snap('fred/index.json') : null;
  for (const id of ids) {
    const r = index?.ids?.includes(id) ? await snap(`fred/${id}.json`) : null;
    const obs = r?.obs?.length ? r.obs : make(id, now);
    if (r?.obs?.length) { realCount++; at = Math.max(at || 0, r.at || 0); }
    let i = 0;
    if (from) { while (i < obs.length && obs[i][0] < from) i++; i = Math.max(0, i - 1); }
    series[id] = { obs: obs.slice(i), at: r?.at || now, error: null };
  }
  return { series, refreshing: false, source: realCount ? `FRED snapshot${at ? ` (${new Date(at).toISOString().slice(0, 10)})` : ''}` : 'Sample data (demo)' };
}
