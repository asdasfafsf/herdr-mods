// Layout and native action stubs only. No live terminals, input or approvals.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let now = 10000, tree, focused = { terminal: 't1' }, paneList = [{ pane: 'pane-1', terminal: 't1', title: 'Project' }];
const shared = new Map([['layout', 'test']]), commands = [], writes = [], after = [], every = [];
const elements = [];
function element(kind) {
  const record = { kind, children: [], calls: new Map() };
  const proxy = new Proxy(record, { get(target, name) {
    if (name in target) return target[name];
    return (...args) => {
      record.calls.set(name, args);
      if (name === 'child') record.children.push(args[0]);
      return proxy;
    };
  } });
  elements.push(record);
  return proxy;
}
const find = (id, node = tree) => node?.id === id ? node : node?.children?.map(child => find(id, child)).find(Boolean);
const makeTree = () => ({ id: 'workspace-views', type: 'column', children: [
  { id: 'agent-scene', type: 'block', min: 0, size: { weight: 0.6 } },
  { id: 'agent-terminal-dock', type: 'column', min: 20, size: { weight: 0.4 }, children: [
    { id: 'agent-terminal-toolbar', type: 'block', size: { px: 20 } },
    { id: 'agent-terminal-surface', type: 'column', children: [
      { id: 'main', type: 'block', content: { tab: 'active', pane: { gap: 7, header: { height: 34 } } } },
    ] },
  ] },
] });
tree = makeTree();
const nativeBefore = JSON.stringify(find('main'));
const context = vm.createContext({ Date: { now: () => now } });
const host = {
  layout: () => tree, shared: key => shared.get(key),
  setShared: (key, value) => { writes.push([key, value]); shared.set(key, value); },
  focused: () => focused, panes: () => paneList,
  theme: () => ({ chrome: 'chrome', muted: 'muted', foreground: 'foreground', hover: 'hover' }),
  nextCommand: () => new Promise(() => {}),
  run: (name, args) => {
    commands.push([name, args]);
    if (name === 'layout.resize') find(args.id).size = { weight: args.weight };
    else if (name === 'layout.show') find(args.id).hidden = false;
    else assert.ok(['pane.focus', 'agent.focus', 'terminal.search'].includes(name), `unexpected native action ${name}`);
  },
};
const imports = {
  herdr: host,
  'gpui-kit': { div: () => element('div') },
  'gpui-base': { h_flex: () => element('h_flex') },
  './agent-mode.js': { requestAgentSelection() {} },
};
const cache = new Map();
async function load(name) {
  if (cache.has(name)) return cache.get(name);
  let module;
  if (imports[name]) module = new vm.SyntheticModule(Object.keys(imports[name]), function () {
    for (const [key, value] of Object.entries(imports[name])) this.setExport(key, value);
  }, { context });
  else module = new vm.SourceTextModule(readFileSync(new URL(`../mods/agents-plus/${name.replace('./', '')}`, import.meta.url), 'utf8'), { context });
  cache.set(name, module);
  await module.link(load);
  return module;
}
const dockModule = await load('./terminal-dock.js'); await dockModule.evaluate();
const controlsModule = await load('./workspace-controls.js'); await controlsModule.evaluate();
const dock = dockModule.namespace, controls = controlsModule.namespace;
const cx = { notify() {}, stop_propagation() {}, timer: {
  after(ms, fn) { const task = { ms, fn }; after.push(task); return task; },
  every(ms, fn) { every.push({ ms, fn }); },
}, spawn() {} };
const ratio = () => dock.workspaceSplit()?.sceneShare;
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const resized = () => commands.filter(([name]) => name === 'layout.resize');
const settle = () => { dock.syncWorkspaceSplit(); now += 120; dock.syncWorkspaceSplit(); };
function nativeRelease(share, sceneHeight) {
  find('agent-scene').size = { weight: share };
  find('agent-terminal-dock').size = { weight: 1 - share };
  if (sceneHeight !== undefined) {
    dock.noteSceneSize(sceneHeight, cx);
    assert.equal(after.length, 1);
    now += 80; after.shift().fn(cx);
  }
  settle();
}

assert.equal(dock.HANDLE_HEIGHT, 20);
assert.equal(dock.hasTerminalDock(), true);
assert.equal(dock.sceneVisible(), true);
assert.equal(dock.terminalDockOpen(), true);
dock.closeTerminalDock(); near(ratio(), 1);
assert.equal(dock.terminalDockOpen(), false);
assert.equal(find('agent-terminal-surface').hidden, undefined, 'zero-sized native surface stays mounted');
dock.restoreWorkspaceSplit(); near(ratio(), 0.6);
dock.showWorkspaceTerminal(); near(ratio(), 0);
assert.equal(dock.sceneVisible(), false);
assert.equal(commands.at(-1)[0], 'pane.focus');
assert.equal(commands.at(-1)[1].pane, 'pane-1');
dock.showWorkspaceScene(); near(ratio(), 0.6);
const count = resized().length;
dock.showWorkspaceScene(); assert.equal(resized().length, count, 'revealing an already visible scene preserves the split');
dock.openTerminalDock('t1'); assert.equal(resized().length, count, 'selecting a resident preserves a partial split');

