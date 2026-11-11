import { useEffect } from 'react';
import { useStore } from '../store/store';

// "Mask account numbers": TI80C2080926875 → TI80***6875. Names with spaces ("Apex eval 1") stay readable.
// an account number: 8+ characters, at least one digit, no spaces (e.g. TI80C2080926875, LFE050-1AB23C4D-…)
export const looksLikeNumber = (s) => { const t = String(s || ''); return t.length >= 8 && /\d/.test(t) && !/\s/.test(t); };
export const maskId = (s) => { const t = String(s ?? ''); return looksLikeNumber(t) ? `${t.slice(0, 4)}***${t.slice(-4)}` : t; };

/** label(accountOrId) → the name to show, masked when the setting is on. */
export function useAcctLabel() {
  const { state } = useStore();
  const on = !!state.settings.maskAccounts;
  return (a) => {
    const acct = typeof a === 'string' ? state.accounts.find((x) => x.id === a) : a;
    const name = acct?.name || acct?.id || (typeof a === 'string' ? a : '');
    return on ? maskId(name) : name;
  };
}

/**
 * Masks every place an account number appears on screen (tables, pickers, tooltips, chart labels…) while the
 * setting is on, by rewriting text as it renders. Typing fields and the note editor are left alone, and the
 * original text comes back as soon as the setting is turned off.
 */
export function useAccountMasking() {
  const { state } = useStore();
  const on = !!state.settings.maskAccounts;
  const key = state.accounts.map((a) => `${a.id}|${a.name || ''}`).join(',') + [...new Set(state.trades.map((t) => t.accountId))].join(',');
  useEffect(() => {
    if (!on) return undefined;
    const names = [...new Set([...state.accounts.flatMap((a) => [a.id, a.name]), ...state.trades.map((t) => t.accountId)])].filter(looksLikeNumber).sort((a, b) => b.length - a.length);
    if (!names.length) return undefined;
    const re = new RegExp(names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
    const originals = new Map(); // text node → original text
    const skip = (node) => { const el = node.parentElement; return !el || el.closest('[contenteditable="true"], textarea, input, script, style, .no-mask'); };
    const fixText = (node) => {
      const v = node.nodeValue;
      if (!v || skip(node)) return;
      re.lastIndex = 0;
      if (!re.test(v)) return;
      const out = v.replace(re, maskId);
      originals.set(node, v);
      node.nodeValue = out;
    };
    const fixTitle = (el) => { const t = el.getAttribute?.('title'); if (t) { re.lastIndex = 0; if (re.test(t)) { el.dataset.unmaskedTitle = t; el.setAttribute('title', t.replace(re, maskId)); } } };
    const walk = (root) => {
      if (root.nodeType === 3) return fixText(root);
      if (root.nodeType !== 1) return;
      fixTitle(root);
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      let n = w.nextNode();
      while (n) { if (n.nodeType === 3) fixText(n); else fixTitle(n); n = w.nextNode(); }
    };
    walk(document.body);
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'characterData') fixText(m.target);
        else if (m.type === 'attributes') fixTitle(m.target);
        else m.addedNodes.forEach(walk);
      }
    });
    mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title'] });
    return () => {
      mo.disconnect();
      for (const [node, v] of originals) if (node.isConnected && node.nodeValue === v.replace(re, maskId)) node.nodeValue = v;
      document.querySelectorAll('[data-unmasked-title]').forEach((el) => { el.setAttribute('title', el.dataset.unmaskedTitle); delete el.dataset.unmaskedTitle; });
    };
  }, [on, key]); // eslint-disable-line react-hooks/exhaustive-deps
}
