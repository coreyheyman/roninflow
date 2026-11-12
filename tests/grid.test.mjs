import test from 'node:test';
import assert from 'node:assert/strict';
import { COLS, overlaps, compact, moveItem, resizeItem, addItem, removeItem, normalize, firstFit, cellAt, spanFor, cellBox, pack } from '../src/lib/grid.js';
import { WIDGETS, DEFAULT_LAYOUT, presetLayout, layoutFor, optionOf, searchWidgets, DASHBOARDS } from '../src/lib/widgets.js';

const noOverlap = (l) => l.every((a) => l.every((b) => !overlaps(a, b)));
const at = (l, id) => { const i = l.find((x) => x.id === id); return i && [i.x, i.y, i.w, i.h]; };
const inBounds = (l) => l.every((i) => i.x >= 0 && i.x + i.w <= COLS && i.y >= 0);

test('compact floats widgets up into free space', () => {
  const l = compact([{ id: 'a', x: 0, y: 5, w: 4, h: 2 }, { id: 'b', x: 4, y: 9, w: 4, h: 2 }, { id: 'c', x: 0, y: 12, w: 8, h: 2 }]);
  assert.deepEqual(at(l, 'a'), [0, 0, 4, 2]);
  assert.deepEqual(at(l, 'b'), [4, 0, 4, 2]);
  assert.deepEqual(at(l, 'c'), [0, 2, 8, 2]);
});

test('compact separates overlapping widgets', () => {
  const l = compact([{ id: 'a', x: 0, y: 0, w: 6, h: 3 }, { id: 'b', x: 3, y: 1, w: 6, h: 3 }]);
  assert.ok(noOverlap(l));
  assert.deepEqual(at(l, 'b'), [3, 3, 6, 3]);
});

test('dropping a widget squarely on one the same size swaps them', () => {
  const l = [{ id: 'a', x: 0, y: 0, w: 4, h: 4 }, { id: 'b', x: 4, y: 0, w: 4, h: 4 }, { id: 'c', x: 8, y: 0, w: 4, h: 4 }];
  const m = moveItem(l, 'a', 8, 0);
  assert.deepEqual(at(m, 'a'), [8, 0, 4, 4]);
  assert.deepEqual(at(m, 'c'), [0, 0, 4, 4]);
  assert.deepEqual(at(m, 'b'), [4, 0, 4, 4]);
});

test('dragging a widget down past the middle of the one below puts it underneath', () => {
  const l = [{ id: 'a', x: 0, y: 0, w: 6, h: 4 }, { id: 'b', x: 0, y: 4, w: 6, h: 2 }];
  assert.deepEqual(at(moveItem(l, 'a', 0, 0), 'a'), [0, 0, 6, 4]); // not far enough: nothing changes
  const m = moveItem(l, 'a', 0, 1);
  assert.deepEqual(at(m, 'b'), [0, 0, 6, 2]);
  assert.deepEqual(at(m, 'a'), [0, 2, 6, 4]);
});

test('dragging a widget up above another', () => {
  const l = [{ id: 'a', x: 0, y: 0, w: 12, h: 4 }, { id: 'b', x: 0, y: 4, w: 12, h: 4 }];
  assert.deepEqual(at(moveItem(l, 'b', 0, 3), 'b'), [0, 4, 12, 4]); // only nudged: stays below
  const m = moveItem(l, 'b', 0, 1);
  assert.deepEqual(at(m, 'b'), [0, 0, 12, 4]);
  assert.deepEqual(at(m, 'a'), [0, 4, 12, 4]);
});

test('moving into an empty column and off the grid edges', () => {
  const l = [{ id: 'a', x: 0, y: 0, w: 4, h: 4 }, { id: 'b', x: 0, y: 4, w: 4, h: 4 }];
  const m = moveItem(l, 'b', 8, 0);
  assert.deepEqual(at(m, 'b'), [8, 0, 4, 4]);
  assert.deepEqual(at(moveItem(l, 'b', 20, -5), 'b'), [8, 0, 4, 4]); // clamped to the grid
  assert.deepEqual(at(moveItem(l, 'a', 0, 50), 'a'), [0, 4, 4, 4]); // falls to the bottom of the stack
});

