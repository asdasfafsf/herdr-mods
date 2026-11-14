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
const cx = { timer: { every: (ms, callback) => timers.set(ms, callback) }, notify() {}, stop_propagation() {} };
const drawn = [];
function builder(kind = 'div', path) {
  let id;
  const node = { kind, path, styles: {}, children: [] }; drawn.push(node);
  const element = new Proxy({}, { get: (_target, key) => {
    if (key === 'when') return (condition, fn) => condition ? fn(element) : element;
    if (key === 'id') return value => { id = value; node.id = value; return element; };
    if (key === 'on_click') return fn => { handlers.set(id, fn); return element; };
    if (key.startsWith('on_mouse_')) return (...args) => { handlers.set(`${id}:${key}`, args.at(-1)); return element; };
    if (key === 'recorded') return node;
    if (key === 'child') return value => { node.children.push(value?.recorded || value); return element; };
    if (key === 'children') return values => { node.children.push(...values.map(value => value?.recorded || value)); return element; };
    if (['w', 'h', 'left', 'right', 'top', 'bottom', 'gap', 'px', 'py', 'border', 'text_size', 'line_height'].includes(key)) return value => { node.styles[key] = value; return element; };
    return () => element;
  } });
  return element;
}
const stub = exports => new vm.SyntheticModule(Object.keys(exports), function () {
  for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
}, { context });
const modules = new Map([
  ['gpui-kit', stub({ div: builder, image: path => builder('image', path), svg: path => builder('svg', path) })],
  ['gpui-base', stub({ h_flex: builder, v_flex: builder, Scrollbar: { vertical: builder } })],
  ['herdr', stub({ props: () => ({ integrated: true }), panes: () => [], focused: () => ({}), shared: key => key === 'ag.resourcePack' ? 'chiikawa' : 'village', setShared() {}, run() {} })],
  ['./agent-mode.js', stub({ inAgentMode: () => true, agentViewVisible: () => visible, applyModeTheme() {}, workspaceTheme: () => 'chiikawa' })],
  ['./overview-header.js', stub({ overviewHeader() {} })],
  ['./ui.js', stub({ button() {}, statusColor() {}, statusMark() {}, statusInfo: () => ({}), statusLabel() {}, statusNotice: row => ['done', 'blocked'].includes(row.status) ? { attention: true, label: row.status, text: 'Read me' } : null })],
  ['./village-chat.js', stub({ selectVillageResident() {}, renderVillageChat() {} })],
  ['./session-controls.js', stub({ renderSessionControls() {}, renderInlinePermission() {}, sessionState() {} })],
  ['./terminal-dock.js', stub({ hasTerminalDock: () => false, noteSceneSize() {} })],
]);
function load(name) {
  if (modules.has(name)) return modules.get(name);
  const module = new vm.SourceTextModule(readFileSync(new URL(`../mods/agents-plus/${name.slice(2)}`, import.meta.url), 'utf8'), { context });
  modules.set(name, module);
  return module;
}
const themeModule = load('./agent-theme.js'); await themeModule.link(load); await themeModule.evaluate();
const villageModule = load('./village.js'); await villageModule.link(load); await villageModule.evaluate();
const { initAgentTheme, motionControl, spriteFrame } = themeModule.namespace;
const { villageLayout, advanceVillage, scenery } = villageModule.namespace;

