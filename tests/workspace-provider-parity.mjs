// Source modules + in-memory transports only. No app, native checker, CLI,
// network, real session input or reset/redemption module is loaded here.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

async function fixture(program, provider = program, customize) {
  let now = 10000, dock, focus = { terminal: 'target', pane: 'target-pane', tab: 'original-tab' };
  const state = new Map([['layout', 'provider-workspace'], ['ag.presentation', 'village'], ['ag.resourcePack', 'chiikawa']]);
  const tree = { id: 'workspace-views', type: 'column', theme: 'moss', children: [
    { id: 'agent-scene', size: { weight: 1 } },
    { id: 'agent-terminal-dock', size: { weight: 0 }, children: [
      { id: 'agent-terminal-surface', children: [
        { id: 'main', type: 'block', content: { tab: 'active', pane: { gap: 7, header: { height: 34 } } } },
      ] },
    ] },
  ] };
  const panes = [
    { pane: 'target-pane', terminal: 'target', tab: 'original-tab', program: { key: provider, name: program, agent: true } },
    { pane: 'other-pane', terminal: 'other-provider', tab: 'other-tab', program: { key: 'other-cli', agent: true } },
  ];
  const live = { address: 'target', state: 'live', created_ms: 1, turn: 3, status_ms: 100,
    foreground: { name: program, pid: 42 },
    status: { state: 'blocked', kind: 'permission', app: provider, msg: 'Run the fixture command?' } };
  // Deliberately synthetic grammar, not a claim to capture a current CLI screen.
  const screen = { complete: true, text: 'Run the fixture command?\n❯ 1. Allow once\n  2. Yes, allow all future fixture commands\n  3. No\nEnter to confirm' };
  customize?.(live, screen);
  const native = [], transport = [], nodes = [], tasks = [], timers = new Map();
  let keyReply = () => ({ code: 0, stdout: '{}' });
  const find = (id, node = tree) => node?.id === id ? node : node?.children?.map(child => find(id, child)).find(Boolean);
  function element() {
    const node = { calls: new Map(), contents: [] };
    const proxy = new Proxy(node, { get(target, key) {
      if (key === 'then') return undefined;
      if (key in target) return target[key];
      return (...args) => {
        if (key === 'when') return args[0] ? args[1](proxy) : proxy;
        node.calls.set(key, args);
        if (key === 'child') node.contents.push(args[0]);
        if (key === 'children') node.contents.push(...args[0]);
        return proxy;
      };
    } });
    nodes.push(node); return proxy;
  }
  const host = {
    layout: () => tree, shared: key => structuredClone(state.get(key)),
    setShared(key, value) {
      assert.match(key, /^ag\.workspace(?:Presentation|SceneSize)\.provider-workspace$/, 'presentation cannot rewrite provider, permission or pack settings');
      state.set(key, structuredClone(value));
    },
    focused: () => ({ ...focus }), panes: () => structuredClone(panes), theme: () => ({}),
    nextCommand: () => new Promise(() => {}),
    run(name, args) {
      native.push([name, structuredClone(args)]);
      if (name === 'layout.resize') find(args.id).size = { weight: args.weight };
      else if (name === 'layout.show') find(args.id).hidden = false;
      else if (name === 'pane.focus') {
        const pane = panes.find(item => item.pane === args.pane);
        assert.ok(pane, 'focus must resolve an existing pane');
        focus = { terminal: pane.terminal, pane: pane.pane, tab: pane.tab };
      } else assert.fail(`Unexpected native action: ${name}`);
    },
    async exec(command, args) {
      assert.equal(command, 'hc');
      transport.push(Array.from(args));
      assert.ok(['get', 'read', 'keys'].includes(args[0]), `Unexpected transport: ${args[0]}`);
      assert.equal(args[args.indexOf('--') + 1], 'target', 'approval always targets its displayed session');
      if (args[0] === 'get') return { code: 0, stdout: JSON.stringify(live) };
      if (args[0] === 'read') {
        assert.deepEqual(Array.from(args), ['read', '--json', '--lines', '0', '--', 'target']);
        return { code: 0, stdout: JSON.stringify(screen) };
      }
      return keyReply();
    },
  };
  const context = vm.createContext({ Date: class extends Date { static now() { return now; } } });
  const imports = {
    herdr: host, 'gpui-kit': { div: element }, 'gpui-base': { h_flex: element, v_flex: element },
    './ui.js': { button: element },
    './agent-mode.js': { inAgentMode: () => true, agentViewVisible: () => dock.sceneVisible(), requestAgentSelection() {} },
  };
  const modules = new Map();
  const allowed = new Set(['./terminal-dock.js', './workspace-controls.js', './session-controls.js', './approval-providers.js']);
  async function load(name) {
    if (modules.has(name)) return modules.get(name);
    let module;
    if (imports[name]) module = new vm.SyntheticModule(Object.keys(imports[name]), function () {
      for (const [key, value] of Object.entries(imports[name])) this.setExport(key, value);
    }, { context });
    else {
      assert.ok(allowed.has(name), `Unexpected module: ${name}`);
      module = new vm.SourceTextModule(readFileSync(new URL(`../mods/agents-plus/${name.slice(2)}`, import.meta.url), 'utf8'), { context });
    }
    modules.set(name, module); await module.link(load); return module;
  }
  for (const name of allowed) { const module = await load(name); await module.evaluate(); }
  dock = modules.get('./terminal-dock.js').namespace;
  const controls = modules.get('./workspace-controls.js').namespace;
  const session = modules.get('./session-controls.js').namespace;
  const providers = modules.get('./approval-providers.js').namespace;
  const cx = { notify() {}, stop_propagation() {}, timer: { every(ms, fn) { timers.set(ms, fn); } },
    spawn(fn) { tasks.push(fn(cx)); } };
  const row = { id: 'target', address: 'target', status: 'blocked' };
  const view = { villageSelected: row.id, visibleOverviewRows: [row], handle: { focus() {} } };
  const chat = session.sessionState(view, row);
  chat.draft = 'Retained private fixture draft';
  dock.restoreWorkspacePresentation(); session.initSessionControls(view, cx, () => false);
  const drain = async () => { while (tasks.length) await Promise.all(tasks.splice(0)); };
  const poll = async () => { now += 2000; timers.get(2000)(cx); await drain(); };
  const keys = () => transport.filter(args => args[0] === 'keys');
  function button(number) {
    nodes.length = 0; session.renderInlinePermission(chat, {}, 'fixture');
    const target = nodes.find(node => node.calls.get('id')?.[0] === `fixture-choice-${number}`);
    assert.ok(target?.calls.get('on_click'), `missing explicit choice ${number}`);
    return () => target.calls.get('on_click')[0]({}, cx);
  }
  return { controls, dock, session, providers, tree, find, state, view, chat, live, screen, native, transport, nodes,
    poll, drain, keys, button, focus: () => ({ ...focus }), keyReply: fn => { keyReply = fn; } };
}

