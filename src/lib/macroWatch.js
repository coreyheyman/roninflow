// Macro → Watch List: named lists of pinned series, kept with your settings (so they follow you to every device),
// plus the series the Comparator opens with.
import { useStore, navigate } from '../store/store';

export const DEFAULT_WATCH = { lists: [{ id: 'main', name: 'My Watchlist', ids: ['DGS10', 'T10Y2Y', 'SP500', 'VIXCLS', 'WALCL', 'BAMLH0A0HYM2'] }], active: 'main' };

export function useWatch() {
  const { state, setSetting } = useStore();
  const w = state.settings.macroWatch?.lists?.length ? state.settings.macroWatch : DEFAULT_WATCH;
  const list = w.lists.find((l) => l.id === w.active) || w.lists[0];
  const save = (fn) => setSetting('macroWatch', (cur) => fn(cur?.lists?.length ? cur : DEFAULT_WATCH));
  const editList = (id, fn) => save((c) => ({ ...c, lists: c.lists.map((l) => (l.id === id ? fn(l) : l)) }));
  return {
    lists: w.lists, list,
    has: (id) => list.ids.includes(id),
    toggle: (id) => editList(list.id, (l) => ({ ...l, ids: l.ids.includes(id) ? l.ids.filter((x) => x !== id) : [...l.ids, id] })),
    add: (id) => editList(list.id, (l) => (l.ids.includes(id) ? l : { ...l, ids: [...l.ids, id] })),
    remove: (id) => editList(list.id, (l) => ({ ...l, ids: l.ids.filter((x) => x !== id) })),
    move: (id, dir) => editList(list.id, (l) => { const i = l.ids.indexOf(id), j = i + dir; if (i < 0 || j < 0 || j >= l.ids.length) return l; const ids = [...l.ids]; [ids[i], ids[j]] = [ids[j], ids[i]]; return { ...l, ids }; }),
    select: (id) => save((c) => ({ ...c, active: id })),
    create: (name) => { const id = `l${Date.now().toString(36)}`; save((c) => ({ lists: [...c.lists, { id, name: name || 'New list', ids: [] }], active: id })); },
    rename: (id, name) => editList(id, (l) => ({ ...l, name })),
    drop: (id) => save((c) => { const lists = c.lists.filter((l) => l.id !== id); return lists.length ? { lists, active: lists[0].id } : DEFAULT_WATCH; }),
  };
}

/** open the Comparator with these series */
export function useOpenCompare() {
  const { setSetting } = useStore();
  return (ids) => { setSetting('macroCompare', (c) => ({ ...(c || {}), ids: [...new Set(ids)].slice(0, 8) })); navigate('macro/compare'); };
}