// The same background artwork keeps its scale and aspect ratio across viewport
// sizes; only the outer crop moves. Residents retain their own bounded layout.
for (const width of [400, 1400, 2100]) {
  drawn.length = 0;
  scenery(villageLayout(width, 660, 5, 2), (await load("./resource-packs.js")).namespace.RESOURCE_PACKS.chiikawa);
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
  const view={pack:'chiikawa',themeClock:0,residentAssignments:new Map([[row.id,'kurimanju']])};
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

// Reproduction of main 6616518: two ordinary residents approach on the same
// baseline. At 150px they start clear; the old 0.72*size guard lets the 136px
// nameplates (and then the artwork) intersect before it ever blocks the step.
{
  const rows = [{ id: 'spacing-fixed', status: 'working' }, { id: 'spacing-walker', status: 'working' }];
  const view = { pack: 'chiikawa', themeClock: 0, villageSelected: rows[0].id,
    residentAssignments: new Map(rows.map(row => [row.id, 'hachiware'])) };
  const layout = villageLayout(1000, 660, rows.length);
  advanceVillage(view, rows, layout);
  const a = view.villageActors.get(rows[0].id), b = view.villageActors.get(rows[1].id);
  Object.assign(a, { x: 300, y: 400, tx: 300, ty: 400 });
  Object.assign(b, { x: 450, y: 400, tx: 300, ty: 400, speed: 30, wait: 0 });
  for (let frame = 0; frame < 240; frame++) {
    view.themeClock += 50; advanceVillage(view, rows, layout);
    assert.ok(Math.abs(a.x - b.x) >= layout.size + 28 || Math.abs(a.y - b.y) >= 36,
      `approaching residents must not overlap painted nameplates (frame ${frame}, dx=${Math.abs(a.x-b.x)})`);
  }
  assert.equal(a.x, 300); assert.equal(a.y, 400);
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
    const spec = villageModule.namespace.residentSpacing(state, row, layout.size);
    const bounds = load('./village-spacing.js').namespace.residentBounds(layout, spec.geometry, spec.reservedNotice);
    assert.ok(actor.x >= bounds.left && actor.x <= bounds.right);
    assert.ok(actor.y >= bounds.top && actor.y <= bounds.bottom);
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

// The production movement loop and production renderer share these fixtures.
// Assertions below inspect the recorded paint geometry, not a screenshot or a
// second toy movement algorithm. No native app or session transport is used.
const { renderVillage, residentSpacing } = villageModule.namespace;
const { residentFootprint, footprintOverlap } = load('./village-spacing.js').namespace;
const { RESOURCE_PACKS } = load('./resource-packs.js').namespace;
const palette = new Proxy({}, { get: () => '#123456' });
const intersects = (a, b) => Math.min(a.left + a.width, b.left + b.width) > Math.max(a.left, b.left) + 0.001
  && Math.min(a.top + a.height, b.top + b.height) > Math.max(a.top, b.top) + 0.001;
const contains = (a, b) => b.left >= a.left - 0.001 && b.top >= a.top - 0.001
  && b.left + b.width <= a.left + a.width + 0.001 && b.top + b.height <= a.top + a.height + 0.001;
function fixture(names, statuses = [], width = 1100) {
  const rows = names.map((name, i) => ({ id: `spacing-${i}`, status: statuses[i] || 'working',
    title: `A long resident title ${i}`, project: `Project ${i}`, agent: 'Codex' }));
  const view = { pack: 'chiikawa', themeClock: 0, villageWidth: width, villageHeight: 660,
    residentAssignments: new Map(rows.map((row, i) => [row.id, names[i]])) };
  const layout = villageLayout(width, 660, rows.length);
  advanceVillage(view, rows, layout);
  return { view, rows, layout };
}
function footprints(f) {
  return f.rows.map(row => {
    const spec = residentSpacing(f.view, row, f.layout.size);
    return residentFootprint(f.view.villageActors.get(row.id), f.layout, spec.geometry, spec.reservedNotice);
  });
}
function collisionCount(f) {
  const boxes = footprints(f);
  return boxes.reduce((sum, box, i) => sum + boxes.slice(i + 1).filter(other => footprintOverlap(box, other) > 0.001).length, 0);
}
function advance(f, frames = 1, inspect) {
  for (let i = 0; i < frames; i++) {
    f.view.themeClock += 50;
    advanceVillage(f.view, f.rows, f.layout);
    inspect?.(i);
  }
}
function painted(f) {
  drawn.length = 0;
  renderVillage(f.view, { t: palette, all: f.rows, rows: f.rows, visible: f.rows, pages: 1, states: {} });
  f.layout = f.view.villageBounds;
  const byId = id => drawn.find(node => node.id === id);
  return f.rows.map(row => {
    const actor = f.view.villageActors.get(row.id), spec = residentSpacing(f.view, row, f.layout.size);
    const envelope = residentFootprint(actor, f.layout, spec.geometry, spec.reservedNotice);
    const result = [];
    for (const id of [`village-name-${row.id}`, `village-status-${row.id}`, `village-notice-${row.id}`]) {
      const node = byId(id); if (!node) continue;
      const { left, top, w: width, h: height } = node.styles;
      const box = { left: left + (id.includes('notice') ? 0 : actor.x), top: top + (id.includes('notice') ? 0 : actor.y), width, height };
      assert.ok(contains(envelope, box), `${id}: actual rendered label/bubble must fit its reservation`);
      if (id.includes('name')) {
        const lines = node.children;
        const usedHeight = lines.reduce((sum, line) => sum + line.styles.h, 0) + node.styles.gap + 2 * (node.styles.py + node.styles.border);
        assert.equal(usedHeight, height, 'explicit text lines, gap, padding and borders exactly fill the nameplate');
        for (const line of lines) assert.ok(Math.abs(line.styles.text_size * line.styles.line_height - line.styles.h) < 0.001);
      }
      result.push(box);
    }
    const sprite = themeModule.namespace.agentSprite(f.view, row, true, actor.facing, actor);
    const image = byId(`village-art-${row.id}-${sprite.name}`);
    const crop = drawn.find(node => node.children.includes(image));
    assert.ok(crop, 'inspect the production spriteArt clipping wrapper');
    const [sourceX, y, w, h] = sprite.content || [0, 0, sprite.width, sprite.height];
    const x = sprite.mirrored ? sprite.width - sourceX - w : sourceX, scale = crop.styles.w / sprite.width;
    const art = { left: actor.x + crop.styles.left + x * scale, top: actor.y + crop.styles.top + y * scale, width: w * scale, height: h * scale };
    assert.ok(contains(envelope, art), `${sprite.name}: full painted content, including body-fit overflow, is reserved`);
    assert.ok(result.every(box => !intersects(art, box)), `${sprite.name}: own art does not cover its name, status or bubble`);
    result.push(art);
    return result;
  });
}
function assertPaintClear(f) {
  const groups = painted(f);
  for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
    assert.ok(groups[i].every(a => groups[j].every(b => !intersects(a, b))), `paint overlap between ${i} and ${j}`);
  }
}

// Body-fit overflow and both orientations, including an adapter that changes
// content extents across motion clips and includes a null optional clip.
RESOURCE_PACKS['spacing-fixture'] = { ...RESOURCE_PACKS.chiikawa,
  residents: ['rakko'], motions: { rakko: { idle: null, left: { sprite: 'rakko-sword' } } } };
for (const pack of ['chiikawa', 'spacing-fixture']) {
  const f = fixture(['rakko']); f.view.pack = pack;
  for (const facing of [-1, 1]) for (const direction of ['left', 'right', 'up', 'down']) for (const clock of [50, 300, 900]) {
    const actor = f.view.villageActors.get(f.rows[0].id);
    Object.assign(actor, { facing, direction, moving: true });
    f.view.themeClock = clock; f.view.villageClock = clock;
    assertPaintClear(f);
    const art = residentSpacing(f.view, f.rows[0], f.layout.size).geometry.art;
    assert.ok(art.left < 0 && art.top < 0 && art.width > f.layout.size + 16, 'Rakko paints outside the nominal resident box');
  }
}
delete RESOURCE_PACKS['spacing-fixture'];

// Quiet labels, large art and speech/approval regions all stay clear over time,
// including a narrow one-column field and dense pages. Every free resident moves.
for (const width of [240, 360, 700, 1400]) for (const count of [4, 24]) {
  const names = Array.from({ length: count }, (_, i) => ['rakko', 'hachiware', 'momonga', 'idle'][i % 4]);
  const f = fixture(names, names.map((_name, i) => ['working', 'done', 'blocked', 'seen'][i % 4]), width);
  const before = f.rows.map(row => ({ ...f.view.villageActors.get(row.id) }));
  f.view.villageSelected = f.rows[0].id;
  const travelled = Array(count).fill(0);
  assert.equal(collisionCount(f), 0, 'initial grid fits the actual envelopes');
  assertPaintClear(f);
  advance(f, 400, frame => {
    assert.equal(collisionCount(f), 0, `${width}px/${count}: clean placements must never acquire overlap`);
    f.rows.forEach((row, i) => {
      const actor = f.view.villageActors.get(row.id);
      assert.ok(actor.y >= Math.min(260, Math.max(120, width * 0.19)), 'normal roaming preserves the original scenic floor');
      travelled[i] = Math.max(travelled[i], Math.hypot(actor.x - before[i].x, actor.y - before[i].y));
    });
    if (frame % 100 === 0) assertPaintClear(f);
  });
  assert.equal(travelled[0], 0, 'reachable selection remains exactly still');
  assert.ok(travelled.slice(1).every(distance => distance > 8), `${width}px/${count}: free residents keep roaming: ${travelled}`);
}

// An adversarial saved/dragged placement starts completely coincident. The old
// circular guard or a larger stop-only radius cannot solve this deterministically.
{
  const f = fixture(['rakko', 'hachiware', 'momonga', 'idle', 'hachiware', 'momonga'], [], 1100);
  const origin = { x: (f.layout.left + f.layout.right) / 2, y: (f.layout.top + f.layout.bottom) / 2 };
  f.view.villageSelected = f.rows[0].id;
  for (const actor of f.view.villageActors.values()) Object.assign(actor, origin, { tx: origin.x, ty: origin.y, wait: 0.35 });
  assert.ok(collisionCount(f) > 0);
  let previous = [...f.view.villageActors.values()].map(actor => ({ ...actor }));
  advance(f, 1200, () => {
    [...f.view.villageActors.values()].forEach((actor, i) => {
      assert.ok(Math.hypot(actor.x - previous[i].x, actor.y - previous[i].y) <= actor.speed * 0.05 + 0.001, 'recovery walks at normal speed, never teleports');
    });
    previous = [...f.view.villageActors.values()].map(actor => ({ ...actor }));
  });
  assert.equal(collisionCount(f), 0, 'coincident residents escape a selected obstacle');
  assert.equal(f.view.villageActors.get(f.rows[0].id).x, origin.x);
  assert.equal(f.view.villageActors.get(f.rows[0].id).y, origin.y);
  assertPaintClear(f);
}

// Containment must have an escape gradient, and a clamped large bubble must
// collide with a quiet resident's art/name even without a second speech bubble.
{
  const f = fixture(['rakko', 'hachiware'], ['blocked', 'working'], 360);
  f.view.villageChats = new Map([[f.rows[0].id, { request: {} }]]);
  const first = f.view.villageActors.get(f.rows[0].id), second = f.view.villageActors.get(f.rows[1].id);
  first.x = f.layout.left; first.y = f.layout.top + 250; f.view.villageSelected = f.rows[0].id;
  Object.assign(second, { x: first.x + 30, y: first.y - 210, tx: first.x + 30, ty: first.y - 210, wait: 0 });
  assert.ok(collisionCount(f) > 0, 'a quiet resident starts inside another resident speech area');
  const fixed = { x: first.x, y: first.y };
  let previous = { ...second }, repairs = 0;
  advance(f, 1000, () => {
    assert.ok(second.y >= f.layout.groundTop, 'bubble recovery never opens the sky to ordinary roaming');
    if (Math.hypot(second.x - previous.x, second.y - previous.y) > second.speed * 0.05 + 0.001) repairs++;
    previous = { ...second };
    assert.equal(first.x, fixed.x); assert.equal(first.y, fixed.y);
  });
  assert.equal(repairs, 1, 'a trapped overlap gets one targeted repair, never per-frame rearrangement');
  assert.equal(collisionCount(f), 0, 'contained resident escapes the clamped bubble');
  assertPaintClear(f);
}

// Production drag handlers retain pointer ownership. Neighbours recover while
// it is held, a trailing drop does not select anyone, and release resumes motion.
{
  const f = fixture(['hachiware', 'momonga', 'idle'], [], 1000);
  painted(f);
  const actor = f.view.villageActors.get(f.rows[0].id), neighbour = f.view.villageActors.get(f.rows[1].id);
  const dx = neighbour.x - actor.x, dy = neighbour.y - actor.y;
  handlers.get(`overview-${f.rows[0].id}:on_mouse_down`)({ position: { x: 100, y: 100 } }, cx);
  handlers.get('agent-view:on_mouse_move')({ position: { x: 100 + dx, y: 100 + dy } }, cx);
  const grabbed = { x: actor.x, y: actor.y };
  advance(f, 500);
  assert.equal(actor.x, grabbed.x); assert.equal(actor.y, grabbed.y);
  assert.equal(collisionCount(f), 0, 'other residents clear the held resident');
  handlers.get('agent-view:on_mouse_up')({ position: { x: 100 + dx, y: 100 + dy } }, cx);
  assert.equal(f.view.pointerDrag, null);
  assert.ok(load('./drag-layout.js').namespace.consumeDragClick(f.view));
  advance(f, 200);
  assert.ok(Math.hypot(actor.x - grabbed.x, actor.y - grabbed.y) > 8);
}

// Resize/filter reentry keeps identity/state, fits an out-of-view selection with
// minimal correction, then clears overlaps among returning unlocked residents.
{
  const f = fixture(['rakko', 'hachiware', 'momonga', 'idle', 'hachiware', 'momonga'], ['done'], 1400);
  const all = f.rows, identities = new Map(f.view.villageActors);
  f.view.villageSelected = all[0].id;
  const selected = identities.get(all[0].id);
  selected.x = f.layout.right; selected.y = f.layout.bottom;
  f.rows = [all[0]]; f.view.villageWidth = 360; f.layout = villageLayout(360, 660, 1);
  advance(f);
  const fitted = { x: selected.x, y: selected.y };
  const selectedBox = footprints(f)[0];
  assert.ok(selectedBox.left >= 0 && selectedBox.left + selectedBox.width <= 360 && selectedBox.top >= 0 && selectedBox.top + selectedBox.height <= f.layout.height);
  advance(f, 50);
  assert.equal(selected.x, fitted.x); assert.equal(selected.y, fitted.y, 'reachable selection stops after the resize correction');
  f.rows = [...all].reverse(); f.layout = villageLayout(360, 660, all.length);
  const isolated = identities.get(all[5].id);
  isolated.x = 80; isolated.y = isolated.ty = 1800; isolated.tx = 80;
  advanceVillage(f.view, f.rows, f.layout); // frozen clock after filter reentry
  assert.ok(f.view.villageNeedsReflow, 'layout repair stays pending while paused');
  const paused = [...f.view.villageActors.values()].map(actor => [actor.x, actor.y]);
  advanceVillage(f.view, f.rows, f.layout);
  assert.deepEqual([...f.view.villageActors.values()].map(actor => [actor.x, actor.y]), paused, 'paused repair cannot move any resident');
  advance(f);
  assert.equal(isolated.x, 80); assert.equal(isolated.y, 1800, 'an unaffected unlocked resident is not relocated');
  assert.equal(selected.x, fitted.x); assert.equal(selected.y, fitted.y, 'reflow preserves the reachable selected resident');
  assert.equal(collisionCount(f), 0, 'one structural repair resolves the compressed placement');
  const normal = [...f.view.villageActors.values()].map(actor => ({ ...actor }));
  advance(f);
  [...f.view.villageActors.values()].forEach((actor, i) => assert.ok(Math.hypot(actor.x-normal[i].x, actor.y-normal[i].y) <= actor.speed*0.05+0.001,
    'normal frames after repair return to speed-limited walking'));
  advance(f, 1600);
  for (const row of all) assert.equal(f.view.villageActors.get(row.id), identities.get(row.id), 'filter return reuses each original actor');
  assert.equal(collisionCount(f), 0, 'resize/filter return escapes compressed old placements');
  assertPaintClear(f);
  f.view.pointerDrag = { id: `resident-${all[0].id}`, moved: true };
  selected.x = 1000;
  advance(f);
  assert.equal(selected.x, 1000, 'resize fitting never overrides a currently held pointer');
}

// A pre-existing view restored without spacing metadata repairs overlapping
// actors on its first running tick, leaving a paused restoration untouched.
{
  const f = fixture(['hachiware', 'momonga', 'idle'], [], 700);
  f.view.villageSelected = f.rows[0].id;
  const fixed = f.view.villageActors.get(f.rows[0].id);
  for (const actor of f.view.villageActors.values()) Object.assign(actor, { x: fixed.x, y: fixed.y, tx: fixed.x, ty: fixed.y });
  delete f.view.villageSpacingKey;
  const before = [...f.view.villageActors.values()].map(actor => [actor.x, actor.y]);
  advanceVillage(f.view, f.rows, f.layout);
  assert.deepEqual([...f.view.villageActors.values()].map(actor => [actor.x, actor.y]), before);
  advance(f);
  assert.equal(collisionCount(f), 0, 'restored initial overlaps get a vacant placement');
  assert.equal(fixed.x, before[0][0]); assert.equal(fixed.y, before[0][1]);
}
console.log('village spacing: painted content/labels/bubbles, dense/narrow roaming, coincidence/containment recovery, drag and resize/filter reentry passed');