const profiles = [['codex', 'codex'], ['claude', 'claude'], ['claude-code', 'claude'],
  ['/usr/local/bin/claude', 'claude'], ['gemini', 'gemini'], ['gemini-cli', 'gemini']];
for (const [program, provider] of profiles) {
  const env = await fixture(program, provider);
  await env.poll();
  assert.equal(env.chat.request.provider, provider);
  const originalRequest = env.chat.request.fingerprint, originalNative = JSON.stringify(env.find('agent-terminal-surface'));
  const cycle = () => env.controls.workspaceCommand('toggle_view');
  for (let index = 0; index < 30; index++) {
    cycle();
    const mode = ['split', 'terminal', 'scene'][index % 3];
    assert.equal(env.dock.workspacePresentation().mode, mode);
    const reads = env.transport.length; await env.poll();
    if (mode === 'terminal') assert.equal(env.transport.length, reads, 'hidden scene does not poll approvals');
    else assert.equal(env.transport.length, reads + 2, 'visible blocked resident only reads facts and screen');
    assert.equal(env.chat.request.fingerprint, originalRequest);
    assert.equal(env.keys().length, 0, 'cycling and polling never choose a permission');
    assert.deepEqual(env.focus(), { terminal: 'target', pane: 'target-pane', tab: 'original-tab' });
    assert.equal(env.view.villageSelected, 'target');
    assert.equal(env.chat.draft, 'Retained private fixture draft');
    assert.equal(env.state.get('layout'), 'provider-workspace');
    assert.equal(env.state.get('ag.presentation'), 'village');
    assert.equal(env.state.get('ag.resourcePack'), 'chiikawa');
    assert.equal(env.tree.theme, 'moss');
    assert.equal(JSON.stringify(env.find('agent-terminal-surface')), originalNative);
  }

  // Clicking an unselected resident's denial still addresses its request,
  // including when Cmd+E runs during the in-flight synthetic transport.
  const deny = env.button(3);
  env.dock.openTerminalDock('other-provider');
  let releaseKeys;
  env.keyReply(() => new Promise(resolve => { releaseKeys = resolve; }));
  const nativeBefore = env.native.length;
  deny(); deny();
  for (let index = 0; index < 12 && !releaseKeys; index++) await Promise.resolve();
  assert.ok(releaseKeys, 'explicit click reaches the synthetic transport');
  assert.equal(env.native.length, nativeBefore, 'permission click never changes focus');
  for (let index = 0; index < 12; index++) cycle();
  assert.equal(env.focus().terminal, 'other-provider', 'cycle retains the independently selected provider');
  assert.deepEqual(env.keys(), [['keys', '--json', '--', 'target', 'down', 'down', 'enter']]);
  releaseKeys({ code: 0, stdout: '{}' }); await env.drain();
  assert.equal(env.chat.request, null); assert.equal(env.chat.actionReceipt, 'Sent: No');
  env.dock.setWorkspacePresentation('scene'); await env.poll();
  assert.equal(env.keys().length, 1, 'completed decision is not replayed after a cycle');

  // Every shipped adapter retains the same freshness checks before a choice.
  const staleCases = [
    live => { live.turn++; }, live => { live.status_ms++; }, live => { live.foreground.pid++; },
    live => { live.status.app = 'other-cli'; }, live => { live.status.kind = 'question'; },
    live => { live.address = 'other-provider'; }, live => { live.state = 'finished'; },
    (_live, screen) => { screen.text = screen.text.replace('fixture command?', 'different command?'); },
  ];
  env.keyReply(() => ({ code: 0, stdout: '{}' }));
  for (const change of staleCases) {
    env.live.status_ms++; await env.poll();
    const click = env.button(1), savedLive = structuredClone(env.live), savedScreen = { ...env.screen };
    const before = env.keys().length;
    change(env.live, env.screen); cycle(); click(); await env.drain();
    assert.equal(env.keys().length, before, 'changed provider/request cannot receive a stale decision');
    assert.match(env.chat.actionError, /request changed/);
    Object.assign(env.live, savedLive); Object.assign(env.screen, savedScreen);
    env.dock.setWorkspacePresentation('scene');
  }

  env.live.status_ms++; await env.poll();
  env.keyReply(() => ({ code: 1, stdout: '{}' }));
  const before = env.keys().length;
  env.button(1)(); await env.drain();
  assert.match(env.chat.actionError, /uncertain/);
  for (let index = 0; index < 9; index++) { cycle(); await env.poll(); }
  assert.equal(env.keys().length, before + 1, 'uncertain permission is never retried by mode changes');
  assert.equal(env.chat.request, null);
  console.log(`PASS ${program}: 30 cycles, same workspace/focus, explicit target, 8 stale cases, no automatic decision/retry`);
}

