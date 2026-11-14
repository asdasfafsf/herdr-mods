// Approval transport is synthetic. Never click or send a real approval here.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const context = vm.createContext({ console, Date });
let live = { address: 't1', state: 'live', created_ms: 1, turn: 4, status_ms: 100,
  foreground: { name: 'codex', pid: 42 }, status: { state: 'blocked', kind: 'permission', app: 'codex', msg: 'Run unit tests?' } };
let screen = { complete: true, text: 'Run unit tests?\n› 1. Yes (y)\n  2. Yes, and do not ask again\n  3. No, tell Codex what to do differently (esc)\nEnter to confirm' };
const commands = [], tasks = [];
let failKeys = false, keyPromise = null;
const cx = { notify() {}, spawn(fn) { const task = fn(cx); tasks.push(task); return task; } };
const exports = {
  herdr: { exec: async (_cmd, args) => {
    commands.push(args);
    if (args[0] === 'get') return { code: 0, stdout: JSON.stringify(live) };
    if (args[0] === 'read') return { code: 0, stdout: JSON.stringify(screen) };
    assert.equal(args[0], 'keys');
    if (keyPromise) return keyPromise;
    return { code: failKeys ? 1 : 0, stdout: '{}' };
  } },
  'gpui-kit': { div() {} }, 'gpui-base': { v_flex() {}, h_flex() {} },
  './ui.js': { button() {} }, './agent-mode.js': { inAgentMode: () => true, agentViewVisible: () => true },
};
const source = new vm.SourceTextModule(readFileSync(new URL('../mods/agents-plus/session-controls.js', import.meta.url), 'utf8'), { context });
await source.link(name => new vm.SyntheticModule(Object.keys(exports[name]), function () {
  for (const [key, value] of Object.entries(exports[name])) this.setExport(key, value);
}, { context }));
await source.evaluate();
const { permissionChoices, requestSnapshot, choosePermission, refreshSession } = source.namespace;
const sent = () => commands.filter(args => args[0] === 'keys');
const chat = { address: 't1' };
refreshSession(chat, cx); await tasks.pop();
assert.equal(sent().length, 0, 'polling never approves');
assert.equal(chat.request.choices.length, 3);
choosePermission(chat, chat.request, 3, cx); await tasks.pop();
assert.deepEqual(Array.from(sent()[0]), ['keys', '--json', '--', 't1', 'down', 'down', 'enter']);
assert.match(chat.actionReceipt, /No, tell Codex/);

for (const change of [() => live.turn++, () => live.status_ms++, () => live.foreground.pid++,
  () => { screen.text = screen.text.replace('unit tests', 'different command'); },
  () => { live.status.kind = 'question'; }, () => { live.state = 'finished'; }]) {
  const savedLive = structuredClone(live), savedScreen = structuredClone(screen);
  const shown = requestSnapshot('t1', live, screen); chat.request = shown;
  change(); const count = sent().length;
  choosePermission(chat, shown, 1, cx); await tasks.pop();
  assert.equal(sent().length, count, 'changed or unavailable requests never send keys');
  assert.match(chat.actionError, /request changed/);
  live = savedLive; screen = savedScreen;
}

for (const kind of ['question', 'auth', null]) {
  assert.equal(requestSnapshot('t1', { ...live, status: { ...live.status, kind } }, screen), null);
}
assert.equal(requestSnapshot('t1', live, { ...screen, complete: false }), null);
assert.equal(permissionChoices('1. update config\n2. restart app').length, 0);
assert.equal(permissionChoices('1. Yes\n2. No').length, 0, 'an unknown cursor is not guessed');
const claude = { ...live, foreground: { name: 'claude', pid: 54 }, status: { ...live.status, app: 'claude' } };
assert.equal(requestSnapshot('t2', claude, { complete: true, text: '❯ 1. Yes\n  2. Yes, allow this command\n  3. No' }).choices.length, 3);

failKeys = true;
chat.request = requestSnapshot('t1', live, screen);
choosePermission(chat, chat.request, 1, cx); await tasks.pop();
assert.match(chat.actionError, /uncertain/); assert.equal(chat.request, null);
const count = sent().length;
refreshSession(chat, cx); await tasks.pop(); assert.equal(sent().length, count, 'polling never retries a failed decision');

let resolveKeys;
keyPromise = new Promise(resolve => { resolveKeys = resolve; });
const displayed = requestSnapshot('t1', live, screen); chat.request = displayed;
choosePermission(chat, displayed, 1, cx);
choosePermission(chat, displayed, 1, cx);
await new Promise(setImmediate);
assert.equal(sent().length, count + 1, 'double clicks send once');
resolveKeys({ code: 0, stdout: '{}' }); await tasks.pop();
console.log('session controls: Codex/Claude choices, request identity, stale requests, read-only polling, failure handling and duplicate clicks passed');
