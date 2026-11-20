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
      crumbs = [{ label: 'Macro', href: '#/macro/calendar' }, { label: { cot: 'COT Report', gex: 'GEX', news: 'News Flow', heatmap: 'News Heat Map', agents: 'News Agents' }[sub] || 'Economic Calendar' }];
      view = { cot: <Cot />, gex: <Gex />, news: <NewsFlow />, heatmap: <NewsHeatmap />, agents: <NewsAgents /> }[sub] || <EconCalendar />;
      break;
    case 'connections':
      crumbs = [{ label: 'Connections' }];
      view = <Connections />;
      break;
    default:
      break;
  }
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
