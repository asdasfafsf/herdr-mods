// Synthetic render regression/benchmark; no Herdr state, processes or user data.
// node --experimental-vm-modules tests/agents-render.mjs [--before GIT_REF]
// Builders record descriptions; times are Node mock times, not native GPUI frame times.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import vm from 'node:vm';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
const root = resolve(import.meta.dirname, '..');
const ref = process.argv[process.argv.indexOf('--before') + 1];
const before = process.argv.includes('--before') ? ref : null;
const now = 1893456000000;
function fixture(count, grouped = false, collapsed = false, depth = 1) {
  const state = { 'wt.trees': {}, 'wt.meta': {}, 'ag.acked': {}, 'hm.options': {}, 'agents.sort': grouped ? 'grouped' : 'priority' };
  const agents = [], spaces = [], panes = [], terminals = [], outside = [];
  for (let i = 0; i < count; i++) {
    const repo = i % 9, path = `/example/repo-${repo}/work-${i}`, space = `s${i}`, tab = `b${i}`, address = `t${i}`;
    (state['wt.trees'][repo] ??= { name: `repo-${repo}`, checkouts: [] }).checkouts.push({ path, space, main: i < 9, branch: `branch-${i}` });
    state['wt.meta'][JSON.stringify([null, path])] = { name: `작업 ${i}` };
    const program = { name: 'Claude', key: 'claude', agent: true, icon: 'icons/claude.svg' };
    agents.push({ address, space, tab, pane: `p${i}`, status: ['working', 'done', 'idle', 'blocked'][i % 4], space_name: `작업 ${i % 7}`, title: `Task ${i}`, program, seq: i, focused: i === 0, pinned: i === 2 });
    spaces.push({ id: space, tabs: [{ id: tab, name: String(i % 3), named: false }], folder: path });
    panes.push({ id: `p${i}`, tab, terminal: address, cwd: path, program, title: `Task ${i}`, focused: i === 0 });
    terminals.push({ address, state: 'live', program });
    if (i % 5 === 0) for(let level=0;level<depth;level++) terminals.push({ address: `child-${i}-${level}`, parent: level ? `child-${i}-${level-1}` : address, state: 'live', status: level===depth-1 && depth>1 ? 'blocked' : 'working', program });
    if (i % 3 === 0) outside.push({ agent: 'codex', pid: 1000+i, cwd: path + '/src', app: 'Example', title: `Outside ${i}`, status: 'working', updated: i });
    if (i % 4 === 1) state['ag.acked'][address] = now-1000;
  }
  return { state, agents, spaces, panes, terminals, outside, collapsed };
}
async function environment(data, revision) {
  const calls = {}, writes = [], handlers = new Map();
  const cloneRead = (key, value) => {
    calls[key] = (calls[key] ?? 0)+1;
    const copy=structuredClone(value);
    if (key==='terminals') copy.filter=(fn,...args)=>{
      calls.terminal_filter_items=(calls.terminal_filter_items??0)+copy.length;
      return Array.prototype.filter.call(copy,fn,...args);
    };
    return copy;
  };
  function builder(type, initial) {
    const node = { type, initial, ops: [] };
    const proxy = new Proxy(node, { get(target, key) {
      if (key === 'then') return undefined;
      if (key === 'toJSON') return () => node;
      if (key === 'when') return (condition, fn) => condition ? fn(proxy) : proxy;
      if (typeof key === 'symbol') return target[key];
      if (key in target) return target[key];
      return (...args) => {
        if (key === 'hover') { const style = builder('hover'); args[0](style); node.ops.push([key, style]); }
        else {
          if (key === 'on_click') handlers.set(node.ops.find(([k])=>k==='id')?.[1]?.[0],args[0]);
          node.ops.push([key, args.map(v => typeof v === 'function' ? '[callback]' : v)]);
        }
        return proxy;
      };
    }});
    return proxy;
  }
  const theme = Object.fromEntries(['foreground','muted','dim','raised','hover','input','chrome','border','working','blocked','done','idle','accent','selected','ansi5'].map(k => [k, '#123456']));
  const host = {
    agents: () => cloneRead('agents', data.agents), terminals: () => cloneRead('terminals', data.terminals), panes: () => cloneRead('panes', data.panes), spaces: () => cloneRead('spaces', data.spaces),
    shared: key => cloneRead(`shared:${key}`, data.state[key]), setShared: (key, value) => { data.state[key] = structuredClone(value); writes.push([key,value]); },
    setAgentOrder: value => writes.push(['setAgentOrder',value]),
    focused: () => ({agent:'t0',tab:'b0'}), layout: () => ({id:'sidebar',size:{px:data.collapsed ? 76 : 268}}), props: () => ({}), theme: () => theme, window: () => ({active:true}),
    run: (...args) => writes.push(['run',args]), openOverlay() {}, closeOverlay() {}, exec: async (...args) => data.execHook ? data.execHook(...args) : ({code:0,stdout:'[]'}), appHome: () => '/example/app', home: () => '/example', readTextFile: async () => '',
  };
  const store = new Map();
  const context = vm.createContext({ console, Date: class extends Date { static now() { return now; } }, localStorage: { getItem:k => store.get(k), setItem:(k,v) => store.set(k,v), removeItem:k => store.delete(k) } });
  const modules = new Map();
  const synthetic = (id, exports) => new vm.SyntheticModule(Object.keys(exports), function() { for(const [k,v] of Object.entries(exports)) this.setExport(k,v); }, {context,identifier:id});
  modules.set('herdr',synthetic('herdr',host));
  modules.set('gpui-kit',synthetic('gpui-kit',{View:class {},div:()=>builder('div'),image:s=>builder('image',s),svg:s=>builder('svg',s)}));
  modules.set('gpui-base',synthetic('gpui-base',{h_flex:()=>builder('h_flex'),v_flex:()=>builder('v_flex')}));
  function module(file) {
    if (modules.has(file)) return modules.get(file);
    const text = revision ? execFileSync('git',['show',`${revision}:${file}`],{cwd:root,encoding:'utf8'}) : readFileSync(resolve(root,file),'utf8');
    const result = new vm.SourceTextModule(text,{context,identifier:file}); modules.set(file,result); return result;
  }
  const main = module('mods/agents-plus/main.js');
  await main.link((specifier, parent) => {
    if (modules.has(specifier)) return modules.get(specifier);
    let file = resolve(root,dirname(parent.identifier),specifier).slice(root.length+1);
    if (existsSync(resolve(root,'lib',specifier))) file = 'lib/'+specifier.replace('./','');
    return module(file);
  });
  await main.evaluate();
  const instance = new main.namespace.default();
  const cx = {spawn(){},timer:{every(){}},notify(){},stop_propagation(){}};
  instance.init({},cx); instance.outside=data.outside;
  instance.activity=Object.fromEntries(data.agents.map(a=>[a.address,{doing:'Editing example',said:'Example result'}]));
  const render = () => { handlers.clear(); return JSON.parse(JSON.stringify(instance.render(cx))); };
  const click = id => { assert.ok(handlers.has(id),`missing click target ${id}`); handlers.get(id)({},cx); };
  return {instance,calls,writes,render,data,click,ui:modules.get('lib/ui.js').namespace,state:modules.get('lib/state.js').namespace};
}
for (const [name,count,grouped,collapsed,depth] of [['normal',40,false,false,1],['grouped',40,true,false,1],['rail',40,false,true,1],['large',200,false,false,1],['deep',120,false,false,5]]) {
  const data = fixture(count,grouped,collapsed,depth);
  const current = await environment(structuredClone(data),null);
  const output = current.render();
  const firstCalls = {...current.calls};
  const firstWrites = JSON.parse(JSON.stringify(current.writes));
  const samples=[];
  for(let i=0;i<7;i++) { const start=performance.now(); current.render(); samples.push(performance.now()-start); }
  if (before) {
    const previous = await environment(structuredClone(data),before);
    assert.deepEqual(output,previous.render(),`${name}: rendered description changed`);
    assert.deepEqual(firstWrites,JSON.parse(JSON.stringify(previous.writes)),`${name}: commands/shared writes changed`);
    const oldCalls = {...previous.calls};
    const oldSamples=[];
    for(let i=0;i<7;i++) { const start=performance.now(); previous.render(); oldSamples.push(performance.now()-start); }
    console.log(name,'before',JSON.stringify(oldCalls),'mock_median_ms',oldSamples.sort((a,b)=>a-b)[3].toFixed(2));
    // A metadata edit must be visible next render; compare both implementations again.
    for (const env of [current, previous]) {
      env.data.state['wt.meta'][JSON.stringify([null,'/example/repo-0/work-0'])]={name:'Changed'};
      env.data.panes[0].title='Changed title';
      env.data.state['hm.options'].agentsRepoNames=false;
    }
    assert.deepEqual(current.render(),previous.render(),`${name}: changes became stale`);
    const mutations = [
      env => { env.data.state['hm.options']={seen:false,agentsNews:false,agentsRepoNames:true}; },
      env => { env.data.state['hm.options']={seen:true,seenMinutes:5}; env.instance.seen.t2=now-600000; },
      env => { env.data.state['wt.repoColors']={'0':'#abcdef'}; env.data.state['space.colors']={s1:'ansi3'}; },
      env => { env.data.state['hm.options']={repoNames:false,agentNews:false}; },
      env => { env.data.state['hm.options']={}; env.data.state['ag.acked']={}; },
      env => { env.data.terminals.find(t=>t.address==='child-0-0').state='exited'; },
      env => { const child=env.data.terminals.find(t=>t.address==='child-0-0'); child.state='live';child.parent='t2';child.status='blocked'; },
      env => { env.data.terminals.push({address:'new-child',parent:'t0',state:'live',status:'done',program:env.data.terminals[0].program}); },
    ];
    for (const [i,mutate] of mutations.entries()) {
      mutate(current); mutate(previous);
      assert.deepEqual(current.render(),previous.render(),`${name}: settings mutation ${i} changed output`);
    }
    if (!collapsed && !grouped) {
      current.click('ack-all-sec-3' /* priority header */);
      previous.click('ack-all-sec-3');
      assert.deepEqual(current.data.state['ag.acked'],previous.data.state['ag.acked'],`${name}: ack write differs`);
      assert.deepEqual(current.data.state['ag.info'],previous.data.state['ag.info'],`${name}: click published stale ack`);
      assert.deepEqual(current.render(),previous.render(),`${name}: ack not reflected`);
    }
    // Starting work clears a prior ack, even though the render began with that ack.
    current.data.agents[1].status=previous.data.agents[1].status='working';
    assert.deepEqual(current.render(),previous.render(),`${name}: ack cleanup differs`);
    assert.ok(!('t1' in current.data.state['ag.acked']));
  }
  if (!collapsed) {
    current.data.state['wt.meta'][JSON.stringify([null,'/example/repo-0/work-0'])]={name:'NEW-METADATA'};
    current.data.panes[0].title='NEW-PANE-TITLE';
    const refreshed=JSON.stringify(current.render());
    assert.ok(refreshed.includes('NEW-METADATA'),`${name}: outside name did not refresh`);
    assert.ok(refreshed.includes('NEW-PANE-TITLE'),`${name}: pane title did not refresh`);
  }
  for (const key of ['hm.options','ag.acked']) assert.equal(firstCalls[`shared:${key}`],1,`${name}: ${key} reads grew with row count`);
  if (!collapsed) for (const key of ['wt.repoColors','space.colors']) assert.equal(firstCalls[`shared:${key}`],1,`${name}: color reads grew with row count`);
  // Existing library callers may omit snapshots. Explicit and live settings agree.
  const opts=current.data.state['hm.options'];
  for (const status of ['done','idle','working','blocked']) {
    const info={acked:now-60000,seen:now-60000};
    assert.equal(current.ui.shownStatus(status,info,now),current.ui.shownStatus(status,info,now,current.ui.seenFor(opts)));
  }
  assert.ok(firstCalls.terminal_filter_items<=data.terminals.length,`${name}: recursive full terminal scans returned`);
  assert.equal(firstCalls.panes,1,`${name}: pane reads must not grow with row count`);
  assert.equal(firstCalls['shared:wt.trees'],1,`${name}: tree reads must not grow with row count`);
  console.log(name,'after',JSON.stringify(firstCalls),'mock_median_ms',samples.sort((a,b)=>a-b)[3].toFixed(2));
}

