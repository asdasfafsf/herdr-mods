// Approval transport is synthetic. Never click or send a real approval here.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const context = vm.createContext({ console, Date });
let live = { address: 't1', state: 'live', created_ms: 1, turn: 4, status_ms: 100,
  foreground: { name: 'codex', pid: 42 }, status: { state: 'blocked', kind: 'permission', app: 'codex', msg: 'Run unit tests?' } };
let screen = { complete: true, text: 'Run unit tests?\n› 1. Yes (y)\n  2. Yes, and do not ask again\n  3. No, tell Codex what to do differently (esc)\nEnter to confirm' };
const commands = [], tasks = [];
let failKeys = false, keyPromise = null, nextRead = null, visible = true;
const timers = new Map();
const cx = { notify() {}, timer: { every(ms, fn) { timers.set(ms, fn); } }, spawn(fn) { const task = fn(cx); tasks.push(task); return task; } };
const exports = {
  herdr: { exec: async (_cmd, args) => {
    commands.push(args);
    if (args[0] === 'get') return { code: 0, stdout: JSON.stringify(live) };
    if (args[0] === 'read') { const pending = nextRead; nextRead = null; return pending || { code: 0, stdout: JSON.stringify(screen) }; }
    assert.equal(args[0], 'keys');
    if (keyPromise) return keyPromise;
    return { code: failKeys ? 1 : 0, stdout: '{}' };
  } },
  'gpui-kit': { div() {} }, 'gpui-base': { v_flex() {}, h_flex() {} },
  './ui.js': { button() {} }, './agent-mode.js': { inAgentMode: () => true, agentViewVisible: () => visible },
};
const source = new vm.SourceTextModule(readFileSync(new URL('../mods/agents-plus/session-controls.js', import.meta.url), 'utf8'), { context });
const providers = new vm.SourceTextModule(readFileSync(new URL('../mods/agents-plus/approval-providers.js', import.meta.url), 'utf8'), { context });
await source.link(name => name === './approval-providers.js' ? providers : new vm.SyntheticModule(Object.keys(exports[name]), function () {
  for (const [key, value] of Object.entries(exports[name])) this.setExport(key, value);
}, { context }));
await source.evaluate();
const { permissionChoices, requestSnapshot, choosePermission, refreshSession, initSessionControls } = source.namespace;
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
  live.status_ms++;
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
const claude = { ...live, address: 't2', foreground: { name: 'claude', pid: 54 }, status: { ...live.status, app: 'claude' } };
assert.equal(requestSnapshot('t2', claude, { complete: true, text: '❯ 1. Yes\n  2. Yes, allow this command\n  3. No' }).choices.length, 3);

failKeys = true;
live.status_ms++;
chat.request = requestSnapshot('t1', live, screen);
choosePermission(chat, chat.request, 1, cx); await tasks.pop();
assert.match(chat.actionError, /uncertain/); assert.equal(chat.request, null);
const count = sent().length;
refreshSession(chat, cx); await tasks.pop(); assert.equal(sent().length, count, 'polling never retries a failed decision');
assert.equal(chat.request, null, 'an uncertain request stays suppressed');
screen.text = screen.text.replace('unit tests', 'unit checks'); chat.refreshedAt = 0;
refreshSession(chat, cx); await tasks.pop(); assert.equal(chat.request, null, 'screen redraw cannot revive an attempted request');

let resolveKeys;
keyPromise = new Promise(resolve => { resolveKeys = resolve; });
live.status_ms++;
const displayed = requestSnapshot('t1', live, screen); chat.request = displayed;
choosePermission(chat, displayed, 1, cx);
choosePermission(chat, displayed, 1, cx);
await new Promise(setImmediate);
assert.equal(sent().length, count + 1, 'double clicks send once');
resolveKeys({ code: 0, stdout: '{}' }); await tasks.pop();
keyPromise = null; failKeys = false;

for (const [name, marker] of [['codex','›'],['claude','❯'],['gemini','●']]) {
  const snapshot=requestSnapshot('t1',{...live,foreground:{name,pid:42},status:{...live.status,app:name}},
    {complete:true,text:`Run the command?\n${marker} 1. Allow once\n  2. Yes, and do not ask again for commands starting with\n     npm run lengthy-target\n  3. No\nEnter to confirm`});
  assert.equal(snapshot.choices.length,3,name);
  assert.match(snapshot.choices[1].label,/starting with npm run lengthy-target/);
  assert.deepEqual(Array.from(providers.namespace.approvalAdapter({foreground:{name},status:{app:name}}).keys(snapshot,3)),['down','down','enter']);
}
for(const text of ['› 1. Yes\n  2. No\nA different prompt is now active', '› 1. Yes\nSome unrelated text\n  2. No', '› 1. Yes\n❯ 2. No'])
  assert.equal(permissionChoices(text).length,0,'ambiguous or historical menus are rejected');
assert.equal(permissionChoices('│ \u001b[32m› 1. Yes\u001b[0m │\n│   2. No │').length,2);
for(const foreground of ['zsh','node','other-cli']) assert.equal(requestSnapshot('t1',{...live,foreground:{name:foreground,pid:42}},screen),null);
assert.equal(requestSnapshot('t1',{...live,status:{...live.status,app:'claude'}},screen),null);
for(const field of ['created_ms','turn','status_ms']) assert.equal(requestSnapshot('t1',{...live,[field]:null},screen),null);

// The controller can consume a new provider without changing either view.
providers.namespace.APPROVAL_ADAPTERS.push(providers.namespace.numberedApprovalAdapter({id:'fixture-cli'}));
assert.equal(requestSnapshot('t1',{...live,foreground:{name:'fixture-cli',pid:42},status:{...live.status,app:'fixture-cli'}},screen).provider,'fixture-cli');

live.status_ms++;
const racing={address:'t1',request:requestSnapshot('t1',live,screen)};
let releaseRead; nextRead=new Promise(resolve=>{releaseRead=resolve;});
refreshSession(racing,cx); const pendingRefresh=tasks.pop();
choosePermission(racing,racing.request,1,cx); await tasks.pop();
releaseRead({code:0,stdout:JSON.stringify(screen)});await pendingRefresh;
assert.equal(racing.request,null,'a late refresh cannot restore an already attempted request');

const view={villageSelected:'selected',visibleOverviewRows:[
  {id:'unselected',address:'t1',status:'blocked'},
  {id:'selected',address:'t2',status:'working'},
  {id:'external',address:'external',external:true,status:'blocked'},
]};
initSessionControls(view,cx,()=>false);
let before=commands.length;timers.get(2000)(cx);await Promise.all(tasks.splice(0));
assert.deepEqual(commands.slice(before).map(args=>[args[0],args.at(-1)]),[['get','t1'],['read','t1']]);
assert.equal(view.villageSelected,'selected');assert.ok(view.villageChats.get('unselected').request);
visible=false;before=commands.length;timers.get(2000)(cx);assert.equal(commands.length,before,'hidden scenes do not poll');
visible=true;view.visibleOverviewRows=[];timers.get(2000)(cx);assert.equal(commands.length,before,'filtered/page-hidden rows do not poll');
console.log('session controls: provider adapters, wrapped menus, lifecycle identity, polling scope, stale reads, uncertain sends and duplicate clicks passed');
