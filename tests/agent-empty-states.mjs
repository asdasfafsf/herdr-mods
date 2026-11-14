// Independent synthetic host: no CLI execution, background tasks or live sessions.
// node --experimental-vm-modules tests/agent-empty-states.mjs [--mod-dir INSTALLED_MOD]
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import vm from 'node:vm';
const root = resolve(import.meta.dirname, '..');
const installed = process.argv.includes('--mod-dir') ? resolve(process.argv[process.argv.indexOf('--mod-dir') + 1]) : null;
const now = 1893456000000;
const program = { key: 'codex', name: 'Codex', agent: true };
const session = (address, status) => ({ address, status, program, pane: `pane-${address}`, tab: `tab-${address}`, title: `Session ${address}` });
const stack = () => ({ id: 'root', type: 'row', children: [{ id: 'workspace-views', type: 'column', resizable: true, children: [
  { id: 'agent-scene', type: 'block', size: { weight: 0.6 }, content: { mod: 'agents-plus', props: { mode: 'overview', integrated: true } } },
  { id: 'agent-terminal-dock', type: 'column', size: { weight: 0.4 }, children: [
    { id: 'agent-terminal-surface', type: 'column', children: [{ id: 'main', type: 'block', content: { tab: 'active' } }] },
  ] },
] }] });
const find = (node, id) => node?.id === id ? node : node?.children?.map(child => find(child, id)).find(Boolean);
async function hostFixture({ skin = 'default', presentation = 'cards', agents = [], state = {}, focus = {}, layout = stack(), mode = 'overview', terminals = [] } = {}) {
  const handlers = new Map(), calls = [], timers = new Map(), cache = new Map();
  function builder(type) {
    const node = { type, ops: [] };
    const proxy = new Proxy(node, { get(target, key) {
      if (key === 'then') return undefined;
      if (key === 'toJSON') return () => node;
      if (key === 'when') return (condition, fn) => condition ? fn(proxy) : proxy;
      if (typeof key === 'symbol' || key in target) return target[key];
      return (...args) => {
        if (key === 'hover') args[0](builder('hover'));
        else {
          if (key === 'on_click') handlers.set(node.ops.find(([op]) => op === 'id')?.[1][0], args[0]);
          node.ops.push([key, args.map(arg => typeof arg === 'function' ? '[callback]' : arg)]);
        }
        return proxy;
      };
    } });
    return proxy;
  }
  const shared = { 'ag.resourcePack': skin, ...state };
  if (skin === 'chiikawa') shared['ag.presentation'] = presentation;
  const host = {
    agents: () => structuredClone(agents), terminals: () => structuredClone(terminals),
    panes: () => agents.map(a => ({ id: a.pane, terminal: a.address, tab: a.tab, title: a.title, program: a.program })),
    spaces: () => [], focused: () => focus, props: () => ({ mode, integrated: true }),
    layout: () => layout, layouts: () => [], window: () => ({ active: true }),
    shared: key => structuredClone(shared[key]), setShared: (key, value) => { shared[key] = structuredClone(value); },
    theme: () => new Proxy({}, { get: () => '#56789a' }),
    settings: () => ({ theme: 'graphite', dark: true }),
    themes: () => [{ name: 'paper', light: true }, { name: 'graphite', light: false }],
    setAgentOrder: order => calls.push(['order', order]),
    run: (name, args) => {
      calls.push([name, args]);
      if (name === 'layout.select') find(layout, args.stack).active = args.child;
      if (name === 'layout.resize') { const node = find(layout, args.id); if (node) node.size = args.weight == null ? { px: args.px } : { weight: args.weight }; }
      if (name === 'layout.show' || name === 'layout.hide') { const node = find(layout, args.id); if (node) node.hidden = name === 'layout.hide'; }
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
  cache.set('gpui-kit', synthetic('gpui-kit', { View: class {}, div: () => builder('div'), image: () => builder('image'), svg: () => builder('svg') }));
  const input = { new: ({ value = '' } = {}) => ({ text: value, value() { return this.text; }, set_value(value) { this.text = value; }, on() {}, focus() {} }) };
  cache.set('gpui-base', synthetic('gpui-base', { h_flex: () => builder('row'), v_flex: () => builder('column'), InputState: input, TextareaState: input,
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
  await main.link(link); await main.evaluate();
  const helper = module(resolve(modRoot, 'agent-empty-state.js'));
  if (helper.status === 'unlinked') await helper.link(link);
  if (helper.status !== 'evaluated') await helper.evaluate();
  const view = new main.namespace.default();
  const cx = { spawn() {}, timer: { every(ms, fn) { timers.set(ms, fn); } }, notify() {}, stop_propagation() {}, focus_handle: () => ({}) };
  view.init({}, cx); view.outside = [];
  const render = () => { handlers.clear(); return JSON.parse(JSON.stringify(view.render(cx))); };
  const click = id => { assert.ok(handlers.has(id), `missing recovery/navigation control ${id}`); handlers.get(id)({}, cx); };
  return { view, render, click, calls, shared, layout, helper: helper.namespace,
    overview: cache.get(resolve(modRoot, 'overview.js')).namespace,
    workspace: cache.get(resolve(modRoot, 'workspace-controls.js')).namespace };
}
const failures = [];
let checks = 0;
async function check(name, fn) {
  try { await fn(); checks++; }
  catch (error) { failures.push(`${name}: ${error.message.split('\n')[0]}`); }
}
for (const [skin, presentation] of [['default', 'cards'], ['chiikawa', 'cards'], ['chiikawa', 'village']]) {
  const options = { skin, presentation }, prefix = `${skin}/${presentation}`;
  await check(`${prefix}: no optional shared state and no sessions`, async () => {
    const env = await hostFixture({ ...options, focus: null }), output = JSON.stringify(env.render());
    assert.equal(env.overview.agentViewRows().length, 0);
    assert.match(output, /No agents running yet/);
    assert.doesNotMatch(output, /"Active"|"Working"|"Seen"/);
    env.workspace.workspaceCommand('toggle_view');
    assert.equal(find(env.layout, 'agent-scene').size.weight, 0, 'Terminal remains reachable without a focused session or sidebar');
    assert.equal(find(env.layout, 'agent-terminal-dock').size.weight, 1);
  });
  await check(`${prefix}: outside sessions need neither worktrees nor restore state`, async () => {
    const env = await hostFixture(options);
    env.view.outside = [{ agent: 'codex', pid: 7, title: 'Outside session', status: 'working', cwd: '/example/repo', app: 'iTerm' }];
    const rows = env.overview.agentViewRows(env.view.outside);
    assert.equal(rows.length, 1); assert.equal(rows[0].project, 'repo'); assert.equal(rows[0].source, 'outside');
    assert.match(JSON.stringify(env.render()), /Outside session/);
    assert.doesNotMatch(JSON.stringify(env.render()), /No agents running yet|All agents are idle/);
  });
  await check(`${prefix}: live terminal discovery works without sidebar agent rows`, async () => {
    const env = await hostFixture({ ...options, terminals: [{ address: 'native', state: 'live', status: 'working', name: 'Native session', program }] });
    const rows = env.overview.agentViewRows();
    assert.equal(rows.length, 1); assert.equal(rows[0].address, 'native'); assert.equal(rows[0].status, 'working');
    assert.match(JSON.stringify(env.render()), /Native session/);
  });
  await check(`${prefix}: hidden idle sessions are not called absent`, async () => {
    const env = await hostFixture({ ...options, agents: [session('one', 'idle'), session('two', 'idle')] });
    const output = JSON.stringify(env.render());
    assert.match(output, /All agents are idle/);
    assert.doesNotMatch(output, /No agents running yet/);
    assert.equal(env.overview.agentViewRows().length, 2);
    env.click('agent-empty-terminal');
    assert.equal(find(env.layout, 'agent-scene').size.weight, 0);
    assert.equal(find(env.layout, 'agent-terminal-dock').size.weight, 1);
  });
  await check(`${prefix}: explicitly focused idle session stays visible`, async () => {
    const env = await hostFixture({ ...options, agents: [session('one', 'idle')], focus: { terminal: 'one' } });
    const output = JSON.stringify(env.render());
    assert.match(output, /Session one/);
    assert.doesNotMatch(output, /All agents are idle|No agents running yet/);
  });
  await check(`${prefix}: recent Seen works without sidebar metadata`, async () => {
    const env = await hostFixture({ ...options, agents: [session('one', 'done')], state: { 'ag.acked': { one: now - 1000 } } });
    assert.equal(env.overview.agentViewRows()[0].status, 'seen');
    assert.match(JSON.stringify(env.render()), /Seen/);
  });
  for (const [label, state] of [['Seen disabled', { 'hm.options': { seen: false }, 'ag.acked': { one: now - 1000 } }],
    ['Seen expired', { 'hm.options': { seenMinutes: 5 }, 'ag.acked': { one: now - 600000 } }]]) {
    await check(`${prefix}: ${label}`, async () => {
      const env = await hostFixture({ ...options, agents: [session('one', 'done')], state });
      assert.equal(env.overview.agentViewRows()[0].status, 'idle');
      assert.match(JSON.stringify(env.render()), /All agents are idle/);
    });
  }
  await check(`${prefix}: filter miss clears without inventing rows`, async () => {
    const env = await hostFixture({ ...options, agents: [session('one', 'working')] });
    env.view.input.set_value('does-not-exist'); env.view.statusFilter = 'blocked'; env.view.sourceFilter = 'outside';
    assert.match(JSON.stringify(env.render()), /No matching agents/);
    env.click('agent-empty-clear');
    assert.equal(env.view.input.value(), ''); assert.equal(env.view.statusFilter, 'all'); assert.equal(env.view.sourceFilter, 'all');
    assert.match(JSON.stringify(env.render()), /Session one/);
  });
  await check(`${prefix}: unknown host status remains unknown`, async () => {
    const env = await hostFixture({ ...options, agents: [session('one', 'new-provider-state')] });
    assert.equal(env.overview.agentViewRows()[0].status, 'new-provider-state');
    assert.match(JSON.stringify(env.render()), /Unknown/);
  });
  await check(`${prefix}: absent custom workspace has no dead terminal action`, async () => {
    const env = await hostFixture({ ...options, agents: [session('one', 'idle')], layout: { id: 'custom', content: { mod: 'agents-plus' } } });
    const output = JSON.stringify(env.render());
    assert.match(output, /All agents are idle/);
    assert.doesNotMatch(output, /agent-empty-terminal/);
    env.workspace.workspaceCommand('toggle_view');
    assert.equal(env.calls.filter(([name]) => name === 'layout.select').length, 0);
  });
  await check(`${prefix}: helper distinguishes absence, visibility and filters`, async () => {
    const { helper } = await hostFixture(options);
    assert.equal(helper.agentEmptyState({ total: 0, available: 0, count: 0 }).kind, 'no-sessions');
    assert.equal(helper.agentEmptyState({ total: 3, available: 0, count: 0 }).kind, 'idle-hidden');
    assert.equal(helper.agentEmptyState({ total: 3, available: 2, count: 0 }).kind, 'filtered');
    assert.equal(helper.agentEmptyState({ total: 3, available: 2, count: 1 }), null);
  });
}
await check('sidebar: no focus does not fabricate Active or Seen sections', async () => {
  const env = await hostFixture({ mode: 'sidebar', agents: [session('one', 'working'), session('two', 'idle')], focus: null });
  const output = JSON.stringify(env.render());
  assert.match(output, /"Working"/); assert.match(output, /"Idle"/);
  assert.doesNotMatch(output, /"Active"|"Seen"/);
});
await check('sidebar: unknown provider status is not classified as Idle', async () => {
  const env = await hostFixture({ mode: 'sidebar', agents: [session('one', 'new-provider-state')], focus: null });
  const output = JSON.stringify(env.render());
  assert.match(output, /"Unknown"/);
  assert.doesNotMatch(output, /"Idle"|"Working"|"Seen"|"Active"/);
});
console.log(`Independent empty-state checks: ${checks} passed, ${failures.length} failed`);
for (const failure of failures) console.error(failure);
if (failures.length) process.exitCode = 1;