// Persistence stays outside render, avoids redraws, serializes writers, and retries
// one bounded failed batch without losing the new aggregate collected meanwhile.
{
  const env = await environment(fixture(4),null);
  const tasks = [], commands = [];
  const cx = { spawn: fn => tasks.push(fn({})), notify: () => assert.fail('telemetry redraw') };
  let complete;
  env.data.execHook = (...args) => { commands.push(args); return new Promise(resolve => {complete=resolve}); };
  env.render();
  assert.equal(commands.length,0,'render must not execute a writer');
  const writes = JSON.stringify(env.writes);
  env.instance.flushRenderProfile(cx);
  env.instance.flushRenderProfile(cx);
  assert.equal(commands.length,1,'one writer at a time');
  complete({code:1});
  await tasks.pop();
  assert.equal(JSON.stringify(env.writes),writes,'flush must not change shared state');
  const retry = env.instance.profileBatch;
  assert.ok(retry);
  env.render();
  const afterRender = JSON.stringify(env.writes);
  env.instance.flushRenderProfile(cx);
  assert.equal(env.instance.profileBatch,retry);
  complete({code:0});
  await tasks.pop();
  assert.equal(env.instance.profileBatch,null);
  env.instance.flushRenderProfile(cx);
  assert.equal(commands.length,3);
  complete({code:0});
  await tasks.pop();
  assert.equal(JSON.parse(commands[0][1].at(-1)).completed,1);
  assert.equal(JSON.parse(commands[2][1].at(-1)).completed,1);
  assert.equal(JSON.stringify(env.writes),afterRender,'retry must not change shared state');
  console.log('profile writer: no render I/O, overlap suppression and retry passed');
}