test('moves never leave overlaps, wherever things are dropped', () => {
  let l = DEFAULT_LAYOUT.map((i) => ({ ...i }));
  const ids = l.map((i) => i.id);
  for (let k = 0; k < 300; k++) {
    const id = ids[(k * 7) % ids.length];
    l = moveItem(l, id, (k * 5) % 13, (k * 11) % 40);
    assert.ok(noOverlap(l), `overlap after move ${k}`);
    assert.ok(inBounds(l));
    assert.equal(l.length, ids.length);
  }
});

test('resizing pushes neighbours out of the way and respects min sizes', () => {
  const l = [{ id: 'a', x: 0, y: 0, w: 4, h: 4 }, { id: 'b', x: 4, y: 0, w: 4, h: 4 }];
  const m = resizeItem(l, 'a', 6, 4);
  assert.deepEqual(at(m, 'a'), [0, 0, 6, 4]);
  assert.deepEqual(at(m, 'b'), [4, 4, 4, 4]);
  assert.deepEqual(at(resizeItem(l, 'a', 0, 0, { minW: 2, minH: 3 }), 'a'), [0, 0, 2, 3]);
  assert.deepEqual(at(resizeItem(l, 'b', 40, 4), 'b'), [4, 0, 8, 4]); // can't grow past the right edge
});

test('adding fills the first gap; removing closes it', () => {
  const l = [{ id: 'a', x: 0, y: 0, w: 4, h: 4 }, { id: 'b', x: 8, y: 0, w: 4, h: 4 }, { id: 'c', x: 0, y: 4, w: 12, h: 2 }];
  assert.deepEqual(firstFit(l, 4, 4), { x: 4, y: 0 });
  const m = addItem(l, 'd', 4, 4);
  assert.deepEqual(at(m, 'd'), [4, 0, 4, 4]);
  assert.deepEqual(at(addItem(l, 'e', 12, 3), 'e'), [0, 6, 12, 3]);
  assert.equal(addItem(m, 'd', 4, 4).length, 4); // already there
  const r = removeItem([{ id: 'a', x: 0, y: 0, w: 12, h: 4 }, { id: 'b', x: 0, y: 4, w: 12, h: 4 }], 'a');
  assert.deepEqual(at(r, 'b'), [0, 0, 12, 4]);
});

test('saved layouts are cleaned up', () => {
  const l = normalize([
    { id: 'net', x: 10, y: 0, w: 4, h: 4 }, // sticks out of the grid
    { id: 'net', x: 0, y: 0, w: 4, h: 4 }, // duplicate
    { id: 'nope', x: 0, y: 0, w: 4, h: 4 }, // unknown widget
    { id: 'winRate', x: 'x', y: null, w: 1, h: 1, opts: { a: 1 } }, // junk values, below min size
    null,
  ], WIDGETS);
  assert.equal(l.length, 2);
  assert.deepEqual(at(l, 'net'), [8, 0, 4, 4]);
  assert.deepEqual(at(l, 'winRate'), [0, 0, 2, 3]);
  assert.deepEqual(l.find((i) => i.id === 'winRate').opts, { a: 1 });
  assert.deepEqual(normalize('garbage', WIDGETS), []);
});

test('pixel ↔ grid maths', () => {
  // 12 columns of 80px with 20px gaps; rows 40px
  assert.deepEqual(cellBox({ x: 2, y: 3, w: 4, h: 4 }, 80, 40, 20), { left: 200, top: 180, width: 380, height: 220 });
  assert.deepEqual(cellAt(210, 170, 80, 40, 20), { x: 2, y: 3 });
  assert.deepEqual(cellAt(240, 200, 80, 40, 20), { x: 2, y: 3 });
  assert.deepEqual(spanFor(380, 220, 80, 40, 20), { w: 4, h: 4 });
  assert.deepEqual(spanFor(5, 5, 80, 40, 20), { w: 1, h: 1 });
});

