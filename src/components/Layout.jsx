import { useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard, FileText, Bot, Book, ClipboardCheck, Target, Users, Bell, PanelLeft, Eye, EyeOff, SunMoon,
  ChevronsUpDown, Download, Upload, RefreshCw, Settings, ChevronRight, Sparkles, X, ShieldCheck, Smartphone, Menu, Coins, HandCoins, Palette, Cable,
  Languages, Globe,
} from 'lucide-react';
import { useStore, navigate } from '../store/store';
import { IS_DEMO, DOWNLOAD_URL, REPO_URL } from '../lib/demoMode';
import { Drawer, Popover, Switch, useToast, Confirm } from './ui';
import { MiniCoach } from '../views/Coach';
import { SyncPill } from './AtasSync';
import MacroPill from './MacroPill';
import { RiskMini } from './Playbook';
import NetworkAccess from './NetworkAccess';
import { useThemeStudio } from './ThemeStudio';
import { useAccountMasking } from '../lib/accountMask';
import { TEMPLATES, findTheme, themeSettings } from '../lib/themes';
import CurrencySettings, { useCurrencyAutoRate } from './CurrencySettings';
import RegionSettings from './RegionSettings';
import SettingsCenter from './SettingsCenter';
import UpdateDialog from './UpdateDialog';
import { PlaybookSettings } from './Playbook';
import { vaultKeys, VAULT } from '../lib/ai';
import { LANGS } from '../lib/i18n';
import { useReviewWatcher, useDueReviews } from '../views/Review';
import { REVIEW_TYPES } from '../lib/reviews';
import { DayPopupContext } from '../lib/dayPopup';
import { DiaryDayModal } from '../views/Diary';
import { fmtDate, fmtTime12 } from '../lib/stats';

/** On the home-server copy: whether the PC is reachable. Returns null everywhere else (the PC answers 404). */
function useReplicaStatus() {
  const [st, setSt] = useState(null);
  useEffect(() => {
    let dead = false;
    let gone = false;
    const check = async () => {
      if (gone || document.hidden) return;
      try {
        const r = await fetch('/api/replica/status', { cache: 'no-store' });
        if (r.status === 404 || r.status === 403) { gone = true; return; }
        const j = await r.json();
        if (!dead && j?.role === 'replica') setSt(j);
      } catch { /* offline for a moment */ }
    };
    check();
    const id = setInterval(check, 15000);
    return () => { dead = true; clearInterval(id); };
  }, []);
  return st;
}

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'journal', label: 'Trading Journal', icon: FileText, path: 'journal/database' },
  { id: 'coach', label: 'Trading Coach', icon: Bot },
  { id: 'diary', label: 'Daily Diary', icon: Book },
  { id: 'review', label: 'Review', icon: ClipboardCheck, path: 'review/weekly' },
  { id: 'strategy', label: 'Strategy', icon: Target },
  { id: 'macro', label: 'Macro', icon: Globe, path: 'macro/calendar' },
  { id: 'risk', label: 'Risk Management', icon: ShieldCheck },
  { id: 'accounts', label: 'Accounts', icon: Users },
  { id: 'payouts', label: 'Payouts', icon: HandCoins },
  { id: 'connections', label: 'Connections', icon: Cable },
];

/** The app's mark: three rising candles over a journal line. Follows the theme's accent colour. */
/** The brand is just the name, always in JetBrains Mono. */
export const Wordmark = ({ short = false }) => <span className="wordmark">{short ? 'RF' : 'RoninFlow'}</span>;

export const CoachLogo = ({ size = 100, icon = 44 }) => (
  <div className="coach-logo" style={{ width: size, height: size }}>
    <Sparkles size={icon} strokeWidth={1.6} />
  </div>
);

