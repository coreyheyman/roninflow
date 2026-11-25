// Loading macro series for the Macro pages (see fredSeries.js for the catalogue and the maths).
import { useMemo } from 'react';
import { useMacro } from './macro';
import { SERIES, rawIds, seriesDef, transform, derive, isoDay } from './fredSeries';

const DAY = 86400000;
const cut = (obs, from) => (from ? obs.filter((r) => r[0] >= from) : obs);

/** Load series by id (obs: everything loaded, view: just the chosen range): { series: { id: { obs, def, error } }, loading, error, refreshing, reload } */
export function useSeries(ids, from) {
  const raw = rawIds(ids);
  const fred = raw.filter((id) => SERIES[id]?.src !== 'pd' && !id.startsWith('cot:'));
  const pd = raw.filter((id) => SERIES[id]?.src === 'pd');
  // yoy and diff need history from before the range
  // at least ~13 months, so the 1-year range and year-on-year maths always have data; yoy/diff need a year more
  const needsPad = ids.some((id) => SERIES[id]?.tf || SERIES[id]?.derive?.some((x) => SERIES[x]?.tf));
  const floor = isoDay(Date.now() - (needsPad ? 800 : 400) * DAY);
  const reqFrom = from ? (needsPad ? isoDay(Math.min(Date.parse(from) - 400 * DAY, Date.parse(floor))) : (from < floor ? from : floor)) : null;
  const q = (list) => `ids=${encodeURIComponent(list.join(','))}${reqFrom ? `&from=${reqFrom}` : ''}`;
  const a = useMacro(fred.length ? `/api/macro/fred?${q(fred)}` : null);
  const b = useMacro(pd.length ? `/api/macro/fred/pd?${q(pd)}` : null);
  const series = useMemo(() => {
    const got = { ...(a.data?.series || {}), ...(b.data?.series || {}) };
    const out = {};
    for (const id of ids) {
      const def = seriesDef(id);
      if (def.derive) {
        const lists = def.derive.map((x) => transform(seriesDef(x), got[x]?.obs));
        const obs = derive(def.fn, lists);
        out[id] = { id, def, obs, view: cut(obs, from), error: def.derive.map((x) => got[x]?.error).find(Boolean) || null, pending: def.derive.some((x) => got[x]?.pending) };
      } else {
        const obs = transform(def, got[id]?.obs);
        out[id] = { id, def, obs, view: cut(obs, from), error: got[id]?.error || null, pending: !!got[id]?.pending };
      }
    }
    return out;
  }, [a.data, b.data, ids.join(','), from]); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    series,
    loading: (fred.length && a.loading && !a.data) || (pd.length && b.loading && !b.data),
    error: a.error || b.error,
    refreshing: !!(a.data?.refreshing || b.data?.refreshing),
    reload: () => { a.reload(); b.reload(); },
  };
}