// Optional native GPUI smoke/limit check with the SAME synthetic data. No live app
// state is read, and these temporary mods are never installed in the user's layout.
if (process.argv.includes('--native')) {
  for (const [count,depth] of [[40,1],[200,1],[120,5]]) for (const revision of before ? [before,null] : [null]) {
    const directory=mkdtempSync(resolve(tmpdir(),'herdr-agents-bench-'));
    try {
      const read=file=>revision ? execFileSync('git',['show',`${revision}:${file}`],{cwd:root,encoding:'utf8'}) : readFileSync(resolve(root,file),'utf8');
      for (const name of ['state','ui','resume','places']) writeFileSync(resolve(directory,`${name}.js`),read(`lib/${name}.js`).replaceAll('from "herdr"','from "./mock-herdr.js"'));
      writeFileSync(resolve(directory,'agents.js'),read('mods/agents-plus/main.js').replaceAll('from "herdr"','from "./mock-herdr.js"'));
      if (!revision || execFileSync('git',['ls-tree',revision,'mods/agents-plus/render-profile.js'],{cwd:root,encoding:'utf8'}).trim())
        writeFileSync(resolve(directory,'render-profile.js'),read('mods/agents-plus/render-profile.js'));
      const data=fixture(count,false,false,depth);
      writeFileSync(resolve(directory,'mock-herdr.js'),`
const data=${JSON.stringify(data)};
const copy=x=>JSON.parse(JSON.stringify(x??null));
export const agents=()=>copy(data.agents), terminals=()=>copy(data.terminals), spaces=()=>copy(data.spaces), panes=()=>copy(data.panes);
export const shared=k=>copy(data.state[k]), setShared=(k,v)=>{data.state[k]=v}, setAgentOrder=()=>{};
export const focused=()=>({agent:'t0',tab:'b0'}), layout=()=>({id:'sidebar',size:{px:268}}), props=()=>({}), window=()=>({active:true});
export const theme=()=>Object.fromEntries(['foreground','muted','dim','raised','hover','input','chrome','border','working','blocked','done','idle','accent','selected','ansi5'].map(k=>[k,'#123456']));
export const run=()=>{},openOverlay=()=>{},closeOverlay=()=>{},exec=async()=>({code:0,stdout:'[]'}),appHome=()=>'/example/app',home=()=>'/example',readTextFile=async()=>'';
export const outside=data.outside;
`);
      writeFileSync(resolve(directory,'main.js'),`
import Agents from './agents.js';
import { outside } from './mock-herdr.js';
export default class Probe extends Agents {
 init() { this.folded=new Set();this.outside=outside;this.changed={};this.seen={};this.raw=new Map();this.pendingPins=[];this.migratingPins=new Set();this.activity={}; }
 render(cx) { const start=Date.now();const result=super.render(cx);console.error('BENCH_RENDER_MS='+String(Date.now()-start));return result; }
}
`);
      const result=spawnSync('herdr-app',['check',directory],{encoding:'utf8',timeout:10000});
      const output=result.stdout+result.stderr;
      console.log('native',count,'depth',depth,revision??'working-tree',JSON.stringify({passed:result.status===0,interrupted:output.includes('interrupted'),timing:output.match(/BENCH_RENDER_MS=\d+/g)}));
      if(result.status!==0 && (!revision || !output.includes('interrupted'))) throw new Error(output);
    } finally { rmSync(directory,{recursive:true,force:true}); }
  }
}
