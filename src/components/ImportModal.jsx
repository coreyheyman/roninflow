import { useMemo, useRef, useState } from 'react';
import { Upload, FileSpreadsheet, Settings2, TriangleExclamationPoint as TriangleAlert, Check, ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { useStore, navigate } from '../store/store';
import { Modal, ModalHead, Money, useToast } from './ui';
import { CONNECTORS } from '../lib/connectors';
import { readFile, detect, convert, MODES, fingerprint, guessInitial, detectAtasWorkbook, convertAtas, standardOffset } from '../lib/importers';
import { fmtDate, fmtTime12, fmtMoney } from '../lib/stats';

const NEW = '__new__';
const SKIP = '__skip__';
const fmtOffset = (h) => `UTC${h >= 0 ? '+' : '−'}${String(Math.floor(Math.abs(h))).padStart(2, '0')}:${Math.abs(h) % 1 ? '30' : '00'}`;
const TZ_OPTIONS = [-12, -11, -10, -9, -8, -7, -6, -5, -4, -3.5, -3, -2, -1, 0, 1, 2, 3, 3.5, 4, 5, 5.5, 6, 7, 8, 9, 9.5, 10, 11, 12, 13, 14];

const FILE_SOURCES = CONNECTORS.filter((c) => c.group === 'file');
const LIVE_SOURCES = CONNECTORS.filter((c) => c.status === 'ready' && ['live', 'api', 'crypto'].includes(c.group));

export default function ImportModal({ open, onClose, initialSource = null }) {
  const { state, importBatch, setSetting } = useStore();
  const toast = useToast();
  const fileRef = useRef(null);
  const [drag, setDrag] = useState(false);
  const [file, setFile] = useState(null);
  const [tables, setTables] = useState(null);
  const [cfg, setCfg] = useState(null); // { table, headerRow, mode, map }
  const [err, setErr] = useState('');
  const [showMap, setShowMap] = useState(false);
  const [dateOrder, setDateOrder] = useState('auto');
  const [tz, setTz] = useState('local');
  const [mults, setMults] = useState({});
  const [pnlIncl, setPnlIncl] = useState(false);
  const [acctMap, setAcctMap] = useState({});
  const [replace, setReplace] = useState(true);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState(initialSource);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) { setWasOpen(open); if (open) setSource(initialSource); }
  const src = FILE_SOURCES.find((c) => c.id === source) || null;

  const reset = () => { setFile(null); setTables(null); setCfg(null); setErr(''); setShowMap(false); setMults({}); setAcctMap({}); setTz('local'); setDateOrder('auto'); };
  const close = () => { reset(); onClose(); };

  const load = async (f) => {
    if (!f) return;
    reset();
    setBusy(true);
    try {
      const t = await readFile(f);
      if (!t.length) throw new Error('The file is empty.');
      const atas = detectAtasWorkbook(t);
      setFile(f);
      setTables(t);
      if (atas) {
        setCfg({ table: atas.journal, headerRow: 0, mode: 'atas', map: { account: 0 } });
        // ATAS writes times at the fixed UTC offset chosen in its settings (no daylight saving).
        setTz(state.settings.importTz ?? standardOffset());
      } else {
        const d = detect(t);
        setCfg({ table: d?.table ?? 0, headerRow: d?.headerRow ?? 0, mode: d?.mode ?? 'fills', map: d?.map ?? {} });
        setTz(state.settings.importTz ?? 'local');
        if (!d?.ok) setShowMap(true);
      }
    } catch (e) {
      setErr(e.message || 'Could not read this file.');
    }
    setBusy(false);
  };

  const rows = tables && cfg ? tables[cfg.table]?.rows || [] : [];
  const header = rows[cfg?.headerRow] || [];
  const result = useMemo(() => {
    if (!cfg) return null;
    try {
      if (cfg.mode === 'atas') return convertAtas(tables, { tz, multipliers: mults });
      return convert(rows, { ...cfg, dateOrder, tz, multipliers: mults, pnlIncludesFees: pnlIncl });
    } catch (e) { return { trades: [], open: [], errors: [], rowCount: 0, fatal: e.message }; }
  }, [tables, rows, cfg, dateOrder, tz, mults, pnlIncl]);
  const atasInfo = useMemo(() => (tables ? detectAtasWorkbook(tables) : null), [tables]);

  // accounts in file
  const fileAccounts = useMemo(() => {
    const g = {};
    for (const t of result?.trades || []) {
      const a = (g[t.accountRaw] ||= { raw: t.accountRaw, count: 0, net: 0, from: t.entry, to: t.entry });
      a.count++; a.net += Number.isNaN(t.pnl) ? 0 : t.pnl;
      if (t.entry < a.from) a.from = t.entry;
      if (t.entry > a.to) a.to = t.entry;
    }
    return Object.values(g);
  }, [result]);
  const noAcctCol = cfg && cfg.map.account === undefined;
  const fallbackAcct = state.settings.account !== 'all' ? state.settings.account : state.accounts[0]?.id;
  const targetOf = (raw) => acctMap[raw] ?? (state.accounts.some((a) => a.id === raw) ? raw : noAcctCol && fallbackAcct ? fallbackAcct : NEW);
  const idFor = (raw) => (targetOf(raw) === NEW ? raw : targetOf(raw));

  const unknownRoots = [...new Set((result?.trades || []).filter((t) => t.needsMultiplier).map((t) => t.symbol))];
  const ready = (result?.trades || []).filter((t) => !Number.isNaN(t.pnl));

  const plan = useMemo(() => {
    const live = fileAccounts.filter((a) => targetOf(a.raw) !== SKIP);
    const replaceRanges = replace ? live.map((a) => ({ accountId: idFor(a.raw), from: a.from.slice(0, 10), to: a.to.slice(0, 10) })) : [];
    const inRep = (t) => replaceRanges.some((r) => t.accountId === r.accountId && t.entry.slice(0, 10) >= r.from && t.entry.slice(0, 10) <= r.to);
    const incoming = ready.filter((t) => targetOf(t.accountRaw) !== SKIP).map((t) => ({ accountId: idFor(t.accountRaw), symbol: t.symbol, direction: t.direction, entry: t.entry, exit: t.exit, qty: t.qty, entryPrice: t.entryPrice, exitPrice: t.exitPrice, fees: t.fees, pnl: t.pnl, notes: t.notes || '', reviewed, source: 'import' }));
    // Multiset matching: identical trades can legitimately repeat (split fills, copied accounts),
    // so each existing trade can absorb at most one identical incoming trade.
    const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
    const incomingCount = new Map();
    incoming.forEach((t) => bump(incomingCount, fingerprint(t)));
    // Trades already in the journal that match the file are kept untouched (notes, tags, reviews survive).
    const claim = new Map(incomingCount);
    const toRemove = [];
    const existingCount = new Map();
    for (const t of state.trades) {
      const fp = fingerprint(t);
      if (inRep(t)) {
        if ((claim.get(fp) || 0) > 0) { claim.set(fp, claim.get(fp) - 1); bump(existingCount, fp); }
        else toRemove.push(t);
      } else bump(existingCount, fp);
    }
    const removeIds = toRemove.map((t) => t.id);
    const out = [];
    let dupes = 0;
    for (const trade of incoming) {
      const fp = fingerprint(trade);
      if ((existingCount.get(fp) || 0) > 0) { existingCount.set(fp, existingCount.get(fp) - 1); dupes++; continue; }
      out.push(trade);
    }
    return { trades: out, dupes, removed: toRemove.length, removeIds };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, replace, reviewed, fileAccounts, acctMap, state.trades]);

  const doImport = () => {
    const newAccounts = fileAccounts
      .filter((a) => targetOf(a.raw) === NEW && !state.accounts.some((x) => x.id === a.raw))
      .map((a) => ({ id: a.raw, name: a.raw, phase: /demo|sim/i.test(a.raw) ? 'Personal' : 'Challenge', market: 'Futures', plan: 'Classic', status: 'Active', initial: guessInitial(a.raw), profitTarget: 3000, maxDrawdown: 2000, dailyLossLimit: 1000, broker: cfg?.mode === 'atas' ? 'ATAS' : (src && src.id !== 'file-generic' ? src.name : 'Import'), autoSync: false, createdAt: a.from.slice(0, 10) }));
    const net = plan.trades.reduce((s, t) => s + t.pnl, 0);
    const used = fileAccounts.filter((a) => targetOf(a.raw) !== SKIP).length;
    setSetting('importTz', tz);
    importBatch({
      newAccounts,
      trades: plan.trades,
      removeIds: plan.removeIds,
      note: { title: `Imported ${plan.trades.length} trades from ${file.name}`, body: `${used} account${used !== 1 ? 's' : ''} · net ${fmtMoney(net, { sign: true })}` },
    });
    toast(plan.trades.length ? `Imported ${plan.trades.length} trades` : 'Journal already up to date');
    close();
    navigate(reviewed ? 'journal/database' : 'journal/inbox');
  };

  const modeLabel = cfg?.mode === 'atas' ? 'ATAS statistics workbook (Journal trades + Executions commissions)' : cfg?.mode === 'fills' ? 'Executions (fills are paired into trades)' : 'Closed trades';
  const setMap = (k, v) => setCfg((c) => ({ ...c, map: { ...c.map, [k]: v === '' ? undefined : Number(v) } }));

  return (
    <Modal open={open} onClose={close} width={920}>
      <ModalHead title="Import trades" sub={src ? `From ${src.name} — ${src.blurb}` : 'Where are these trades from?'} onClose={close} />
      {!tables && !src ? (
        <div className="modal-body col gap16">
          <div className="imp-sources">
            {FILE_SOURCES.map((c) => (
              <button key={c.id} className="imp-source" onClick={() => setSource(c.id)}>
                <span className="cx-logo">{c.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase()}</span>
                <span className="grow" style={{ textAlign: 'left' }}><b>{c.name}</b><span className="muted">{c.blurb}</span></span>
                <ChevronRight size={15} className="muted" />
              </button>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            Rather not export files? {LIVE_SOURCES.length} platforms, brokers and exchanges can send trades automatically — <a className="accent" href="#/connections" onClick={close}>set up a connection</a>.
          </div>
        </div>
      ) : !tables ? (
        <div className="modal-body col gap16">
          <div className="row between">
            <button className="btn xs" onClick={() => setSource(null)}><ChevronLeft size={13} /> Change source</button>
            <span className="muted" style={{ fontSize: 12 }}>The format is recognised automatically — you can adjust the columns afterwards.</span>
          </div>
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); load(e.dataTransfer.files?.[0]); }}
            onClick={() => fileRef.current?.click()}
            className="col center"
            style={{ alignItems: 'center', gap: 12, height: 180, border: `1px dashed ${drag ? 'var(--primary)' : 'var(--border-2)'}`, background: drag ? 'var(--pos-bg)' : 'var(--card)', cursor: 'pointer' }}
          >
            <Upload size={26} className="muted" />
            <div style={{ fontWeight: 500 }}>{busy ? 'Reading file…' : `Drop your ${src.name} export here or click to choose`}</div>
            <div className="muted" style={{ fontSize: 12.5 }}>.xlsx · .csv · .txt</div>
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.csv,.txt,.tsv" hidden onChange={(e) => { load(e.target.files?.[0]); e.target.value = ''; }} />
          {err && <div className="badge neg-soft" style={{ padding: '8px 12px' }}><TriangleAlert size={14} /> {err}</div>}
          {src.steps?.length > 0 && (
            <div className="panel" style={{ padding: '16px 20px', fontSize: 13.5, lineHeight: 1.7 }}>
              <div className="row gap8" style={{ fontWeight: 600, marginBottom: 6 }}><Info size={15} className="accent" /> Exporting from {src.name}</div>
              <ol style={{ margin: 0, paddingLeft: 18 }} className="muted">
                {src.steps.map((x, i) => <li key={i}>{x}</li>)}
              </ol>
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Every account in the file is imported, and re-importing the same period won't duplicate trades.</div>
            </div>
          )}
        </div>
      ) : (
        <div className="modal-body col gap16">
          <div className="row gap12" style={{ padding: '12px 14px', background: 'var(--card-2)', border: '1px solid var(--border-2)' }}>
            <FileSpreadsheet size={20} className="accent" />
            <div className="grow">
              <div style={{ fontWeight: 500 }}>{file.name}</div>
              <div className="muted" style={{ fontSize: 12.5 }}>
                {tables.length > 1 && <>Sheet “{tables[cfg.table].name}” · </>}{result?.rowCount || 0} rows · {modeLabel}
              </div>
            </div>
            <button className="btn xs" onClick={() => setShowMap((s) => !s)}><Settings2 size={13} /> {showMap ? 'Hide columns' : 'Columns'}</button>
            <button className="btn xs" onClick={reset}>Change file</button>
          </div>

          {showMap && (
            <div className="panel col gap12" style={{ padding: 16 }}>
              <div className="row gap12 wrap">
                <div className="field" style={{ width: 260 }}>
                  <label className="label">File type</label>
                  <select className="select" style={{ height: 34 }} value={cfg.mode} onChange={(e) => {
                    const mode = e.target.value;
                    if (mode === 'atas') { setCfg({ table: atasInfo.journal, headerRow: 0, mode, map: { account: 0 } }); return; }
                    const ti = cfg.mode === 'atas' && mode === 'fills' && atasInfo.executions >= 0 ? atasInfo.executions : cfg.table;
                    const d = detect([tables[ti]]);
                    setCfg({ table: ti, headerRow: d?.headerRow ?? 0, mode, map: d && d.mode === mode ? d.map : {} });
                  }}>
                    {atasInfo && <option value="atas">ATAS workbook (recommended)</option>}
                    {Object.entries(MODES).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                  </select>
                </div>
                {tables.length > 1 && cfg.mode !== 'atas' && (
                  <div className="field" style={{ width: 180 }}>
                    <label className="label">Sheet</label>
                    <select className="select" style={{ height: 34 }} value={cfg.table} onChange={(e) => { const ti = Number(e.target.value); const d = detect([tables[ti]]); setCfg({ table: ti, headerRow: d?.headerRow ?? 0, mode: d?.mode ?? cfg.mode, map: d?.map ?? {} }); }}>
                      {tables.map((t, i) => <option key={i} value={i}>{t.name}</option>)}
                    </select>
                  </div>
                )}
                {cfg.mode !== 'atas' && <div className="field" style={{ width: 120 }}>
                  <label className="label">Header row</label>
                  <input className="input" style={{ height: 34 }} type="number" min="1" value={cfg.headerRow + 1} onChange={(e) => setCfg((c) => ({ ...c, headerRow: Math.max(0, Number(e.target.value) - 1) }))} />
                </div>}
              </div>
              {cfg.mode === 'atas' ? (
                <div className="muted" style={{ fontSize: 13 }}>Trades and gross P&L come from the <b style={{ color: 'var(--fg)', fontWeight: 500 }}>Journal</b> sheet (identical to ATAS's Statistics). Commissions are matched from the <b style={{ color: 'var(--fg)', fontWeight: 500 }}>Executions</b> sheet fill by fill.</div>
              ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 10 }}>
                {MODES[cfg.mode].fields.map((f) => (
                  <div key={f.id} className="field">
                    <label className="label">{f.label}{f.req && <span className="neg"> *</span>}</label>
                    <select className="select" style={{ height: 32, fontSize: 13 }} value={cfg.map[f.id] ?? ''} onChange={(e) => setMap(f.id, e.target.value)}>
                      <option value="">—</option>
                      {header.map((h, i) => <option key={i} value={i}>{String(h || `Column ${i + 1}`)}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              )}
            </div>
          )}

          <div className="row gap16 wrap">
            {cfg.mode !== 'atas' && <div className="field" style={{ width: 200 }}>
              <label className="label">Date format</label>
              <select className="select" style={{ height: 34 }} value={dateOrder} onChange={(e) => setDateOrder(e.target.value)}>
                <option value="auto">Auto-detect</option><option value="MDY">Month / Day / Year</option><option value="DMY">Day / Month / Year</option>
              </select>
            </div>}
            <div className="field" style={{ width: 300 }}>
              <label className="label">Times in file are</label>
              <select className="select" style={{ height: 34 }} value={tz} onChange={(e) => setTz(e.target.value === 'local' ? 'local' : Number(e.target.value))}>
                <option value="local">My computer's local time (no change)</option>
                {TZ_OPTIONS.map((h) => <option key={h} value={h}>{fmtOffset(h)}{h === standardOffset() ? ' — your standard time' : ''}{h === 0 ? ' (UTC)' : ''}</option>)}
              </select>
            </div>
            {cfg.mode === 'atas' && (
              <div className="muted" style={{ fontSize: 12, maxWidth: 330, marginTop: 18, lineHeight: 1.45 }}>
                ATAS exports at the fixed offset set in its settings, without daylight saving. Times are converted to your local clock.
              </div>
            )}
            {cfg.mode === 'trades' && cfg.map.pnl !== undefined && cfg.map.commission !== undefined && (
              <label className="row gap8" style={{ fontSize: 13, marginTop: 20 }}>
                <input type="checkbox" className="cbx" checked={pnlIncl} onChange={(e) => setPnlIncl(e.target.checked)} /> P&L column already includes commissions
              </label>
            )}
          </div>

          {result?.fatal && <div className="badge neg-soft" style={{ padding: '8px 12px' }}><TriangleAlert size={14} /> {result.fatal}</div>}
          {result && result.trades.length === 0 && !result.fatal && (
            <div className="badge neg-soft" style={{ padding: '8px 12px', whiteSpace: 'normal' }}><TriangleAlert size={14} /> No trades could be built from this file. Open “Columns” and check that the required fields (*) point to the right columns.</div>
          )}
          {unknownRoots.length > 0 && (
            <div className="panel" style={{ padding: 14 }}>
              <div className="row gap8" style={{ marginBottom: 10, fontSize: 13.5 }}><TriangleAlert size={15} style={{ color: 'var(--warn)' }} /> Enter the $ value of one full point for these symbols so P&L can be calculated:</div>
              <div className="row gap12 wrap">
                {unknownRoots.map((r) => (
                  <label key={r} className="row gap8" style={{ fontSize: 13 }}>
                    <b style={{ fontWeight: 600 }}>{r}</b>
                    <input className="input" style={{ height: 32, width: 110 }} type="number" placeholder="$ / point" value={mults[r] ?? ''} onChange={(e) => setMults((m) => ({ ...m, [r]: e.target.value === '' ? undefined : Number(e.target.value) }))} />
                  </label>
                ))}
              </div>
            </div>
          )}

          {fileAccounts.length > 0 && (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr>{['Account in file', 'Trades', 'Net P&L (after fees)', 'Period', 'Import into'].map((h) => <th key={h} style={{ height: 40 }}>{h}</th>)}</tr></thead>
                <tbody>
                  {fileAccounts.map((a) => (
                    <tr key={a.raw} style={{ cursor: 'default', opacity: targetOf(a.raw) === SKIP ? 0.45 : 1 }}>
                      <td style={{ height: 48 }}>{a.raw}</td>
                      <td>{a.count}</td>
                      <td><Money v={a.net} colored /></td>
                      <td className="muted">{fmtDate(a.from)} – {fmtDate(a.to)}</td>
                      <td style={{ width: 280 }}>
                        <select className="select" style={{ height: 34 }} value={targetOf(a.raw)} onChange={(e) => setAcctMap((m) => ({ ...m, [a.raw]: e.target.value }))}>
                          {!state.accounts.some((x) => x.id === a.raw) && <option value={NEW}>+ New account “{a.raw}”</option>}
                          {state.accounts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                          <option value={SKIP}>Don't import</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {ready.length > 0 && (
            <div className="col gap8" style={{ fontSize: 13.5 }}>
              <label className="row gap8"><input type="checkbox" className="cbx" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
                Replace existing trades in these accounts for the same dates {plan.removed > 0 && <span className="muted">({plan.removed} trade{plan.removed > 1 ? 's' : ''} not in the file will be removed, e.g. sample data)</span>}
              </label>
              <label className="row gap8"><input type="checkbox" className="cbx" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /> Mark imported trades as reviewed (otherwise they go to your Inbox)</label>
              <div className="row gap16 muted wrap" style={{ marginTop: 4 }}>
                <span className="row gap6"><Check size={14} className="pos" /> {plan.trades.length} new trades</span>
                {plan.dupes > 0 && <span>{plan.dupes} already in your journal (skipped)</span>}
                {result.errors.length > 0 && <span>{result.errors.length} row{result.errors.length > 1 ? 's' : ''} skipped (missing data)</span>}
                {result.orphans > 0 && <span title="Journal rows with an open time but no close time — ATAS excludes these from its statistics too">{result.orphans} unclosed journal rows ignored</span>}
                {result.feeTotal > 0 && <span>Commissions matched {fmtMoney(result.feeMatched)} of {fmtMoney(result.feeTotal)}</span>}
                {result.open.length > 0 && <span style={{ color: 'var(--warn)' }}>{result.open.length} open position{result.open.length > 1 ? 's' : ''} not imported yet</span>}
              </div>
            </div>
          )}

          {ready.length > 0 && (
            <div className="tbl-wrap" style={{ maxHeight: 260 }}>
              <table className="tbl">
                <thead><tr>{['Account', 'Date', 'Entry', 'Exit', 'Pair', 'Side', 'Qty', 'Entry px', 'Exit px', 'Fees', 'Net P&L'].map((h) => <th key={h} style={{ height: 38 }}>{h}</th>)}</tr></thead>
                <tbody>
                  {[...ready].reverse().slice(0, 50).map((t, i) => (
                    <tr key={i} className={t.pnl > 0 ? 'r-win' : t.pnl < 0 ? 'r-loss' : 'r-be'} style={{ cursor: 'default' }}>
                      <td style={{ height: 40 }} className="muted truncate" title={t.accountRaw}>{t.accountRaw.length > 16 ? `…${t.accountRaw.slice(-12)}` : t.accountRaw}</td>
                      <td>{fmtDate(t.entry)}</td><td>{fmtTime12(t.entry)}</td><td>{fmtTime12(t.exit)}</td>
                      <td>{t.symbol}</td><td><span className={`dir ${t.direction}`}>{t.direction}</span></td><td>{t.qty}</td>
                      <td className="muted">{t.entryPrice}</td><td className="muted">{t.exitPrice}</td><td className="muted">{t.fees.toFixed(2)}</td><td><Money v={t.pnl} colored /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <div className="modal-foot">
        {tables ? <button className="btn" onClick={reset}><ChevronLeft size={15} /> Back</button> : <span />}
        <div className="grow" />
        <button className="btn" onClick={close}>Cancel</button>
        {tables && <button className="btn white" disabled={(!plan.trades.length && !plan.removed) || unknownRoots.some((r) => !mults[r])} onClick={doImport}>Import {plan.trades.length || ''} trades</button>}
      </div>
    </Modal>
  );
}