controls.workspaceCommand('toggle_view'); near(ratio(), 0);
controls.workspaceCommand('toggle_view'); near(ratio(), 0.6);
controls.workspaceCommand('toggle_terminal'); near(ratio(), 1);
controls.workspaceCommand('toggle_terminal'); near(ratio(), 0.6);
controls.workspaceCommand('more_terminal'); near(ratio(), 0.5);
controls.workspaceCommand('more_scene'); near(ratio(), 0.6);
controls.workspaceCommand('not-a-command'); near(ratio(), 0.6);

// User-resized intermediate ratios become the restore point, not the endpoint.
nativeRelease(0.43, 430); near(ratio(), 0.43);
dock.closeTerminalDock(); dock.restoreWorkspaceSplit(); near(ratio(), 0.43);
nativeRelease(0.024, 24); near(ratio(), 0);
dock.restoreWorkspaceSplit(); near(ratio(), 0.43);
nativeRelease(0.976, 976); near(ratio(), 1);
dock.restoreWorkspaceSplit(); near(ratio(), 0.43);
// In a short workspace 24 px is over 5%; real measured sizes still reach zero.
nativeRelease(0.12, 24); near(ratio(), 0);
dock.restoreWorkspaceSplit(); near(ratio(), 0.43);
nativeRelease(0.88, 176); near(ratio(), 1);
dock.restoreWorkspaceSplit(); near(ratio(), 0.43);

// A fresh released snapshot waits for the last resize callback to settle.
find('agent-scene').size = { weight: 0.13 };
find('agent-terminal-dock').size = { weight: 0.87 };
dock.syncWorkspaceSplit();
dock.noteSceneSize(24, cx); now += 80; after.shift().fn(cx);
dock.syncWorkspaceSplit(); near(ratio(), 0.13);
now += 40; dock.syncWorkspaceSplit(); near(ratio(), 0);
// An old measurement cannot collapse an unrelated later ratio.
now += 1500; nativeRelease(0.5); near(ratio(), 0.5);
const stableCommands = commands.length, stableWrites = writes.length;
for (let i = 0; i < 10; i++) { now += 120; dock.syncWorkspaceSplit(); }
assert.equal(commands.length, stableCommands);
assert.equal(writes.length, stableWrites, 'idle controller produces no repeat writes');

// A shell or empty workspace can be opened without an agent address.
dock.closeTerminalDock(); focused = {}; paneList = [];
const noFocus = commands.length;
assert.equal(dock.openTerminalDock(), true); near(ratio(), 0.5);
assert.ok(commands.slice(noFocus).every(([name]) => name === 'layout.resize'));
// Each layout retains its own intermediate ratio.
shared.set('layout', 'other'); dock.closeTerminalDock();
shared.delete('ag.workspaceSplit.other'); dock.restoreWorkspaceSplit(); near(ratio(), 0.6);
shared.set('layout', 'test'); dock.restoreWorkspaceSplit(); near(ratio(), 0.5);
assert.equal(JSON.stringify(find('main')), nativeBefore, 'all operations preserve the original native tab tree');
assert.ok(commands.every(([name]) => !['layout.hide', 'layout.set', 'layout.select'].includes(name)), 'never replace or hide native views');

const toolbar = dock.renderTerminalToolbar();
const ids = elements.map(item => item.calls.get('id')?.[0]).filter(Boolean);
assert.ok(ids.includes('terminal-dock-restore'));
assert.ok(!ids.includes('terminal-dock-compose') && !ids.includes('terminal-dock-image'));
const tooltip = toolbar.calls.get('tooltip')[0];
assert.match(tooltip, /top edge/, 'only the host divider is advertised as draggable');
dock.showWorkspaceTerminal();
toolbar.calls.get('on_mouse_down')[1]({ click_count: 2 }, cx); near(ratio(), 0.5);
controls.initWorkspaceControls(cx);
assert.equal(every.length, 1); assert.equal(every[0].ms, 120);

// Unrelated/custom layouts are not mutated by stale commands.
tree = { id: 'other', type: 'stack', children: [] };
const absent = commands.length;
assert.equal(dock.openTerminalDock(), false); assert.equal(dock.showWorkspaceTerminal(), false);
controls.workspaceCommand('toggle_view'); controls.workspaceCommand('toggle_terminal');
assert.equal(commands.length, absent);
console.log('workspace split: native-tree preservation, exact endpoints, restore, drag-release snapping, debounce, keyboard commands and minimal handle passed');