test('widget library', () => {
  for (const [id, w] of Object.entries(WIDGETS)) {
    assert.ok(w.name && w.desc && w.cat, id);
    assert.ok(w.w >= w.minW && w.h >= w.minH && w.w <= COLS, `${id} default size within limits`);
    for (const o of w.options || []) assert.ok(o.choices.some(([v]) => v === o.def), `${id}.${o.key} default is a choice`);
  }
  assert.ok(noOverlap(DEFAULT_LAYOUT) && inBounds(DEFAULT_LAYOUT));
  assert.deepEqual(compact(DEFAULT_LAYOUT).map((i) => at(DEFAULT_LAYOUT, i.id)), compact(DEFAULT_LAYOUT).map((i) => [i.x, i.y, i.w, i.h])); // already packed
  assert.ok(DEFAULT_LAYOUT.every((i) => WIDGETS[i.id]));
  assert.ok(['romad', 'drawdown', 'progress'].every((id) => searchWidgets('Drawdown').some((w) => w.id === id)));
  assert.ok(searchWidgets('', 'calendar').every((w) => w.cat === 'calendar'));
  assert.equal(searchWidgets('', 'all').length, Object.keys(WIDGETS).length);
  assert.equal(optionOf({ id: 'netpnl' }, 'mode'), 'area');
  assert.equal(optionOf({ id: 'netpnl', opts: { mode: 'bar' } }, 'mode'), 'bar');
});

test('dashboards start from presets, and old dashboards keep their widgets', () => {
  for (const name of DASHBOARDS) {
    const l = layoutFor({}, name);
    assert.ok(l.length > 3 && noOverlap(l) && inBounds(l), name);
  }
  assert.deepEqual(layoutFor({}, 'My Dashboard'), DEFAULT_LAYOUT);
  // someone who had hidden the calendar and the hold-time widget on the old fixed dashboard
  const old = presetLayout('My Dashboard', ['kpis', 'netpnl', 'daily', 'streaks']);
  assert.deepEqual(old.map((i) => i.id).sort(), ['daily', 'mostTraded', 'net', 'netpnl', 'perfRatio', 'profitFactor', 'romad', 'streaks', 'winRate'].sort());
  assert.ok(noOverlap(old));
  // a saved layout wins
  const saved = [{ id: 'calendar', x: 0, y: 0, w: 12, h: 16 }];
  assert.deepEqual(layoutFor({ dashLayouts: { Risk: saved } }, 'Risk'), saved);
  // packing keeps the order, left to right
  const p = pack(['net', 'winRate', 'profitFactor', 'calendar'], WIDGETS);
  assert.deepEqual(p.map((i) => [i.id, i.x, i.y]), [['net', 0, 0], ['winRate', 4, 0], ['profitFactor', 8, 0], ['calendar', 0, 4]]);
});

test('keyboard nudges always move something (or nothing, at an edge)', async () => {
  const { nudge } = await import('../src/lib/grid.js');
  const l = [{ id: 'a', x: 0, y: 0, w: 12, h: 4 }, { id: 'b', x: 0, y: 4, w: 12, h: 4 }];
  assert.deepEqual(at(nudge(l, 'b', 0, -1), 'b'), [0, 0, 12, 4]);
  assert.deepEqual(at(nudge(l, 'a', 0, 1), 'a'), [0, 4, 12, 4]);
  assert.equal(nudge(l, 'a', 0, -1), l); // already at the top
  assert.equal(nudge(l, 'a', 1, 0), l); // full width: can't go sideways
  const k = [{ id: 'a', x: 0, y: 0, w: 4, h: 4 }];
  assert.deepEqual(at(nudge(k, 'a', 1, 0), 'a'), [1, 0, 4, 4]);
});
