import { useState } from 'react';
import { RefreshCw, MessageCircle, Sparkles, TriangleExclamationPoint as TriangleAlert } from 'lucide-react';
import { useStore, navigate } from '../store/store';
import { CoachLogo } from './Layout';
import { Markdown } from '../views/Coach';
import { buildReviewContext, askReview, localReview } from '../lib/coach';
import { PROVIDERS, providerConfig } from '../lib/ai';
import { uid, fmtDate, fmtTime12 } from '../lib/stats';

/**
 * "Coach Review" panel at the bottom of a diary day or a review page: asks the Trading Coach for a structured
 * review (summary · what went well · what needs work · action items), keeps it, and can continue as a chat.
 * kind: 'day' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'
 */
export default function CoachReview({ reviewKey, kind, label, date, period, trades, prevTrades = [], extra, noun: nounProp, intro, signature }) {
  const { state, saveCoachReview, setSetting, setChats } = useStore();
  const coach = state.settings.coach;
  const saved = state.coachReviews?.[reviewKey];
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const provider = coach.provider || 'local';
  const noun = nounProp || (kind === 'day' ? 'day' : kind.replace('ly', ''));
  const stale = saved && (saved.tradeCount !== trades.length || Math.abs((saved.net ?? 0) - trades.reduce((a, t) => a + t.pnl, 0)) > 0.005 || (signature != null && saved.signature != null && saved.signature !== signature));
  const context = () => buildReviewContext(state, { kind, label, date, period, trades, prevTrades, extra });

  const generate = async () => {
    if (coach.requestsUsed >= coach.requestsLimit) { setErr('You have used all your coach requests. Raise the limit in the Trading Coach settings.'); return; }
    setBusy(true); setErr('');
    setSetting('coach', (c) => ({ ...c, requestsUsed: c.requestsUsed + 1 }));
    const ctx = context();
    let text, used = provider;
    try {
      if (provider !== 'local') {
        text = await askReview({ provider, cfg: providerConfig(coach, provider), tone: coach.tone, name: state.user.name, context: ctx, thinking: coach.thinking || 'standard' });
        if (!text?.trim()) throw new Error('The model returned an empty answer.');
      } else {
        await new Promise((r) => setTimeout(r, 500));
        text = localReview(ctx, trades);
      }
    } catch (e) {
      setErr(`${PROVIDERS[provider]?.label || 'The AI provider'} didn't answer: ${e.message}. Showing a review built from your data instead.`);
      text = localReview(ctx, trades);
      used = 'local';
    }
    saveCoachReview(reviewKey, { text, createdAt: new Date().toISOString(), provider: used, tradeCount: trades.length, net: trades.reduce((a, t) => a + t.pnl, 0), signature });
    setBusy(false);
  };

  const chatMore = () => {
    const id = uid('chat');
    setChats((c) => [{
      id, title: `Coach review · ${label}`, createdAt: new Date().toISOString(),
      focus: context(), // follow-up questions in this chat get the same detailed data
      messages: [{ role: 'user', content: kind === 'risk' ? `Review my account condition: ${label}.` : `Give me a coach review of ${label}.` }, { role: 'assistant', content: saved.text }],
    }, ...c]);
    navigate(`coach?chat=${id}`);
  };

  return (
    <div className="panel coach-review">
      <div className="panel-head wrap">
        <div className="row" style={{ alignItems: 'center', gap: 12 }}>
          <CoachLogo size={28} icon={14} />
          <div>
            <div className="card-title">Coach Review</div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{label}</div>
          </div>
        </div>
        {saved && !busy && <button className="btn xs" onClick={generate}><RefreshCw size={12} /> Regenerate</button>}
      </div>

      {busy ? (
        <div className="row gap8 cr-busy"><div className="typing"><span /><span /><span /></div><span className="muted" style={{ fontSize: 13 }}>Reviewing your {noun}…</span></div>
      ) : saved ? (
        <>
          {stale && <div className="cr-note"><TriangleAlert size={13} /> {kind === 'risk' ? 'Your account or trades changed since this review — regenerate for an up-to-date read.' : `Your trades for this ${noun} changed since this review — regenerate to include them.`}</div>}
          <div className="cr-body"><Markdown text={saved.text} /></div>
          <div className="row between wrap gap12 cr-foot">
            <span className="muted" style={{ fontSize: 12 }}>
              {fmtDate(saved.createdAt)} {fmtTime12(saved.createdAt)} · {saved.provider === 'local' ? 'built from your data' : PROVIDERS[saved.provider]?.label || saved.provider}
            </span>
            <button className="btn white" onClick={chatMore}><MessageCircle size={14} /> Chat more with the coach</button>
          </div>
        </>
      ) : (
        <div className="cr-empty">
          <div className="muted">{intro || `Get a review of this ${noun} from your Trading Coach — what went well, what needs work, and action items for next time.`}</div>
          <button className="btn white" onClick={generate} disabled={!trades.length}><Sparkles size={14} /> Generate coach review</button>
          {provider === 'local' && <div className="muted2" style={{ fontSize: 12 }}>No AI provider is set up, so this will be a data-only review. Add one in the Trading Coach settings for a full review.</div>}
        </div>
      )}
      {err && <div className="cr-note" style={{ marginTop: 12 }}><TriangleAlert size={13} /> {err}</div>}
    </div>
  );
}