const unsupported = [
  ['unknown-cli', 'unknown-cli'], ['zsh', 'claude'], ['node', 'gemini'],
  ['claude', 'claude', live => { live.status = {}; }],
  ['gemini', 'gemini', live => { delete live.turn; }],
  ['codex', 'codex', live => { live.status.kind = 'auth'; }],
  ['claude', 'claude', (_live, screen) => { screen.complete = false; }],
];
for (const [program, provider, customize] of unsupported) {
  const env = await fixture(program, provider, customize);
  await env.poll(); assert.equal(env.chat.request, null);
  env.session.renderInlinePermission(env.chat, {}, 'fallback');
  assert.ok(env.nodes.some(node => node.contents.includes('Use the terminal for this request.')));
  assert.ok(!env.nodes.some(node => /^fallback-choice-/.test(node.calls.get('id')?.[0])));
  for (let index = 0; index < 9; index++) env.controls.workspaceCommand('toggle_view');
  assert.equal(env.dock.workspacePresentation().mode, 'scene');
  assert.equal(env.focus().terminal, 'target'); assert.equal(env.keys().length, 0);
}

const extension = await fixture('fixture-cli');
extension.providers.APPROVAL_ADAPTERS.push(extension.providers.numberedApprovalAdapter({ id: 'fixture-cli' }));
await extension.poll(); assert.equal(extension.chat.request.provider, 'fixture-cli');
for (let index = 0; index < 9; index++) extension.controls.workspaceCommand('toggle_view');
assert.equal(extension.focus().terminal, 'target'); assert.equal(extension.keys().length, 0);
console.log('PASS 7 unsupported/lifecycle fallbacks and synthetic adapter extension; no real provider or native verification');
