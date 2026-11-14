// Metadata-only second theme exercised through the real shared view modules.
// No images, CLI execution, messages, approvals or reset-credit calls.
// node --experimental-vm-modules tests/theme-adapters.mjs
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import vm from 'node:vm';
const root = resolve(import.meta.dirname, '..');
const installed = null;
let now = 1893456000000;
const program = { key: 'codex', name: 'Codex', agent: true };
const session = (address, status) => ({ address, status, program, pane: `pane-${address}`, tab: `tab-${address}`, title: `Session ${address}` });
const stack = () => ({ id: 'root', type: 'row', children: [{ id: 'workspace-views', type: 'column', resizable: true, children: [
  { id: 'agent-scene', type: 'block', size: { weight: 0.6 }, content: { mod: 'agents-plus', props: { mode: 'overview', integrated: true } } },
  { id: 'agent-terminal-dock', type: 'column', size: { weight: 0.4 }, children: [
    { id: 'agent-terminal-surface', type: 'block', content: { tab: 'active' } },
  ] },
] }] });
const find = (node, id) => node?.id === id ? node : node?.children?.map(child => find(child, id)).find(Boolean);
async function hostFixture({ skin = 'fixture-garden', presentation = 'cards', agents = [], state = {}, focus = {}, layout = stack(), mode = 'overview', terminals = [] } = {}) {
  const handlers = new Map(), calls = [], timers = new Map(), cache = new Map();
  function builder(type, path) {
    const node = { type, path, ops: [] };
    const proxy = new Proxy(node, { get(target, key) {
      if (key === 'then') return undefined;
      if (key === 'toJSON') return () => node;
      if (key === 'when') return (condition, fn) => condition ? fn(proxy) : proxy;
      if (typeof key === 'symbol' || key in target) return target[key];
      return (...args) => {
        if (key === 'hover') args[0](builder('hover'));
        else {
          if (key === 'on_click') handlers.set(node.ops.find(([op]) => op === 'id')?.[1][0], args[0]);
          if (key === 'on_open_change') {
            const id = node.ops.find(([op]) => op === 'id')?.[1][0];
            handlers.set(id, (_e, cx) => args[0](!node.ops.find(([op]) => op === 'open')?.[1][0], cx));
            handlers.set(`${id}:on_open_change`, args[0]);
          }
          node.ops.push([key, args.map(arg => typeof arg === 'function' ? '[callback]' : arg)]);
        }
        return proxy;
      };
    } });
    return proxy;
  }
  const shared = { ...state };
  shared['ag.presentation'] = presentation;
  let nativeTheme = skin === 'default' ? 'paper' : skin === 'chiikawa' ? 'herdr-chiikawa' : `herdr-${skin}`;
  const host = {
    agents: () => structuredClone(agents), terminals: () => structuredClone(terminals),
    panes: () => agents.map(a => ({ id: a.pane, terminal: a.address, tab: a.tab, title: a.title, program: a.program })),
    spaces: () => [], focused: () => focus, props: () => ({ mode, integrated: true }),
    layout: () => layout, layouts: () => [], window: () => ({ active: true }),
    shared: key => structuredClone(shared[key]), setShared: (key, value) => { shared[key] = structuredClone(value); },
    theme: () => new Proxy({}, { get: () => '#56789a' }),
    settings: () => ({ theme: nativeTheme, dark: false }),
    themes: () => [{ name: 'paper', light: true }, { name: 'graphite', light: false }, { name: 'herdr-chiikawa', light: true }, { name: 'herdr-fixture-garden', light: true }],
    setAgentOrder: order => calls.push(['order', order]),
    run: (name, args) => {
      assert.ok(['pane.focus', 'agent.focus', 'layout.select', 'layout.show', 'layout.hide', 'layout.resize', 'layout.set', 'app.theme'].includes(name), `Unexpected host action: ${name}`);
      calls.push([name, args]);
      if (name === 'layout.select') find(layout, args.stack).active = args.child;
      if (name === 'layout.show' || name === 'layout.hide') { const node = find(layout, args.id); if (node) node.hidden = name === 'layout.hide'; }
      if (name === 'layout.resize') { const node = find(layout, args.id); if (node) node.size = args.weight == null ? { px: args.px } : { weight: args.weight }; }
      if (name === 'pane.focus') { const agent = agents.find(agent => agent.pane === args.pane); if (agent) Object.assign(focus, { terminal: agent.address, pane: agent.pane }); }
    },
    nextCommand: () => new Promise(() => {}), openOverlay: value => calls.push(['overlay', value]), closeOverlay: () => {},
    appHome: () => '/synthetic/app', home: () => '/synthetic',
    exec: () => { throw new Error('No process or session command is permitted in empty-state tests'); },
    readTextFile: async () => '{}', writeTextFile: async () => { throw new Error('No configuration writes permitted'); },
  };
  const local = new Map();
  const context = vm.createContext({ console, Date: class extends Date { static now() { return now; } },
    localStorage: { getItem: key => local.get(key), setItem: (key, value) => local.set(key, value), removeItem: key => local.delete(key) } });
  const synthetic = (name, values) => new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context, identifier: name });
  cache.set('herdr', synthetic('herdr', host));
  cache.set('gpui-kit', synthetic('gpui-kit', { View: class {}, div: () => builder('div'), image: path => builder('image', path), svg: path => builder('svg', path) }));
  const input = { new: ({ value = '' } = {}) => ({ text: value, value() { return this.text; }, set_value(value) { this.text = value; }, on() {}, focus() {} }) };
  cache.set('gpui-base', synthetic('gpui-base', { h_flex: () => builder('row'), v_flex: () => builder('column'), Popover: { new: id => builder('popover').id(id) }, InputState: input, TextareaState: input,
    Input: { new: () => builder('input') }, Textarea: { new: () => builder('textarea') }, Scrollbar: { vertical: () => builder('scrollbar') } }));
  function module(path) {
    if (cache.has(path)) return cache.get(path);
    const value = new vm.SourceTextModule(readFileSync(path, 'utf8'), { context, identifier: path });
    cache.set(path, value); return value;
  }
  const modRoot = installed ?? resolve(root, 'mods/agents-plus');
  const main = module(resolve(modRoot, 'main.js'));
  const link = (name, parent) => {
    if (cache.has(name)) return cache.get(name);
    let path = resolve(dirname(parent.identifier), name);
    if (!installed && !existsSync(path)) path = resolve(root, 'lib', name);
    return module(path);
  };
  await main.link(link);
  const definitions = cache.get(resolve(modRoot, 'themes.js'));
  await definitions.evaluate();
  Object.assign(definitions.namespace.THEMES, fixtureThemes());
  await main.evaluate();
  const helper = module(resolve(modRoot, 'agent-empty-state.js'));
  if (helper.status === 'unlinked') await helper.link(link);
  if (helper.status !== 'evaluated') await helper.evaluate();
  const view = new main.namespace.default();
  const cx = { spawn() {}, timer: { every(ms, fn) { timers.set(ms, fn); } }, notify() {}, stop_propagation() {}, focus_handle: () => ({}) };
  view.init({}, cx); view.outside = [];
  const render = () => { handlers.clear(); return JSON.parse(JSON.stringify(view.render(cx))); };
  const click = id => { assert.ok(handlers.has(id), `missing recovery/navigation control ${id}`); handlers.get(id)({}, cx); };
  return { view, render, click, calls, shared, layout, focus, helper: helper.namespace, cx,
    setTheme(value) { nativeTheme = value; },
    tick(ms = 50) { now += ms; timers.get(50)?.(cx); },
    definitions: definitions.namespace,
    theme: cache.get(resolve(modRoot, 'agent-theme.js')).namespace,
    village: cache.get(resolve(modRoot, 'village.js')).namespace,
    chat: cache.get(resolve(modRoot, 'village-chat.js')).namespace,
    drag: cache.get(resolve(modRoot, 'drag-layout.js')).namespace,
    mode: cache.get(resolve(modRoot, 'agent-mode.js')).namespace,
    dock: cache.get(resolve(modRoot, 'terminal-dock.js')).namespace,
    status: cache.get(resolve(root, 'lib/agent-status.js')).namespace,
    overview: cache.get(resolve(modRoot, 'overview.js')).namespace,
    workspace: cache.get(resolve(modRoot, 'workspace-controls.js')).namespace };
}
function fixtureThemes() {
  const sprite = { width: 80, height: 100, frames: 2, durations: [50, 150], duration: 200, content: [10, 20, 60, 70] };
  const definitions = {
    'fixture-garden': {
      label: 'Fixture garden', native: 'herdr-fixture-garden', layout: 'village',
      art: 'synthetic/garden', residents: ['circle', 'triangle'], sprites: { circle: sprite, triangle: { ...sprite, body: [20, 30, 40, 60] } },
      facing: { circle: [1, 0], triangle: -1 },
      scene: { width: 960, height: 600, background: '#334455', layers: [
        { x: 0, y: 0, width: 960, height: 600, color: '#112233' },
        { path: 'landscape.svg', x: 20, y: 30, width: 400, height: 200 },
        { path: 'canopy.svg', x: 50, y: 100, width: 100, height: 300, clipHeight: 150 },
      ] },
    },
    'fixture-empty': { label: 'Empty', native: 'herdr-fixture-empty', residents: [], scene: { width: 960, height: 600 } },
    'fixture-invalid': { label: 'Invalid', native: 'herdr-fixture-invalid', art: 'synthetic/bad', residents: ['missing', 'zero', 'negative', 'timing', 'infinite'], sprites: {
      zero: { ...sprite, width: 0 }, negative: { ...sprite, height: -1 }, timing: { ...sprite, durations: [0, 200] }, infinite: { ...sprite, width: Infinity },
    }, scene: { width: 960, height: 600 } },
    'fixture-malformed': { label: 'Malformed', native: 'herdr-fixture-malformed', residents: 'not-an-array' },
  };
  definitions['fixture-cards'] = { ...definitions['fixture-garden'], label: 'Card garden', native: 'herdr-fixture-cards', layout: 'cards' };
  return definitions;
}
function nodes(tree, result = []) {
  if (!tree || typeof tree !== 'object') return result;
  if (tree.ops) result.push(tree);
  for (const value of Object.values(tree)) if (value && typeof value === 'object') nodes(value, result);
  return result;
}
const property = (node, name) => node.ops.find(([key]) => key === name)?.[1][0];
const element = (tree, id) => nodes(tree).find(node => property(node, 'id') === id);
const paths = tree => nodes(tree).map(node => node.path).filter(Boolean);
const failures = [];
let checks = 0;
async function check(name, fn) {
  try { await fn(); checks++; }
  catch (error) { failures.push(`${name}: ${error.message.split('\n')[0]} ${error.stack.match(/at file:[^\n]+/)?.[0] || ''}`); }
}
for (const presentation of ['cards', 'village']) {
  await check(`${presentation}: metadata-only adapter renders its own assets and common status`, async () => {
    const env = await hostFixture({ presentation, agents: [session('one', 'blocked'), session('two', 'working'), session('three', 'done')], state: {
      'ag.info': { one: { doing: 'Choose the next step' }, two: { doing: 'Reading the example source' }, three: { said: 'Example result ready' } },
    } });
    const output = env.render();
    assert.equal(env.view.skin, 'fixture-garden');
    assert.ok(paths(output).some(path => path.startsWith('synthetic/garden/')));
    assert.ok(paths(output).every(path => !path.includes('chiikawa')));
    for (const label of ['Needs you', 'Working', 'Done', 'Choose the next step', 'Example result ready']) assert.ok(JSON.stringify(output).includes(label), label);
    if (presentation === 'village') {
      assert.ok(element(output, 'agent-village'));
      assert.ok(element(output, 'village-notice-one'));
      assert.ok(element(output, 'village-notice-three'));
      assert.equal(element(output, 'village-notice-two'), undefined, 'working progress stays out of speech bubbles');
      assert.ok(element(output, 'village-status-two'), 'working keeps its compact status label');
      assert.ok(paths(output).includes('mods/agents-plus/speech-tail.svg'), 'speech geometry belongs to the common UI');
      const scenery = element(output, 'village-scenery');
      assert.equal(property(scenery, 'w'), 960); assert.equal(property(scenery, 'h'), 600);
      assert.equal(property(scenery, 'left'), (1100 - 960) / 2);
      assert.ok(paths(output).includes('synthetic/garden/landscape.svg'));
      assert.equal(property(element(output, 'agent-village'), 'bg'), '#334455');
      assert.ok(nodes(output).some(node => property(node, 'top') === 100 && property(node, 'h') === 150
        && node.ops.some(([key]) => key === 'overflow_hidden')), 'scene clipping comes from layer metadata');
    } else {
      assert.ok(element(output, 'overview-resident-one'));
      const preview = JSON.stringify(element(output, 'overview-preview-two'));
      assert.match(preview, /Latest activity/); assert.doesNotMatch(preview, /Read required/);
    }
    // Selection only: synthetic focus is allowed, but no transport executes.
    env.click('overview-one');
    assert.equal(env.view.villageSelected, 'one');
    assert.ok(env.calls.some(([name, args]) => name === 'pane.focus' && args.pane === 'pane-one'));
  });
}
await check('sprite frame durations and per-frame mirroring come from adapter data', async () => {
  const env = await hostFixture();
  assert.match(env.theme.spriteFrame('fixture-garden', 'circle', 0, 1), /^synthetic\/garden\/circle\/001\.png$/);
  assert.match(env.theme.spriteFrame('fixture-garden', 'circle', 49, -1), /^synthetic\/garden\/directional\/circle\/001\.svg$/);
  assert.match(env.theme.spriteFrame('fixture-garden', 'circle', 50, -1), /^synthetic\/garden\/circle\/002\.png$/, 'frontal frame is never mirrored');
  assert.match(env.theme.spriteFrame('fixture-garden', 'circle', 200, 1), /circle\/001\.png$/);
  assert.match(env.theme.spriteFrame('fixture-garden', 'triangle', 0, 1), /directional\/triangle\/001\.svg$/);
});
await check('adapter default presentation is used only without an explicit preference', async () => {
  const env = await hostFixture({ skin: 'fixture-cards', presentation: null, agents: [session('one', 'working')] });
  assert.equal(env.view.presentation, 'cards');
  assert.equal(element(env.render(), 'agent-village'), undefined);
  env.setTheme('herdr-fixture-garden'); env.tick();
  assert.equal(env.view.presentation, 'village');
  assert.ok(element(env.render(), 'agent-village'));
  env.shared['ag.presentation'] = 'cards'; env.tick();
  assert.equal(env.view.presentation, 'cards');
  env.setTheme('herdr-fixture-cards'); env.tick();
  assert.equal(env.view.presentation, 'cards');
});
await check('second theme opens the same native terminal surface without creating a session', async () => {
  const layout = stack();
  find(layout, 'agent-scene').size.weight = 1;
  find(layout, 'agent-terminal-dock').size.weight = 0;
  const env = await hostFixture({ layout, agents: [session('one', 'working')] });
  env.render(); env.click('overview-open-one');
  assert.equal(env.focus.terminal, 'one');
  assert.equal(env.dock.terminalDockOpen(), true);
  assert.equal(find(layout, 'agent-terminal-surface').content.tab, 'active');
  assert.ok(env.calls.every(([name]) => ['layout.resize', 'layout.show', 'pane.focus', 'layout.select'].includes(name)));
});
await check('a registered village shares motion, pause and drag behavior', async () => {
  const env = await hostFixture({ presentation: 'village', agents: [session('one', 'working'), session('two', 'done')] });
  env.render();
  const original = [...env.view.villageActors].map(([id, actor]) => [id, actor.x, actor.y]);
  for (let i = 0; i < 120; i++) { env.tick(); env.render(); }
  assert.ok(original.some(([id, x, y]) => env.view.villageActors.get(id).x !== x || env.view.villageActors.get(id).y !== y));
  if (!env.view.villageFilters) { env.click('village-filters'); env.render(); }
  env.click('overview-motion');
  const clock = env.view.themeClock;
  env.tick(100); assert.equal(env.view.themeClock, clock);
  env.click('overview-motion'); env.tick(); assert.ok(env.view.themeClock > clock);
  const actor = env.view.villageActors.get('one');
  const layout = env.village.villageLayout(1100, 660, 2, 1);
  assert.equal(env.drag.beginDrag(env.view, 'resident-one', { position: { x: 10, y: 10 } }, actor, layout, point => Object.assign(actor, point), env.cx), true);
  env.drag.moveDrag(env.view, { position: { x: 40, y: 40 } }, env.cx);
  assert.equal(env.drag.finishDrag(env.view, null, env.cx), true);
  assert.equal(env.view.pointerDrag, null);
});
await check('hot theme switches keep selection, draft, focus, positions and native session', async () => {
  const env = await hostFixture({ presentation: 'village', agents: [session('one', 'working'), session('two', 'working')] });
  env.render(); env.click('overview-one');
  const chat = env.view.villageChats.get('one');
  chat.input.set_value('Unsent draft'); chat.images.push({ path: '/synthetic/untouched.png' });
  const actors = env.view.villageActors, selected = env.view.villageSelected;
  env.drag.beginDrag(env.view, 'resident-two', { position: { x: 0, y: 0 } }, actors.get('two'), env.village.villageLayout(1100, 660, 2), () => {}, env.cx);
  for (const [native, skin] of [['herdr-chiikawa', 'chiikawa'], ['paper', 'default'], ['herdr-fixture-garden', 'fixture-garden']]) {
    env.setTheme(native); env.tick(); const output = env.render();
    assert.equal(env.view.skin, skin);
    assert.equal(env.view.villageSelected, selected);
    assert.equal(env.view.villageChats.get('one'), chat);
    assert.equal(chat.input.value(), 'Unsent draft'); assert.equal(chat.images.length, 1);
    assert.equal(env.view.villageActors, actors);
    assert.equal(env.view.pointerDrag, null);
    assert.equal(env.focus.terminal, 'one');
    if (skin === 'fixture-garden') assert.ok(paths(output).every(path => !path.includes('chiikawa')));
  }
  assert.ok(env.calls.every(([name]) => !['terminal.new', 'tab.new', 'space.new'].includes(name)));
});
for (const skin of ['fixture-empty', 'fixture-invalid', 'fixture-malformed', 'unregistered']) {
  await check(`${skin}: invalid or absent resident pool uses plain cards`, async () => {
    const env = await hostFixture({ skin, presentation: 'village', agents: [session('one', 'blocked')] });
    assert.equal(env.definitions.hasResidents(skin), false);
    assert.equal(env.definitions.hasVillage(skin), false);
    assert.equal(env.theme.agentSprite(env.view, { id: 'one' }), null);
    const output = env.render();
    assert.ok(element(output, 'overview-one'));
    assert.equal(element(output, 'agent-village'), undefined);
    assert.ok(paths(output).every(path => !path.startsWith('synthetic/') && !path.includes('chiikawa')));
    const before = env.view.themeClock; env.tick(); assert.equal(env.view.themeClock, before);
  });
}
await check('plain theme does not inherit resident artwork or motion', async () => {
  const env = await hostFixture({ skin: 'default', agents: [session('one', 'working')] });
  const output = env.render();
  assert.equal(element(output, 'overview-resident-one'), undefined);
  assert.equal(element(output, 'overview-motion'), undefined);
  env.tick(); assert.equal(env.view.themeClock, 0);
});
await check('shared speech distinguishes progress from attention without theme policy', async () => {
  const env = await hostFixture();
  assert.equal(env.status.statusNotice({ status: 'working', activity: '  ' }), null);
  assert.equal(env.status.statusNotice({ status: 'working', activity: 'Thinking…' }), null);
  assert.equal(env.status.statusActivity('working', { doing: 'Thinking…' }), '');
  assert.equal(env.status.statusPreview({ status: 'working', activity: 'Thinking…' }).label, 'Session status');
  assert.notEqual(env.status.statusPreview({ status: 'working', activity: 'Thinking…' }).text, 'Thinking…');
  assert.equal(env.status.statusActivity('working', { doing: 'Reading a file · thinking…' }), 'Reading a file · thinking…');
  const progress = env.status.statusNotice({ status: 'working', activity: '  Reading the source  ' });
  assert.equal(progress.text, 'Reading the source'); assert.equal(progress.attention, false);
  assert.equal(env.status.statusPreview({ status: 'working', activity: progress.text }).label, 'Latest activity');
  for (const status of ['blocked', 'error', 'done']) {
    const notice = env.status.statusNotice({ status, activity: '' });
    assert.equal(notice.attention, true); assert.ok(notice.text.length > 0);
    assert.equal(env.status.statusPreview({ status, activity: '' }).label, 'Read required');
  }
  for (const status of ['seen', 'idle', 'unknown', 'new-status']) {
    assert.equal(env.status.statusNotice({ status, activity: '' }), null);
    assert.equal(env.status.statusPreview({ status, activity: '' }).attention, false);
  }
  assert.equal(env.status.statusActivity('working', { doing: '  Actual step  ', said: 'Old reply' }), 'Actual step');
  assert.equal(env.status.statusActivity('error', { doing: 'Please review', said: 'Old reply' }), 'Please review');
  assert.equal(env.status.statusActivity('done', { doing: 'Old step', said: '  Result  ' }), 'Result');
});
await check('working without progress has a label and no fabricated speech bubble', async () => {
  for (const doing of ['', 'Thinking…']) {
    const env = await hostFixture({ presentation: 'village', agents: [session('one', 'working')], state: { 'ag.info': { one: { doing } } } });
    const output = env.render();
    assert.equal(element(output, 'village-notice-one'), undefined);
    assert.ok(element(output, 'village-status-one'));
    assert.match(JSON.stringify(output), /Working/);
  }
});
console.log(`Theme adapter checks: ${checks} passed, ${failures.length} failed`);
for (const failure of failures) console.error(failure);
if (failures.length) process.exitCode = 1;
