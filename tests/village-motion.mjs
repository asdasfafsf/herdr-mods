// Synthetic motion only; no installed app, sessions, messages or approval I/O.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

let now = 0, visible = true;
const timers = new Map(), handlers = new Map();
const saved = new Map([['overview.motionPaused', 'true']]);
const context = vm.createContext({
  Date: class extends Date { static now() { return now; } },
  localStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) },
});
const cx = { timer: { every: (ms, callback) => timers.set(ms, callback) }, notify() {} };
function builder() {
  let id;
  const element = new Proxy({}, { get: (_target, key) => {
    if (key === 'when') return (condition, fn) => condition ? fn(element) : element;
    if (key === 'id') return value => { id = value; return element; };
    if (key === 'on_click') return fn => { handlers.set(id, fn); return element; };
    return () => element;
  } });
  return element;
}
const stub = exports => new vm.SyntheticModule(Object.keys(exports), function () {
  for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
}, { context });
const modules = new Map([
  ['gpui-kit', stub({ div: builder, image: builder, svg: builder })],
  ['gpui-base', stub({ h_flex: builder, v_flex: builder, Scrollbar: {} })],
  ['herdr', stub({ props: () => ({ integrated: true }), panes: () => [], focused: () => ({}), shared: () => 'village', run() {} })],
  ['./agent-mode.js', stub({ inAgentMode: () => true, agentViewVisible: () => visible, applyModeTheme() {}, workspaceTheme: () => 'chiikawa' })],
  ['./overview-header.js', stub({ overviewHeader() {} })],
  ['./ui.js', stub({ button() {}, statusColor() {}, statusMark() {}, statusInfo() {}, statusLabel() {}, statusNotice: row => ['done', 'blocked'].includes(row.status) ? { label: row.status, text: 'Read me' } : null })],
  ['./village-chat.js', stub({ selectVillageResident() {}, renderVillageChat() {} })],
  ['./session-controls.js', stub({ renderSessionControls() {} })],
  ['./terminal-dock.js', stub({ hasTerminalDock: () => false })],
]);
async function load(name) {
  if (modules.has(name)) return modules.get(name);
  const module = new vm.SourceTextModule(readFileSync(new URL(`../mods/agents-plus/${name.slice(2)}`, import.meta.url), 'utf8'), { context });
  modules.set(name, module);
  await module.link(load);
  return module;
}
const themeModule = await load('./agent-theme.js'); await themeModule.evaluate();
const villageModule = await load('./village.js'); await villageModule.evaluate();
const { initAgentTheme, themeControls } = themeModule.namespace;
const { villageLayout, advanceVillage } = villageModule.namespace;

const view = {};
initAgentTheme(view, cx);
assert.equal(view.motionPaused, false, 'old persisted pause must not freeze a newly opened view');
const tick = elapsed => { now += elapsed; timers.get(50)(cx); };
tick(50); assert.equal(view.themeClock, 50);
visible = false; tick(1000); assert.equal(view.themeClock, 50, 'hidden presentation does not animate');
view.pointerDrag = { id: 'resident-t1', moved: true };
tick(50); assert.equal(view.pointerDrag, null, 'hiding the view releases a grabbed resident');
visible = true; tick(50); assert.equal(view.themeClock, 100, 'visible presentation resumes without jumping');
themeControls(view, {});
handlers.get('overview-motion')({}, cx);
tick(50); assert.equal(view.themeClock, 100, 'an explicit current-view pause is still respected');
handlers.get('overview-motion')({}, cx);
tick(50); assert.equal(view.themeClock, 150);
assert.equal(saved.get('overview.motionPaused'), 'true', 'the button no longer rewrites persisted pause state');

const rows = ['working', 'blocked', 'done', 'seen', 'idle'].map((status, i) => ({ id: `resident-${i}`, status }));
const state = { themeClock: 0, villageSelected: rows[0].id, villageHovered: rows[1].id };
const layout = villageLayout(1200, 740, rows.length, 2);
const initial = advanceVillage(state, rows, layout).map(({ actor }) => ({ x: actor.x, y: actor.y }));
const moved = new Set();
for (let frame = 0; frame < 240; frame++) {
  state.themeClock += 50;
  for (const [i, { row, actor }] of advanceVillage(state, rows, layout).entries()) {
    if (Math.hypot(actor.x - initial[i].x, actor.y - initial[i].y) > 4) moved.add(row.id);
    assert.ok(actor.x >= layout.left && actor.x <= layout.right);
    assert.ok(actor.y >= layout.top && actor.y <= layout.bottom);
    assert.ok(actor.wait <= 0.35, 'natural pauses remain short');
  }
}
assert.deepEqual([...moved].sort(), rows.map(row => row.id).sort(), 'selected, hovered, notice and quiet residents all move');
state.pointerDrag = { id: `resident-${rows[0].id}` };
const grabbed = { ...state.villageActors.get(rows[0].id) };
state.themeClock += 50;
advanceVillage(state, rows, layout);
assert.equal(state.villageActors.get(rows[0].id).x, grabbed.x, 'only the grabbed resident stays under the pointer');
assert.equal(state.villageActors.get(rows[0].id).y, grabbed.y);
state.pointerDrag = null;
for (let frame = 0; frame < 100; frame++) { state.themeClock += 50; advanceVillage(state, rows, layout); }
const released = state.villageActors.get(rows[0].id);
assert.ok(Math.hypot(released.x - grabbed.x, released.y - grabbed.y) > 4, 'released residents resume roaming');
const beforePause = [...state.villageActors].map(([id, actor]) => [id, actor.x, actor.y]);
advanceVillage(state, rows, layout);
assert.deepEqual([...state.villageActors].map(([id, actor]) => [id, actor.x, actor.y]), beforePause, 'a frozen clock leaves all positions still');
console.log('village motion: all visible statuses roam, short rests, view-local pause, bounds and visibility passed');
