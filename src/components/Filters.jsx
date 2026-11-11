import { Funnel } from 'lucide-react';
import { useStore } from '../store/store';
import { Popover } from './ui';

export const EMPTY_FILTERS = { symbol: '', direction: '', result: '', tag: '', strategy: '' };

export function applyFilters(trades, f) {
  return trades.filter((t) =>
    (!f.symbol || t.symbol === f.symbol) &&
    (!f.direction || t.direction === f.direction) &&
    (!f.result || (f.result === 'win' ? t.pnl > 0 : f.result === 'loss' ? t.pnl < 0 : t.pnl === 0)) &&
    (!f.tag || (t.tags || []).includes(f.tag)) &&
    (!f.strategy || (f.strategy === 'none' ? !t.strategyId : t.strategyId === f.strategy)),
  );
}

export function FilterButton({ value, onChange, trades }) {
  const { state } = useStore();
  const active = Object.values(value).filter(Boolean).length;
  const symbols = [...new Set(trades.map((t) => t.symbol))].sort();
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  return (
    <Popover
      align="right"
      width={300}
      trigger={({ toggle }) => (
        <button className="btn" onClick={toggle}>
          <Funnel size={15} fill="currentColor" /> Filters
          {active > 0 && <span className="badge pos" style={{ padding: '1px 6px' }}>{active}</span>}
        </button>
      )}
    >
      <div className="col gap12" style={{ padding: 10 }}>
        {[
          ['symbol', 'Symbol', symbols.map((s) => [s, s])],
          ['direction', 'Direction', [['Long', 'Long'], ['Short', 'Short']]],
          ['result', 'Result', [['win', 'Winners'], ['loss', 'Losers'], ['be', 'Break even']]],
          ['tag', 'Tag', state.tags.map((t) => [t, t])],
          ['strategy', 'Strategy', [['none', 'No strategy'], ...state.strategies.map((s) => [s.id, s.name])]],
        ].map(([k, label, opts]) => (
          <div key={k} className="field">
            <label className="label">{label}</label>
            <select className="select" style={{ height: 34 }} value={value[k]} onChange={set(k)}>
              <option value="">All</option>
              {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        ))}
        <button className="btn sm" onClick={() => onChange(EMPTY_FILTERS)} disabled={!active}>Clear filters</button>
      </div>
    </Popover>
  );
}
