// Reads the instrument (and timeframe) printed in a chart screenshot's header, for auto-captions.
import { chat, providerConfig } from './ai';

/** The header strip of a screenshot (where ATAS prints the instrument and timeframe), as a small JPEG data URL. */
async function headerStrip(file) {
  const bmp = await createImageBitmap(file);
  const h = Math.round(Math.min(110, Math.max(44, bmp.height * 0.08)));
  const scale = Math.min(1, 1600 / bmp.width);
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(h * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, bmp.width, h, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.92);
}

const SYSTEM = `You read trading chart screenshots. The image is the top strip of a chart window (ATAS or similar).
Reply with ONLY a JSON object: {"symbol": "<the instrument/contract exactly as printed, e.g. MNQZ6, ESZ6, MGC, NQ>", "timeframe": "<the chart's ACTIVE timeframe, or empty>"}.
Prefer the contract code (like MNQZ6) over a descriptive title. If you can't read an instrument, use "".
For the timeframe: use only the one written next to the instrument name or in the chart title (e.g. "MNQZ6, M1" or "MNQZ6 - 1 min"). Toolbars often show a row of timeframe buttons (M1 M5 M15 H1 …) — do NOT pick one of those unless it is clearly highlighted as selected. If you are not sure, return "".`;
const SYMBOL_ONLY = `You read trading chart screenshots. The image is the top strip of a chart window (ATAS or similar).
Reply with ONLY a JSON object: {"symbol": "<the instrument/contract exactly as printed, e.g. MNQZ6, ESZ6, MGC, NQ>"}. Prefer the contract code (like MNQZ6). If you can't read one, use "".`;

/** Caption timeframe setting: 'auto' (read from the chart), '' (instrument only) or a fixed label like "M1". */
export const CAPTION_TF = [
  { value: 'auto', label: 'Read from chart' },
  { value: 'M1', label: 'Always 1 min (M1)' },
  { value: 'M5', label: 'Always 5 min (M5)' },
  { value: '', label: 'Instrument only' },
];
const tfSetting = (coach) => (coach?.captionTf === undefined ? 'auto' : coach.captionTf);
/** Rewrite an existing caption ("MNQZ6 · M5") for a new timeframe setting; leaves free-text captions alone. */
export function retimeCaption(caption, tf) {
  const m = /^([A-Za-z0-9!/._-]{1,20})(?: · (.{1,16}))?$/.exec(String(caption || '').trim());
  if (!m || tf === 'auto') return caption;
  return tf ? `${m[1]} · ${tf}` : m[1];
}

/**
 * Caption for a chart screenshot, e.g. "MNQZ6 · M1".
 * Uses the Trading Coach's AI provider when one is set up (one tiny request); otherwise, or if that fails,
 * falls back to the instrument traded that day when there was only one. Returns '' when unsure.
 */
export async function chartCaption(file, { coach, daySymbols = [], onRequest } = {}) {
  const provider = coach?.provider || 'local';
  const fixed = tfSetting(coach);
  const withTf = (sym) => (!sym ? '' : fixed !== 'auto' && fixed ? `${sym} · ${fixed}` : sym);
  const fallback = withTf([...new Set(daySymbols)].length === 1 ? daySymbols[0] : '');
  if (provider === 'local' || (coach.requestsUsed >= coach.requestsLimit)) return fallback;
  try {
    const image = await headerStrip(file);
    onRequest?.();
    const text = await chat(provider, providerConfig(coach, provider), { system: fixed === 'auto' ? SYSTEM : SYMBOL_ONLY, question: 'Which instrument and timeframe is this chart?', image, thinking: 'off', maxTokens: 200 });
    const j = JSON.parse((text.match(/\{[\s\S]*\}/) || ['{}'])[0]);
    const sym = String(j.symbol || '').trim().replace(/\s+/g, '').slice(0, 20);
    const tf = String(j.timeframe || '').trim().slice(0, 16);
    if (!sym || !/^[A-Za-z0-9!/._-]{1,20}$/.test(sym)) return fallback;
    if (fixed !== 'auto') return withTf(sym);
    return tf ? `${sym} · ${tf}` : sym;
  } catch {
    return fallback;
  }
}
