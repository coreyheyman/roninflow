import { StoreProvider, useRoute, useStore } from './store/store';
import Setup from './components/Setup';
import { ToastProvider } from './components/ui';
import { AtasSyncProvider } from './components/AtasSync';
import { ConnectSyncProvider } from './components/ConnectSync';
import Layout from './components/Layout';
import ViewerLayout from './components/ViewerLayout';
import { IS_VIEWER } from './lib/shareMode';
import Dashboard from './views/Dashboard';
import Journal from './views/Journal';
import Coach from './views/Coach';
import Diary from './views/Diary';
import Notebook from './views/Notebook';
import Review from './views/Review';
import Strategy from './views/Strategy';
import Accounts from './views/Accounts';
import Risk from './views/Risk';
import { fmtDate } from './lib/stats';
import Payouts from './views/Payouts';
import Connections from './views/Connections';
import EconCalendar from './views/EconCalendar';
import Cot from './views/Cot';
import Gex from './views/Gex';
import NewsFlow from './views/NewsFlow';
import NewsHeatmap from './views/NewsHeatmap';
import NewsAgents from './views/NewsAgents';
import Backtest from './views/Backtest';
import MacroNav, { macroPage, lastMacroPage, rememberMacroPage } from './components/MacroNav';
import DailyCheck from './views/DailyCheck';
import MacroSeries from './views/MacroSeries';
import Correlation from './views/Correlation';
import G10 from './views/G10';
import Comparator from './views/Comparator';
import Watchlist from './views/Watchlist';
import EmbedTrade from './views/EmbedTrade';
import { useEffect } from 'react';

/** The Macro section: the category bar, then the page — opening Macro without a page goes back to the last one. */
function MacroArea({ sub }) {
  const page = macroPage(sub) ? sub : lastMacroPage();
  useEffect(() => {
    rememberMacroPage(page);
    if (page !== sub) window.history.replaceState(null, '', `#/macro/${page}`);
  }, [page, sub]);
  const views = {
    daily: <DailyCheck />, calendar: <EconCalendar />, news: <NewsFlow />, heatmap: <NewsHeatmap />, agents: <NewsAgents />,
    cot: <Cot />, gex: <Gex />, correlation: <Correlation />, g10: <G10 />, compare: <Comparator />, watch: <Watchlist />,
  };
  return (
    <div className="macro-area">
      <MacroNav current={page} />
      <div key={page}>{views[page] || <MacroSeries page={page} />}</div>
    </div>
  );
}

function Router() {
  const route = useRoute();
  const { state, storage } = useStore();
  const [section, sub] = route;
  let crumbs = [{ label: 'Dashboard' }];
  let view = <Dashboard />;
  switch (section) {
    case 'journal':
      crumbs = [{ label: 'Trading Journal', href: '#/journal/database' }, { label: sub === 'inbox' ? 'Inbox' : 'Database' }];
      view = <Journal key={sub} sub={sub} />;
      break;
    case 'coach':
      crumbs = [{ label: 'Coach' }];
      view = <Coach sub={sub} />;
      break;
    case 'diary':
      crumbs = sub ? [{ label: 'Daily Diary', href: '#/diary' }, { label: fmtDate(sub) }] : [{ label: 'Daily Diary' }];
      view = <Diary key={sub || 'index'} sub={sub} />;
      break;
    case 'review': {
      const label = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' }[sub] || 'Weekly';
      crumbs = [{ label: 'Review', href: '#/review/weekly' }, { label }];
      view = <Review key={`${sub}/${route[2] || ''}`} type={sub || 'weekly'} id={route[2]} />;
      break;
    }
    case 'notebook':
      crumbs = [{ label: 'Notebook' }];
      view = <Notebook />;
      break;
    case 'strategy':
      crumbs = sub ? [{ label: 'Strategy', href: '#/strategy' }, { label: 'Details' }] : [{ label: 'Strategy' }];
      view = <Strategy key={sub || 'index'} sub={sub} />;
      break;
    case 'backtest':
      crumbs = sub === 'auto' && route[2] ? [{ label: 'Backtesting', href: '#/backtest/auto' }, { label: 'Automated' }] : sub && sub !== 'whatif' && sub !== 'auto' ? [{ label: 'Backtesting', href: '#/backtest' }, { label: 'Session' }] : [{ label: 'Backtesting' }];
      view = <Backtest key={`${sub || 'index'}/${route[2] || ''}`} sub={sub} id={route[2]} />;
      break;
    case 'risk':
      crumbs = [{ label: 'Risk Management' }];
      view = <Risk />;
      break;
    case 'accounts':
      crumbs = [{ label: 'Accounts' }];
      view = <Accounts />;
      break;
    case 'payouts':
      crumbs = [{ label: 'Payouts' }];
      view = <Payouts />;
      break;
    case 'macro':
      crumbs = [{ label: 'Macro', href: '#/macro' }, { label: macroPage(macroPage(sub) ? sub : lastMacroPage())?.label }];
      view = <MacroArea sub={sub} />;
      break;
    case 'connections':
      crumbs = [{ label: 'Connections' }];
      view = <Connections />;
      break;
    default:
      break;
  }
  // one trade's review on its own, for the RoninFlow Suite's window over an ATAS chart
  if (section === 'embed' && sub === 'trade' && !IS_VIEWER) return <EmbedTrade />;
  // a shared, view-only journal has its own frame (no editing, settings or connections)
  if (IS_VIEWER) return <ViewerLayout route={route}>{view}</ViewerLayout>;
  // first-run setup (only for a new, empty journal — waits until the server's copy has loaded)
  if (storage.mode !== 'checking' && state.settings.setupDone === false) return <Setup />;
  return (
    <Layout route={route} crumbs={crumbs}>
      {view}
    </Layout>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <ToastProvider>
        <AtasSyncProvider>
          <ConnectSyncProvider>
            <Router />
          </ConnectSyncProvider>
        </AtasSyncProvider>
      </ToastProvider>
    </StoreProvider>
  );
}
