import assert from 'node:assert/strict';
import { beginDrag, moveDrag, finishDrag, consumeDragClick, isDragging,
  clampPosition, normalizedPosition, restorePosition, reflowPosition } from '../mods/agents-plus/drag-layout.js';

const area = { left: 20, right: 380, top: 100, bottom: 500 };
const cx = { notifications: 0, stopped: 0, notify() { this.notifications++; }, stop_propagation() { this.stopped++; } };
const event = (x, y) => ({ position: { x, y }, local_position: { x: 2, y: 2 } });
const view = {}, positions = [], endings = [];
const start = () => beginDrag(view, 'resident-t1', event(100, 200), { x: 50, y: 120 }, area,
  position => positions.push(position), cx, (position, moved) => endings.push({ position, moved }));

// A normal click is retained; press jitter must not move a resident or consume it.
assert.equal(start(), true);
assert.equal(isDragging(view, 'resident-t1'), true);
assert.equal(moveDrag(view, event(101, 202), cx), false);
assert.equal(finishDrag(view, event(101, 202), cx), false);
assert.equal(consumeDragClick(view, 'resident-t1'), false);
assert.equal(positions.length, 0);
assert.equal(endings.at(-1).moved, false);

// Delta stays relative to the original grab point even after re-render changes
// element-local coordinates. Large moves clamp to the reachable field.
start();
assert.equal(moveDrag(view, event(140, 240), cx), true);
assert.deepEqual(positions.at(-1), { x: 90, y: 160 });
assert.equal(moveDrag(view, { ...event(1000, -300), local_position: { x: -40, y: -20 } }, cx), true);
assert.deepEqual(positions.at(-1), { x: 380, y: 100 });
assert.equal(finishDrag(view, null, cx), true, 'pointer leave ends and resumes motion');
assert.equal(isDragging(view), false);
assert.equal(consumeDragClick(view, 'resident-t2'), false);
assert.equal(consumeDragClick(view, 'resident-t1'), true, 'drag never opens the resident details');
assert.equal(consumeDragClick(view), false);

// A fresh click following a release-outside is not swallowed by an old guard.
start(); moveDrag(view, event(160, 260), cx); finishDrag(view, null, cx);
start(); finishDrag(view, event(100, 200), cx);
assert.equal(consumeDragClick(view, 'resident-t1'), false);

// Finish uses the release point, and dynamic bounds handle resizing while held.
let liveBounds = area;
beginDrag(view, 'panel-t1', event(100, 100), { x: 100, y: 200 }, () => liveBounds,
  position => positions.push(position), cx);
liveBounds = { left: 0, top: 0, right: 120, bottom: 220 };
finishDrag(view, event(300, 500), cx);
assert.deepEqual(positions.at(-1), { x: 120, y: 220 });
assert.equal(consumeDragClick(view), true, 'background click is suppressed too');

// Stored anchors survive both resizing and temporarily zero-sized usable areas.
const anchor = normalizedPosition({ x: 200, y: 400 }, area);
assert.deepEqual(anchor, { x: 0.5, y: 0.75 });
assert.deepEqual(restorePosition(anchor, { left: 10, top: 10, right: 110, bottom: 210 }), { x: 60, y: 160 });
assert.deepEqual(restorePosition(anchor, { left: 10, top: 10, right: 10, bottom: 10 }), { x: 10, y: 10 });
assert.deepEqual(reflowPosition({ x: 200, y: 400 }, area, { left: 10, top: 10, right: 110, bottom: 210 }), { x: 60, y: 160 });
assert.deepEqual(clampPosition({ x: Infinity, y: NaN }, area), { x: 20, y: 100 });
assert.equal(beginDrag(view, 'bad', {}, { x: 0, y: 0 }, area, () => {}, cx), false);
assert.equal(isDragging(view), false);
console.log('drag layout: click threshold, pointer deltas, bounds, leave cleanup, click suppression and resize anchors passed');
