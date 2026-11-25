// The Macro section's navigation: a bar of categories across the top of every Macro page — click one for its pages
// (a category with a single page opens it straight away). Remembers the last page you opened, so Macro reopens there.
import { CalendarDays, ChartColumnStacked, Check, ChevronDown, Magnet, Newspaper, Grid3x3, BellRing, Gauge, Network, Landmark, Building2, TriangleAlert, Briefcase, Flame, Percent, Globe, Table2, ChartSpline, ListChecks, Activity } from 'lucide-react';
import { Popover } from './ui';
import { navigate } from '../store/store';
import { useSeries } from '../lib/useSeries';
import { FORCE_IDS, readRegime } from '../lib/regime';

export const MACRO_CATS = [
  { id: 'daily', label: 'Daily Check', icon: Gauge },
  { id: 'news', label: 'Calendar & News', icon: Newspaper },
  { id: 'positioning', label: 'Positioning', icon: ChartColumnStacked },
  { id: 'liquidity', label: 'Liquidity', icon: Landmark },
  { id: 'credit', label: 'Credit & Risk', icon: TriangleAlert },
  { id: 'economy', label: 'Economy', icon: Activity },
  { id: 'tools', label: 'Tools', icon: ChartSpline },
];

export const MACRO_PAGES = [
  { id: 'daily', cat: 'daily', label: 'Daily Check', desc: 'Today’s macro regime, its playbook and what would change it', icon: Gauge },
  { id: 'calendar', cat: 'news', label: 'Economic Calendar', desc: 'Releases, forecasts and actuals', icon: CalendarDays },
  { id: 'news', cat: 'news', label: 'News Flow', desc: 'Headlines sorted into stories, traced to your markets', icon: Newspaper },
  { id: 'heatmap', cat: 'news', label: 'News Heat Map', desc: 'Every macro driver for your market on one screen', icon: Grid3x3 },
  { id: 'agents', cat: 'news', label: 'News Agents', desc: 'Alerts when a headline matters to your trade', icon: BellRing },
  { id: 'cot', cat: 'positioning', label: 'COT Report', desc: 'Futures positioning from the CFTC', icon: ChartColumnStacked },
  { id: 'gex', cat: 'positioning', label: 'GEX', desc: 'Options dealer gamma, vanna and charm levels', icon: Magnet },
  { id: 'correlation', cat: 'positioning', label: 'Correlation Matrix', desc: 'How FX and index markets move together', icon: Network },
  { id: 'monetary', cat: 'liquidity', label: 'Monetary Policy', desc: 'Fed balance sheet, net liquidity, money supply and rates', icon: Landmark },
  { id: 'dealers', cat: 'liquidity', label: 'Primary Dealer Stats', desc: 'What the Treasury market makers are holding', icon: Building2 },
  { id: 'credit', cat: 'credit', label: 'Credit & Markets', desc: 'Spreads, stress gauges, bank lending, delinquencies', icon: TriangleAlert },
  { id: 'economy', cat: 'economy', label: 'Economy & Labor', desc: 'Jobs, growth, the consumer and housing', icon: Briefcase },
  { id: 'inflation', cat: 'economy', label: 'Inflation', desc: 'CPI, PCE, producer prices and expectations', icon: Flame },
  { id: 'rates', cat: 'economy', label: 'Fixed Income & Rates', desc: 'Treasury curve, real yields and breakevens', icon: Percent },
  { id: 'international', cat: 'economy', label: 'International', desc: 'Foreign 10-year yields and the dollar vs the majors', icon: Globe },
  { id: 'g10', cat: 'economy', label: 'G10 Indicators', desc: 'Unemployment, inflation and policy rates side by side', icon: Table2 },
  { id: 'compare', cat: 'tools', label: 'Comparator', desc: 'Overlay any series against any other', icon: ChartSpline },
  { id: 'watch', cat: 'tools', label: 'Watch List', desc: 'Your pinned series in one place', icon: ListChecks },
];
export const macroPage = (id) => MACRO_PAGES.find((p) => p.id === id);

const LAST = 'rf-macro-last';
export const lastMacroPage = () => { try { const v = localStorage.getItem(LAST); return macroPage(v) ? v : 'calendar'; } catch { return 'calendar'; } };
export const rememberMacroPage = (id) => { try { if (macroPage(id)) localStorage.setItem(LAST, id); } catch { /* private window */ } };

/** today's regime as a small pill (shares the Daily Check's cached series) */
function RegimeChip({ current }) {
  const { series } = useSeries(FORCE_IDS, null);
  const r = readRegime(series);
  if (!r) return null;
  const g = r.today.regime;
  return (
    <button className={`mnav-regime tone-${g.tone} ${current === 'daily' ? 'on' : ''}`} onClick={() => navigate('macro/daily')} title={`${g.summary} (${r.today.aligned}/5 forces aligned) — open Daily Check`}>
      <i />{g.name}
    </button>
  );
}

export default function MacroNav({ current }) {
  const page = macroPage(current);
  return (
    <nav className="mnav" aria-label="Macro pages">
      <div className="mnav-cats">
        {MACRO_CATS.map((c) => {
          const pages = MACRO_PAGES.filter((p) => p.cat === c.id);
          const on = page?.cat === c.id;
          if (pages.length === 1) {
            return <button key={c.id} className={`mnav-cat ${on ? 'on' : ''}`} onClick={() => navigate(`macro/${pages[0].id}`)}><c.icon size={15} />{c.label}</button>;
          }
          return (
            <Popover key={c.id} width={300} portal trigger={({ toggle, open }) => (
              <button className={`mnav-cat ${on ? 'on' : ''} ${open ? 'open' : ''}`} onClick={toggle} aria-haspopup="menu">
                <c.icon size={15} />{c.label}{on && <span className="mnav-sub">· {page.label}</span>}<ChevronDown size={14} className="mnav-chev" />
              </button>
            )}>
              {(close) => pages.map((p) => (
                <button key={p.id} className={`pop-item macro-item ${p.id === current ? 'on' : ''}`} onClick={() => { close(); navigate(`macro/${p.id}`); }}>
                  <p.icon size={16} />
                  <span className="grow"><b>{p.label}</b><small>{p.desc}</small></span>
                  {p.id === current && <Check size={14} />}
                </button>
              ))}
            </Popover>
          );
        })}
      </div>
      <RegimeChip current={current} />
    </nav>
  );
}
