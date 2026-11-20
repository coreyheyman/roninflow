// The Macro page's title doubles as a menu for switching between its pages.
import { CalendarDays, ChartColumnStacked, Check, ChevronDown, Magnet, Newspaper, Grid3x3, BellRing } from 'lucide-react';
import { Popover } from './ui';
import { navigate } from '../store/store';

export const MACRO_PAGES = [
  { id: 'calendar', label: 'Economic Calendar', desc: 'Releases, forecasts and actuals', icon: CalendarDays },
  { id: 'news', label: 'News Flow', desc: 'Headlines sorted into stories, traced to your markets', icon: Newspaper },
  { id: 'heatmap', label: 'News Heat Map', desc: 'Every macro driver for your market on one screen', icon: Grid3x3 },
  { id: 'agents', label: 'News Agents', desc: 'Alerts when a headline matters to your trade', icon: BellRing },
  { id: 'cot', label: 'COT Report', desc: 'Futures positioning from the CFTC', icon: ChartColumnStacked },
  { id: 'gex', label: 'GEX', desc: 'Options dealer gamma, vanna and charm levels', icon: Magnet },
];

export default function MacroSwitch({ current }) {
  const page = MACRO_PAGES.find((p) => p.id === current) || MACRO_PAGES[0];
  return (
    <Popover
      width={280}
      trigger={({ toggle, open }) => (
        <button className={`page-title macro-switch ${open ? 'on' : ''}`} onClick={toggle} aria-haspopup="menu" title="Switch Macro page">
          {page.label} <ChevronDown size={20} className="muted" />
        </button>
      )}
    >
      {(close) => MACRO_PAGES.map((p) => (
        <button key={p.id} className={`pop-item macro-item ${p.id === page.id ? 'on' : ''}`} onClick={() => { close(); navigate(`macro/${p.id}`); }}>
          <p.icon size={16} />
          <span className="grow"><b>{p.label}</b><small>{p.desc}</small></span>
          {p.id === page.id && <Check size={14} />}
        </button>
      ))}
    </Popover>
  );
}
