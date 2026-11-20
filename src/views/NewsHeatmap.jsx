// Macro → News Heat Map: every macro driver for one market on one screen — the stories in the news, the Fed, the data,
// rates and the dollar, linked markets — green where it helps the market, red where it hurts, and whether price has
// joined the news yet. Tap a tile for the headlines behind it.
import { useState } from 'react';
import { RefreshCw, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import MacroSwitch from '../components/MacroSwitch';
import { Modal, ModalHead } from '../components/ui';
import { useStore } from '../store/store';
import { useMacro } from '../lib/macro';
import { NEWS_MARKETS, DRIVERS } from '../lib/newsRules';
import { Chain, ago, timeOf, sideOf } from '../components/NewsBits';

const ROW1 = ['Stories', 'Rates and USD'], ROW2 = ['Data', 'Fed', 'Linked markets'];
const LAYOUT = { Stories: 'side', 'Rates and USD': 'top', Data: 'top', Fed: 'top', 'Linked markets': 'side' };
const W = (t) => (t.group === 'Stories' ? 1.2 : t.group === 'Fed' ? 1.5 : t.group === 'Data' ? 1 : 0.6) * Math.max(0.3, Math.exp(-(Date.now() - t.t) / 864e5));
const strength = (t) => Math.abs(t.v) * W(t);
const tone = (v) => (v > 0.05 ? 'up' : v < -0.05 ? 'down' : 'flat');
/** Spans on a 5-column board for the panels that have tiles (a row's panels share its width). */
function spans(row, has, sizes) {
  const list = row.filter((g) => has[g]);
  if (list.length === 1) return { [list[0]]: 5 };
  if (list.length === 2) { const [a, b] = list; const big = (has[a] >= has[b] ? a : b); return { [a]: big === a ? 3 : 2, [b]: big === b ? 3 : 2 }; }
  return Object.fromEntries(list.map((g) => [g, sizes[g]]));
}

function Tile({ t, big, market, onOpen }) {
  const m = NEWS_MARKETS[market];
  return (
    <button className={`hm-tile ${tone(t.v)} ${big ? 'big' : ''}`} style={{ '--a': `${Math.round(35 + Math.min(1, Math.abs(t.v)) * 65)}%` }} onClick={() => onOpen(t)} title={`${t.v > 0.05 ? 'Helps' : t.v < -0.05 ? 'Hurts' : 'Little effect on'} ${m?.short}`}>
      <span className="hm-age">{ago(t.t)}</span>
      <span className="hm-txt">
        <b>{t.title}</b>
        {t.sub && <small>{t.sub}</small>}
      </span>
    </button>
  );
}

function Panel({ group, tiles, span, market, onOpen, layout }) {
  const list = [...tiles].sort((a, b) => strength(b) - strength(a));
  const net = list.reduce((a, t) => a + t.v * W(t), 0);
  const [first, ...rest] = list;
  const more = rest.slice(0, layout === 'side' ? 3 : 3);
  const lay = span === 1 ? 'top' : layout;
  return (
    <div className={`hm-panel ${lay}`} style={{ gridColumn: `span ${span}` }}>
      <div className={`hm-ph ${tone(net)}`}>{group}</div>
      <div className="hm-pbody">
        <Tile t={first} big market={market} onOpen={onOpen} />
        {more.length > 0 && <div className="hm-rest">{more.map((t, i) => <Tile key={i} t={t} market={market} onOpen={onOpen} />)}</div>}
      </div>
    </div>
  );
}

export default function NewsHeatmap() {
  const { state, setSetting } = useStore();
  const s = state.settings;
  const [open, setOpen] = useState(null);
  const pick = s.newsMarket || '';
  const { data, error, loading, reload } = useMacro(`/api/macro/news/heatmap?market=${pick}`, { poll: 60e3 });
  const market = data?.market || pick || 'ES';
  const m = NEWS_MARKETS[market];
  const tiles = data?.tiles || [];
  const bias = data?.bias || 0;
  const verdict = bias > 0.12 ? 'helps' : bias < -0.12 ? 'hurts' : 'mixed';

  return (
    <div className="page hm-page">
      <div className="row gap12 wrap" style={{ alignItems: 'flex-end', marginBottom: 14 }}>
        <div className="grow">
          <MacroSwitch current="heatmap" />
          <div className="muted" style={{ fontSize: 13.5 }}>Every macro driver on one screen, so you see the mood flip the moment news hits.</div>
        </div>
      </div>
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <div className="row gap6 wrap">{(data?.markets || []).map((k) => <button key={k} className={`chip ${market === k ? 'on' : ''}`} onClick={() => setSetting('newsMarket', k)}>{k} <span className="muted">{NEWS_MARKETS[k]?.short}</span></button>)}</div>
        <div className="grow" />
        <button className="icon-btn" onClick={() => reload(true)} title="Refresh"><RefreshCw size={16} className={loading ? 'spin' : ''} /></button>
      </div>
      {error && <div className="ec-warn">{error}</div>}
      {loading && !data ? <div className="ec-empty">Loading…</div> : !data ? null : (
        <>
          <div className="hm-card">
            <div className="hm-risks">
              <div className="hm-risks-h">Active risks{tiles.length ? <span className="muted"> · {ago(Math.max(...tiles.map((t) => t.t)))}</span> : null}</div>
              <div className="hm-risks-t">{tiles.length ? [...tiles].filter((t) => Math.abs(t.v) > 0.05).sort((x, y) => strength(y) - strength(x)).slice(0, 2).map((t) => { const what = (t.sub || '').split(' · ')[0]; return `${t.group === 'Stories' && what && !/^in the news/.test(what) ? `${t.title} — ${what.toLowerCase()} —` : t.group === 'Stories' || t.group === 'Fed' || t.group === 'Data' ? t.title : `${t.title}: ${what.toLowerCase()} —`} ${t.v > 0 ? 'helps' : 'hurts'} ${m.short}.`; }).join(' ') || `Nothing is pushing ${m.short} much right now.` : `Nothing in the news for ${m.short} yet today.`}</div>
            </div>
            <div className={`hm-verdict ${verdict}`}>
              <span className="hm-v">{verdict === 'helps' ? '▲' : verdict === 'hurts' ? '▼' : '•'} News {verdict === 'mixed' ? 'is mixed for' : verdict} {m?.short}</span>
              <span className="hm-bar" title={`Score ${bias.toFixed(2)} (−1 hurts … +1 helps)`}><i className="hm-mid" /><i className="hm-mark" style={{ left: `${((Math.max(-1, Math.min(1, bias)) + 1) / 2) * 100}%` }} /></span>
            </div>
            <div className="hm-sec">News</div>
            {(() => {
              const has = Object.fromEntries([...ROW1, ...ROW2].map((g) => [g, tiles.filter((t) => t.group === g).length]));
              const sp = { ...spans(ROW1, has, { Stories: 3, 'Rates and USD': 2 }), ...spans(ROW2, has, { Data: 2, Fed: 1, 'Linked markets': 2 }) };
              return (
                <div className="hm-board">
                  {[...ROW1, ...ROW2].filter((g) => has[g]).map((g) => <Panel key={g} group={g} tiles={tiles.filter((t) => t.group === g)} span={sp[g]} market={market} onOpen={setOpen} layout={LAYOUT[g]} />)}
                </div>
              );
            })()}
            {data.trend && (
              <>
                <div className="hm-sec">Price</div>
                <div className="hm-panel price">
                  <div className={`hm-ph ${verdict === 'mixed' ? 'flat' : data.agree >= 2 ? (verdict === 'helps' ? 'up' : 'down') : 'flat'}`}>Trend <span className="muted">· {verdict === 'mixed' ? 'no clear news side' : `${data.agree} of 3 agree with the news${data.agree === 0 ? ' — price hasn’t joined it yet' : data.agree === 3 ? ' — price is with it' : ''}`}</span></div>
                  <div className="hm-trendrow">
                    {data.trend.slice().reverse().map((t) => (
                      <div key={t.tf} className={`hm-tile ${t.dir > 0 ? 'up' : t.dir < 0 ? 'down' : 'flat'}`} style={{ '--a': '70%' }}>
                        <span className="hm-age">{t.tf}</span>
                        <span className="hm-txt"><b>{t.dir > 0 ? <TrendingUp size={16} /> : t.dir < 0 ? <TrendingDown size={16} /> : <Minus size={16} />} {t.dir > 0 ? 'Up' : t.dir < 0 ? 'Down' : 'Flat'}</b><small>{t.tf === '4h' ? 'A bigger move — it takes more to flip' : t.tf === '1h' ? 'The last few hours' : 'The last half hour'}</small></span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
      {open && (
        <Modal open onClose={() => setOpen(null)} width={600}>
          <ModalHead title={open.title} sub={`${open.group} · ${ago(open.t)} · ${open.v > 0.05 ? `helps ${m.short}` : open.v < -0.05 ? `hurts ${m.short}` : 'little effect'}`} onClose={() => setOpen(null)} />
          <div className="hm-detail">
            {open.sub && <div className="muted" style={{ marginBottom: 10 }}>{open.sub}</div>}
            {(open.ids || []).map((id) => data.items?.[id]).filter(Boolean).map((x) => (
              <div key={x.id} className="hm-line">
                <div className="row gap8"><span className="nw-t">{timeOf(x.t)}</span><span className="grow">{x.title}</span>{x.driver && <span className={`nw-tone ${sideOf(x, market)}`}>{DRIVERS[x.driver].label}</span>}</div>
                {x.driver && <Chain driver={x.driver} market={market} />}
              </div>
            ))}
            {!open.ids?.length && <div className="muted" style={{ fontSize: 13 }}>From the market’s own prices (Yahoo’s free quotes).</div>}
          </div>
        </Modal>
      )}
    </div>
  );
}
