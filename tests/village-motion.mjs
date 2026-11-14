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
const drawn = [];
function builder(kind = 'div', path) {
  let id;
  const node = { kind, path, styles: {} }; drawn.push(node);
  const element = new Proxy({}, { get: (_target, key) => {
    if (key === 'when') return (condition, fn) => condition ? fn(element) : element;
    if (key === 'id') return value => { id = value; node.id = value; return element; };
    if (key === 'on_click') return fn => { handlers.set(id, fn); return element; };
    if (['w', 'h', 'left', 'right', 'top', 'bottom'].includes(key)) return value => { node.styles[key] = value; return element; };
    return () => element;
  } });
  return element;
}
const stub = exports => new vm.SyntheticModule(Object.keys(exports), function () {
  for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
}, { context });
const modules = new Map([
  ['gpui-kit', stub({ div: builder, image: path => builder('image', path), svg: path => builder('svg', path) })],
  ['gpui-base', stub({ h_flex: builder, v_flex: builder, Scrollbar: {} })],
  ['herdr', stub({ props: () => ({ integrated: true }), panes: () => [], focused: () => ({}), shared: () => 'village', setShared() {}, run() {} })],
  ['./agent-mode.js', stub({ inAgentMode: () => true, agentViewVisible: () => visible, applyModeTheme() {}, workspaceTheme: () => 'chiikawa' })],
  ['./overview-header.js', stub({ overviewHeader() {} })],
  ['./ui.js', stub({ button() {}, statusColor() {}, statusMark() {}, statusInfo() {}, statusLabel() {}, statusNotice: row => ['done', 'blocked'].includes(row.status) ? { label: row.status, text: 'Read me' } : null })],
  ['./village-chat.js', stub({ selectVillageResident() {}, renderVillageChat() {} })],
  ['./session-controls.js', stub({ renderSessionControls() {}, renderInlinePermission() {}, sessionState() {} })],
  ['./terminal-dock.js', stub({ hasTerminalDock: () => false, noteSceneSize() {} })],
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
const { initAgentTheme, motionControl, spriteFrame } = themeModule.namespace;
const { villageLayout, advanceVillage, scenery } = villageModule.namespace;

// The same background artwork keeps its scale and aspect ratio across viewport
// sizes; only the outer crop moves. Residents retain their own bounded layout.
for (const width of [400, 1400, 2100]) {
  drawn.length = 0;
  scenery(villageLayout(width, 660, 5, 2), (await load("./themes.js")).namespace.THEMES.chiikawa);
  const scene = drawn.find(node => node.id === 'village-scenery');
  const field = drawn.find(node => node.path?.endsWith('/field.png'));
  const stump = drawn.find(node => node.path?.endsWith('/stump.png'));
  assert.equal(scene.styles.w, 1400);
  assert.equal(scene.styles.h, 900);
  assert.equal(scene.styles.left + scene.styles.w / 2, width / 2, 'fixed scene stays centered');
  assert.equal(field.styles.w, 1400);
  assert.equal(field.styles.h / field.styles.w, 1492 / 3840, 'field source aspect ratio is preserved');
  const tile = drawn.find(node => node.styles.left === 910 && node.styles.top === 648);
  assert.ok(tile, 'props do not move when the viewport resizes');
}

assert.match(spriteFrame('chiikawa', 'idle', 0, 1), /idle\/001\.png$/);
assert.match(spriteFrame('chiikawa', 'idle', 0, -1), /directional\/idle\/001\.svg$/);
assert.match(spriteFrame('chiikawa', 'momonga', 50, -1), /momonga\/002\.png$/);
assert.match(spriteFrame('chiikawa', 'momonga', 50, 1), /directional\/momonga\/002\.svg$/);
assert.match(spriteFrame('chiikawa', 'rakko', 0, -1), /rakko\/001\.png$/, 'lettered poses are never mirrored');
assert.match(spriteFrame('chiikawa', 'kurimanju', 0, 1), /kurimanju\/001\.png$/);

// A pose with no rear-view artwork only travels in its declared directions.
{
  const row={id:'kurimanju',status:'working'};
  const view={skin:'chiikawa',themeClock:0,residentAssignments:new Map([[row.id,'kurimanju']])};
  const layout=villageLayout(1200,740,1);
  advanceVillage(view,[row],layout);
  const actor=view.villageActors.get(row.id), y=actor.y;
  const orientations=new Set();
  for(let i=0;i<1200;i++) {
    view.themeClock+=50;advanceVillage(view,[row],layout);
    assert.ok(Math.abs(actor.y-y)<0.001,'side poses never travel backwards up the scene');
    const sprite=themeModule.namespace.agentSprite(view,row,true,actor.facing,actor);
    if(actor.moving) {
      orientations.add(actor.direction);
      assert.ok(['left','right'].includes(sprite.motion));
      assert.ok([1,2,3,4].includes(sprite.atlas.frame),'moving only plays text-free side poses');
      assert.ok(sprite.path.endsWith(`kurimanju-${actor.direction}.svg`),'travel selects the matching orientation');
    }
  }
  assert.equal(orientations.size,2,'both directions remain reachable');
  view.villageSelected=row.id;advanceVillage(view,[row],layout);
  assert.equal(themeModule.namespace.agentSprite(view,row,true,actor.facing,actor).motion,'idle','selection returns to the idle clip');
}

const view = {};
initAgentTheme(view, cx);
assert.equal(view.motionPaused, false, 'old persisted pause must not freeze a newly opened view');
const tick = elapsed => { now += elapsed; timers.get(50)(cx); };
tick(50); assert.equal(view.themeClock, 50);
visible = false; tick(1000); assert.equal(view.themeClock, 50, 'hidden presentation does not animate');
view.pointerDrag = { id: 'resident-t1', moved: true };
tick(50); assert.equal(view.pointerDrag, null, 'hiding the view releases a grabbed resident');
visible = true; tick(50); assert.equal(view.themeClock, 100, 'visible presentation resumes without jumping');
motionControl(view, {});
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
assert.deepEqual([...moved].sort(), rows.filter(row => row.id !== state.villageSelected).map(row => row.id).sort(), 'hovered, notice and quiet residents roam while the selected one stays put');
assert.equal(state.villageActors.get(rows[0].id).x, initial[0].x);
assert.equal(state.villageActors.get(rows[0].id).y, initial[0].y);
state.villageSelected = rows[1].id;
const selectedPosition = { ...state.villageActors.get(rows[1].id) };
for (let frame = 0; frame < 100; frame++) { state.themeClock += 50; advanceVillage(state, rows, layout); }
assert.equal(state.villageActors.get(rows[1].id).x, selectedPosition.x, 'the newly inspected resident stops');
assert.equal(state.villageActors.get(rows[1].id).y, selectedPosition.y);
assert.ok(Math.hypot(state.villageActors.get(rows[0].id).x - initial[0].x, state.villageActors.get(rows[0].id).y - initial[0].y) > 4, 'the former selection resumes roaming');
state.villageSelected = null;

// A resident turns with actual horizontal travel and keeps its facing during
// nearly vertical movement. The original sprite remains unchanged in Cards.
const solo = { themeClock: 0 }, soloRows = [{ id: 'solo', status: 'working' }];
advanceVillage(solo, soloRows, layout);
const walker = solo.villageActors.get('solo');
walker.x = 600; walker.y = 400; walker.tx = 450; walker.ty = 400; walker.wait = 0;
solo.themeClock = 50; advanceVillage(solo, soloRows, layout);
assert.equal(walker.facing, -1); assert.ok(walker.x < 600);
walker.tx = 750;
solo.themeClock = 100; advanceVillage(solo, soloRows, layout);
assert.equal(walker.facing, 1);
walker.tx = walker.x - 0.01; walker.ty = 500;
solo.themeClock = 150; advanceVillage(solo, soloRows, layout);
assert.equal(walker.facing, 1, 'vertical jitter must not turn the character');
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
console.log('village motion: fixed scenery crop, directional poses, selected resident rests, other statuses roam, pause, bounds and visibility passed');