export default function Layout({ route, crumbs, children }) {
  const { update, state, storage, dismissStorageNotice, setSetting, markAllRead, markRead, clearNotifications, importState, resetAll, resetDemo } = useStore();
  const replica = useReplicaStatus();
  const [offlineHidden, setOfflineHidden] = useState(false); // dismissed until the next reload
  const [netOpen, setNetOpen] = useState(false);
  const [curOpen, setCurOpen] = useState(false);
  const [regionOpen, setRegionOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState(null);
  const [pbOpen, setPbOpen] = useState(false);
  useEffect(() => {
    const h = (e) => setSettingsTab(e.detail || 'general');
    window.addEventListener('tj:open-settings', h);
    return () => window.removeEventListener('tj:open-settings', h);
  }, []);
  // a new RoninFlow release → one notification per version (the server checks GitHub daily), with "Update now"
  const [sysInfo, setSysInfo] = useState(null);
  const [updOpen, setUpdOpen] = useState(false);
  useEffect(() => {
    if (storage.mode !== 'server') return;
    const look = () => fetch('/api/system/info').then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (j) setSysInfo(j);
      if (!j?.updateAvailable || !j.latest) return;
      const id = `upd_${j.latest}`;
      update((st) => (st.notifications.some((n) => n.id === id) ? st : {
        ...st,
        notifications: [{ id, title: `RoninFlow ${j.latest} is available`, body: `You have ${j.version}. Your journal, settings and connections are kept when you update.`, date: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19), read: false, link: j.updateUrl }, ...st.notifications],
      }));
    }).catch(() => {});
    look();
    const t = setInterval(look, 6 * 3600e3);
    const openUpd = () => { setSettingsTab(null); look(); setUpdOpen(true); }; // from Settings → Backups & updates
    window.addEventListener('tj:open-update', openUpd);
    return () => { clearInterval(t); window.removeEventListener('tj:open-update', openUpd); };
  }, [storage.mode, update]);
  // AI keys typed before the vault existed move into it (encrypted on the server, out of the journal file)
  useEffect(() => {
    if (storage.mode !== 'server') return;
    const c = state.settings.coach;
    if (!Object.values(c?.providers || {}).some((p) => p?.apiKey && p.apiKey !== VAULT)) return;
    vaultKeys(c).then((next) => { if (JSON.stringify(next) !== JSON.stringify(c)) setSetting('coach', (cur) => ({ ...cur, providers: next.providers })); });
  }, [storage.mode, state.settings.coach, setSetting]);
  const studio = useThemeStudio();
  useAccountMasking();
  // sidebar switch: flip between the last dark and last light theme you used
  const flipTheme = (dark) => update((st) => {
    const id = dark ? (st.settings.lastDark || 'ronin') : (st.settings.lastLight || 'daylight');
    const t = findTheme(st.settings, id);
    const ok = t.base === (dark ? 'dark' : 'light') ? t : TEMPLATES.find((x) => x.id === (dark ? 'ronin' : 'daylight'));
    return { ...st, settings: { ...st.settings, ...themeSettings(ok) } };
  });
  const [dayPopup, setDayPopup] = useState(null);
  useCurrencyAutoRate();
  const [notifOpen, setNotifOpen] = useState(false);
  const [miniOpen, setMiniOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const fileRef = useRef(null);
  const toast = useToast();
  const s = state.settings;
  const unread = state.notifications.filter((n) => !n.read).length;
  const inbox = state.trades.filter((t) => !t.reviewed && (s.account === 'all' || t.accountId === s.account)).length;
  const section = route[0];
  useEffect(() => { setDayPopup(null); }, [section]); // e.g. "Ask coach about this chart" from a day popup
  useReviewWatcher();
  const due = useDueReviews();
  const [mobileMenu, setMobileMenu] = useState(false);
  useEffect(() => { setMobileMenu(false); setDayPopup(null); }, [route.join('/')]);
  // a new page starts at the top, not at the depth the last one was scrolled to
  const contentRef = useRef(null);
  useEffect(() => { contentRef.current?.scrollTo(0, 0); window.scrollTo(0, 0); }, [route.join('/')]);
  const initials = state.user.name.split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase();

  const exportData = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `roninflow-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };
  const importData = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      importState(JSON.parse(await f.text()));
      toast('Backup restored');
    } catch {
      toast('That file is not a valid backup');
    }
    e.target.value = '';
  };

  return (
    <div className="app">
      {mobileMenu && <div className="overlay" style={{ zIndex: 39 }} onMouseDown={() => setMobileMenu(false)} />}
      <aside className={`sidebar ${s.sidebarCollapsed && !mobileMenu ? 'collapsed' : ''} ${mobileMenu ? 'mobile-open' : ''}`}>
        <div className="side-scroll">
        <div className="brand"><Wordmark short={s.sidebarCollapsed} /></div>
        <button className="notif-btn" onClick={() => setNotifOpen(true)} title="Notifications">
          <Bell size={19} />
          {unread > 0 && <i className="badge-dot" />}
          <span>Notifications</span>
        </button>
        <div className="menu-label">Menu</div>
        <nav className="nav">
          {NAV.filter((n) => n.id !== 'risk' || s.riskEnabled !== false).map((n) => (
            <div key={n.id}>
              <a href={`#/${n.path || n.id}`} className={`nav-item ${section === n.id ? 'active' : ''}`} title={n.label}>
                <n.icon size={20} strokeWidth={1.7} />
                <span>{n.label}</span>
                {n.id === 'review' && due.length > 0 && <span className="count-badge warn" title={`${due.length} review${due.length === 1 ? '' : 's'} due`}>{due.length}</span>}
              </a>
              {n.id === 'review' && section === 'review' && (
                <div className="nav-sub">
                  {REVIEW_TYPES.map((t) => (
                    <a key={t.id} href={`#/review/${t.id}`} className={(route[1] || 'weekly') === t.id ? 'active' : ''}>
                      {t.label} {due.some((d) => d.type === t.id) && <span className="count-badge warn">Due</span>}
                    </a>
                  ))}
                </div>
              )}
              {n.id === 'macro' && section === 'macro' && (
                <div className="nav-sub">
                  <a href="#/macro/calendar" className={route[1] !== 'cot' ? 'active' : ''}>Economic Calendar</a>
                  <a href="#/macro/cot" className={route[1] === 'cot' ? 'active' : ''}>COT Report</a>
                </div>
              )}
              {n.id === 'journal' && section === 'journal' && (
                <div className="nav-sub">
                  <a href="#/journal/database" className={route[1] !== 'inbox' ? 'active' : ''}>Database</a>
                  <a href="#/journal/inbox" className={route[1] === 'inbox' ? 'active' : ''}>
                    Inbox {inbox > 0 && <span className="count-badge">{inbox}</span>}
                  </a>
                </div>
              )}
            </div>
          ))}
        </nav>
        <div style={{ marginTop: 14 }}><RiskMini collapsed={s.sidebarCollapsed} /></div>
        </div>
        <div className="side-foot">
          <div className="theme-row">
            <span className="row gap12"><SunMoon size={20} strokeWidth={1.7} onClick={s.sidebarCollapsed ? studio.openPicker : undefined} style={s.sidebarCollapsed ? { cursor: 'pointer' } : undefined} /><span className="lbl">Theme</span></span>
            {!s.sidebarCollapsed && (
              <span className="row gap8">
                <button className="icon-btn theme-edit" title="Themes & colours" onClick={studio.openPicker}><Palette size={16} /></button>
                <Switch on={s.theme === 'dark'} onChange={flipTheme} />
              </span>
            )}
          </div>
          <Popover
            align="left"
            up
            width={230}
            trigger={({ toggle }) => (
              <div className="user-chip" onClick={toggle}>
                <div className="avatar">{initials}</div>
                <div className="grow lbl" style={{ lineHeight: 1.25 }}>
                  <div className="truncate" style={{ fontSize: 15, fontWeight: 500 }}>{state.user.name || state.user.handle}</div>
                </div>
                <ChevronsUpDown size={16} className="muted lbl" />
              </div>
            )}
          >
            {(close) => (
              <div>
                <div style={{ padding: '8px 10px' }}>
                  <div style={{ fontWeight: 500 }}>{state.user.name || state.user.handle}</div>
                </div>
                <div className="pop-sep" />
                <button className="pop-item" onClick={() => { close(); setSettingsTab('general'); }}><Settings size={15} /> Settings</button>
                <button className="pop-item" onClick={() => { close(); studio.openPicker(); }}><Palette size={15} /> Appearance</button>
                <div className="pop-item" role="switch" aria-checked={!!s.maskAccounts} onClick={() => setSetting('maskAccounts', !s.maskAccounts)} style={{ cursor: 'pointer' }}>
                  <EyeOff size={15} /> <span className="grow">Mask account numbers</span>
                  <span onClick={(e) => e.stopPropagation()}><Switch on={!!s.maskAccounts} onChange={(v) => setSetting('maskAccounts', v)} /></span>
                </div>
                <button className="pop-item" onClick={() => { close(); setRegionOpen(true); }}><Languages size={15} /> <span className="grow">Language</span> <span className="muted no-i18n" style={{ fontSize: 12 }}>{LANGS.find((l) => l.code === (s.language || 'en'))?.label}</span></button>
                <button className="pop-item" onClick={() => { close(); setCurOpen(true); }}><Coins size={15} /> <span className="grow">Currency</span> <span className="muted" style={{ fontSize: 12 }}>{s.currency?.code || 'USD'}</span></button>
                {!IS_DEMO && <button className="pop-item" onClick={() => { close(); setNetOpen(true); }}><Smartphone size={15} /> Phone & network access</button>}
                <button className="pop-item" onClick={() => { close(); navigate('coach/settings'); }}><Settings size={15} /> Coach settings</button>
                <button className="pop-item" onClick={() => { exportData(); close(); }}><Download size={15} /> Export backup (.json)</button>
                <button className="pop-item" onClick={() => { fileRef.current?.click(); close(); }}><Upload size={15} /> Restore backup</button>
                <div className="pop-sep" />
                {IS_DEMO
                  ? <button className="pop-item" onClick={() => { resetDemo(); close(); }}><RefreshCw size={15} /> Reset demo</button>
                  : <button className="pop-item danger" onClick={() => { setConfirmReset(true); close(); }}><RefreshCw size={15} /> Erase journal & start over</button>}
              </div>
            )}
          </Popover>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={importData} />
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button className="icon-btn" onClick={() => setSetting('sidebarCollapsed', (v) => !v)} title="Toggle Sidebar">
            <PanelLeft size={18} />
          </button>
          <div className="sep-v" style={{ margin: '18px 4px' }} />
          <div className="crumbs">
            {crumbs.map((c, i) => (
              <span key={i} className="row gap8">
                {i > 0 && <ChevronRight size={14} className="muted" />}
                {c.href ? <a href={c.href} className="dim">{c.label}</a> : <span className={i < crumbs.length - 1 ? 'dim' : ''}>{c.label}</span>}
              </span>
            ))}
          </div>
          <div className="grow" />
          <MacroPill />
          <SyncPill />
          <button className={`icon-btn ${s.privacy ? 'active' : ''}`} onClick={() => setSetting('privacy', (v) => !v)} title={s.privacy ? 'Show values' : 'Hide values'}>
            {s.privacy ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </header>
        {IS_DEMO && (
          <div className="storage-banner demo-b">
            <span><b>Live demo</b> · made-up trades, and anything you change stays in this browser.</span>
            <a className="demo-cta" href={DOWNLOAD_URL} target="_blank" rel="noreferrer">Get RoninFlow — free</a>
            <a href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a>
            <button onClick={resetDemo}>Reset demo</button>
          </div>
        )}
        {storage.notice === 'migrated' && (
          <div className="storage-banner pos-b">Your journal now lives in its data folder on this computer, so your phone can use it too. <button onClick={() => setNetOpen(true)}>Set up phone access</button><button onClick={dismissStorageNotice}><X size={14} /></button></div>
        )}
        {storage.notice === 'conflict' && (
          <div className="storage-banner warn-b">This journal was changed on another device at the same time — it's been refreshed with the latest version. Re-check your last edit. <button onClick={dismissStorageNotice}><X size={14} /></button></div>
        )}
        {storage.mode === 'waiting' && (
          <div className="storage-banner warn-b">Showing sample data: open the journal once on your PC so your real data moves to the server, then reload here.</div>
        )}
        {replica && !replica.pcOnline && !offlineHidden && (
          <div className="storage-banner warn-b">Your PC is offline — you're on the home-server copy. {replica.pending ? 'Your changes are saved here and will sync to the PC when it’s back.' : 'Anything you add is saved here and syncs to the PC when it’s back.'}<button onClick={() => setOfflineHidden(true)} title="Dismiss"><X size={14} /></button></div>
        )}
        {replica && replica.pcOnline && replica.pending && <div className="storage-banner pos-b">PC is back — syncing your changes…</div>}
        {storage.error && storage.mode === 'server' && <div className="storage-banner warn-b">{storage.error}</div>}
        <DayPopupContext.Provider value={setDayPopup}><div className="content" ref={contentRef}>{children}</div></DayPopupContext.Provider>
      </main>

      <nav className="mobile-nav">
        {['dashboard', 'journal', 'diary', 'risk', 'coach'].map((id) => NAV.find((x) => x.id === id)).map((n) => (
          <a key={n.id} href={`#/${n.path || n.id}`} className={section === n.id ? 'on' : ''}><n.icon size={20} strokeWidth={1.7} />{n.label.replace('Trading ', '').replace('Daily ', '').replace(' Management', '')}</a>
        ))}
        <a href="#" onClick={(e) => { e.preventDefault(); setMobileMenu(true); }}><Menu size={20} strokeWidth={1.7} />More</a>
      </nav>
      {section !== 'coach' && (
        <>
          <button className="fab coach-logo" onClick={() => setMiniOpen((o) => !o)} title="Trading Coach">
            {miniOpen ? <X size={26} /> : <Sparkles size={28} strokeWidth={1.6} />}
          </button>
          {miniOpen && <MiniCoach onClose={() => setMiniOpen(false)} />}
        </>
      )}

      <Drawer open={notifOpen} onClose={() => setNotifOpen(false)}>
        <div className="modal-head" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 16 }}>
          <div className="modal-title">Notifications</div>
          <div className="row gap8">
            <button className="btn xs" onClick={markAllRead}>Mark all read</button>
            <button className="btn xs" onClick={clearNotifications}>Clear</button>
            <button className="icon-btn" onClick={() => setNotifOpen(false)}><X size={16} /></button>
          </div>
        </div>
        <div style={{ overflow: 'auto', flex: 1 }}>
          {state.notifications.length === 0 && <div className="empty">You're all caught up.</div>}
          {state.notifications.map((n) => {
            const isUpd = !!sysInfo?.updateAvailable && n.id === `upd_${sysInfo.latest}`; // the current update: a button, not a link
            const Tag = isUpd ? 'div' : 'a';
            return (
            <Tag
              key={n.id}
              {...(isUpd ? {} : { href: n.link || '#', target: n.link?.startsWith('http') ? '_blank' : undefined, rel: 'noreferrer' })}
              onClick={() => { markRead(n.id); if (!isUpd) setNotifOpen(false); }}
              className="row gap12"
              style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', alignItems: 'flex-start', background: n.read ? undefined : 'var(--card-2)' }}
            >
              <span style={{ width: 8, height: 8, marginTop: 6, borderRadius: '50%', background: n.read ? 'transparent' : 'var(--primary)', flexShrink: 0 }} />
              <div className="grow">
                <div style={{ fontWeight: 500 }}>{n.title}</div>
                <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>{n.body}</div>
                <div className="muted2" style={{ fontSize: 12, marginTop: 6 }}>{fmtDate(n.date)} · {fmtTime12(n.date)}</div>
                {isUpd && (
                  <button className="btn xs primary notif-update" onClick={(e) => { e.stopPropagation(); markRead(n.id); setNotifOpen(false); setUpdOpen(true); }}>
                    <Download size={12} /> {sysInfo.update?.canAutoUpdate ? 'Update now' : 'How to update'}
                  </button>
                )}
              </div>
            </Tag>
            );
          })}
        </div>
      </Drawer>
      <NetworkAccess open={netOpen} onClose={() => setNetOpen(false)} />
      <CurrencySettings open={curOpen} onClose={() => setCurOpen(false)} />
      <RegionSettings open={regionOpen} onClose={() => setRegionOpen(false)} onCurrency={() => setCurOpen(true)} />
      <SettingsCenter open={!!settingsTab} tab={settingsTab || 'general'} onClose={() => setSettingsTab(null)}
        onNetwork={() => { setSettingsTab(null); setNetOpen(true); }} onCurrency={() => { setSettingsTab(null); setCurOpen(true); }} onPlaybook={() => { setSettingsTab(null); setPbOpen(true); }} />
      <PlaybookSettings open={pbOpen} onClose={() => setPbOpen(false)} />
      <UpdateDialog open={updOpen} info={sysInfo} onClose={() => setUpdOpen(false)} />
      {studio.ui}
      {dayPopup && <DiaryDayModal date={dayPopup} onClose={() => setDayPopup(null)} />}
      <Confirm
        open={confirmReset}
        title="Erase your journal?"
        body="Every trade, diary entry, review and setting is removed and the first-run setup starts again. Export a backup first if you might want any of it back."
        confirmText="Reset"
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => { resetAll(); setConfirmReset(false); toast('Journal erased — starting fresh'); }}
      />
    </div>
  );
}
