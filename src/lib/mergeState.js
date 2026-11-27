// Three-way merge for a journal save that another window beat to the server: your changes since the last copy you
// had (base), laid over the newer copy (remote). Pure, so it's tested on its own (tests/mergeState.test.mjs).
const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
const idOf = (x) => (x && typeof x === 'object' && x.id != null ? String(x.id) : null);
/** lists of things with ids (trades, accounts, notes …): your added, changed and deleted items laid over theirs */
function mergeList(base, local, remote) {
  if (![...base, ...local, ...remote].every(idOf)) return same(local, base) ? remote : local;
  const B = new Map(base.map((x) => [idOf(x), x])), L = new Map(local.map((x) => [idOf(x), x])), R = new Set(remote.map(idOf));
  const atas = new Set(remote.map((x) => x.atasId).filter(Boolean));
  const out = [];
  for (const r of remote) {
    const k = idOf(r), b = B.get(k), l = L.get(k);
    if (b && !l) continue;                         // you deleted it
    out.push(l && !same(l, b) ? l : r);            // you changed it → yours, else theirs
  }
  // yours that are new — unless the other window already added the same ATAS trade
  const added = local.filter((l) => !B.has(idOf(l)) && !R.has(idOf(l)) && !(l.atasId && atas.has(l.atasId)));
  return [...added, ...out];
}
export function mergeStates(base, local, remote) {
  if (!base || typeof base !== 'object' || !remote || typeof remote !== 'object') return local;
  const out = { ...remote };
  for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const b = base[k], l = local[k], r = remote[k];
    if (same(l, b)) continue; // you didn't touch it: theirs
    if (Array.isArray(l) && Array.isArray(r)) out[k] = mergeList(Array.isArray(b) ? b : [], l, r);
    else if (l && r && b && typeof l === 'object' && typeof r === 'object' && typeof b === 'object' && !Array.isArray(l)) out[k] = mergeStates(b, l, r);
    else out[k] = l;
  }
  return out;
}
