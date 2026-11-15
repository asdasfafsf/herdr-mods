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
function workspaceLayout(active='main') {
  return {id:'root',type:'row',children:[{id:'sidebar',size:{px:268}},{id:'workspace-views',type:'stack',active,children:[{id:'main',type:'block',content:{tab:'active',pane:{gap:8}}},{id:'agent-world',type:'block',content:{mod:'agents-plus',props:{mode:'overview',integrated:true}}}]}]};
}
function splitWorkspaceLayout(share=0.6) {
  return {id:'workspace-views',type:'column',children:[
    {id:'agent-scene',type:'block',size:{weight:share},content:{mod:'agents-plus',props:{mode:'overview',integrated:true}}},
    {id:'agent-terminal-dock',type:'column',size:{weight:1-share},children:[
      {id:'agent-terminal-surface',type:'column',children:[{id:'main',type:'block',content:{tab:'active'}}]},
    ]},
  ]};
}
function findNode(node,id) {
  return node?.id===id ? node : node?.children?.map(child=>findNode(child,id)).find(Boolean);
}
async function environment(data, revision, store = new Map()) {
  const calls = {}, writes = [], handlers = new Map(), timers = new Map(), tasks = [], commands = [];
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
          if (key === 'on_open_change') {
            const id = node.ops.find(([op]) => op === 'id')?.[1][0];
            handlers.set(id, (_e, cx) => args[0](!node.ops.find(([op]) => op === 'open')?.[1][0], cx));
            handlers.set(`${id}:on_open_change`, args[0]);
          }
          if (key.startsWith('on_mouse_')) handlers.set(`${node.ops.find(([k])=>k==='id')?.[1]?.[0]}:${key}`,args.at(-1));
          node.ops.push([key, args.map(v => typeof v === 'function' ? '[callback]' : v)]);
        }
        return proxy;
      };
    }});
    return proxy;
  }
  const theme = Object.fromEntries(['foreground','solid','solid_foreground','muted','dim','raised','hover','input','chrome','border','working','blocked','done','idle','accent','selected','ansi5'].map(k => [k, '#123456']));
  const host = {
    notify: value => writes.push(['notify', value]),
    nextCommand: () => new Promise(()=>{}),
    themes: () => ['paper','herdr-chiikawa','graphite','ink','moss','atom-one-dark'].map(name=>({name,light:['paper','herdr-chiikawa'].includes(name)})),
    agents: () => cloneRead('agents', data.agents), terminals: () => cloneRead('terminals', data.terminals), panes: () => cloneRead('panes', data.panes), spaces: () => cloneRead('spaces', data.spaces),
    shared: key => cloneRead(`shared:${key}`, data.state[key]), setShared: (key, value) => { data.state[key] = structuredClone(value); writes.push([key,value]); },
    setAgentOrder: value => writes.push(['setAgentOrder',value]),
    focused: () => data.focused ?? ({agent:'t0',terminal:'t0',pane:'p0',tab:'b0'}), layout: () => data.layout ?? ({id:'root',type:'row',children:[{id:'sidebar',size:{px:data.collapsed ? 76 : 268}},{id:'main',type:'block',content:{tab:'active'}}]}), layouts:()=>data.layouts ?? ['main'], props: () => data.props ?? {}, theme: () => theme, window: () => ({active:data.windowActive ?? true}),
    settings: () => ({theme: data.nativeTheme ?? (typeof data.layout?.theme === 'string' ? data.layout.theme : data.layout?.theme?.[data.dark ? 'dark' : 'light']) ?? (data.dark ? 'graphite' : 'paper'), dark: Boolean(data.dark)}),
    run: (...args) => {writes.push(['run',args]);if(args[0]==='layout.set') {data.layout=structuredClone(args[1].layout);delete data.nativeTheme;} if(args[0]==='layout.clone') {data.state.layout=args[1].as;data.layouts=['main',args[1].as];}if(args[0]==='layout.switch') data.state.layout=args[1].name; if(args[0]==='layout.select') findNode(data.layout,args[1].stack).active=args[1].child;}, openOverlay: value => writes.push(['openOverlay',value]), closeOverlay: value => writes.push(['closeOverlay',value]), exec: async (...args) => { commands.push(args); return data.execHook ? data.execHook(...args) : ({code:0,stdout:'[]'}); }, appHome: () => '/example/app', home: () => '/example', readTextFile: async () => data.settingsRaw ?? '{}', writeTextFile: async (_path, text, expected) => { assert.equal(expected, data.settingsRaw ?? '{}'); data.settingsRaw=text; },
  };
  const runHost = host.run;
  host.run = (...args) => {
    runHost(...args);
    if (args[0].startsWith('spaces-plus.resume@')) {
      const rec=JSON.parse(args[0].split('@')[1]);
      if(rec.request && data.resumeReply !== false) {
        data.state['wt.results']={...data.state['wt.results'],[rec.request]:data.resumeReply ?? {ok:true}};
        queueMicrotask(()=>timers.get(100)?.());
      }
    }
    if (['layout.show','layout.hide','layout.resize'].includes(args[0])) {
      const node=findNode(data.layout,args[1].id);
      if(node) { if(args[0]==='layout.resize') node.size=args[1].weight == null ? {px:args[1].px} : {weight:args[1].weight}; else node.hidden=args[0]==='layout.hide'; }
    }
    if (args[0] === 'app.theme') {
      const before = data.layout.theme;
      const pair = typeof before === 'string' ? {light:before,dark:before} : {...before};
      pair[host.themes().find(t=>t.name===args[1].name)?.light ? 'light' : 'dark'] = args[1].name;
      data.layout.theme = pair; delete data.nativeTheme;
    }
  };
  const context = vm.createContext({ console, Date: class extends Date { static now() { return now + (data.elapsed ?? 0); } }, localStorage: { getItem:k => store.get(k), setItem:(k,v) => store.set(k,v), removeItem:k => store.delete(k) } });
  const modules = new Map();
  const synthetic = (id, exports) => new vm.SyntheticModule(Object.keys(exports), function() { for(const [k,v] of Object.entries(exports)) this.setExport(k,v); }, {context,identifier:id});
  modules.set('herdr',synthetic('herdr',host));
  modules.set('gpui-kit',synthetic('gpui-kit',{View:class {},div:()=>builder('div'),image:s=>builder('image',s),svg:s=>builder('svg',s)}));
  const textState={new:({value=''}={})=>({text:value,events:{},focusCount:0,value(){return this.text},set_value(value){this.text=value},on(event,fn){this.events[event]=fn},focus(){this.focusCount++},emit(event,payload={}){this.events[event]?.(payload,cx)}})};
  modules.set('gpui-base',synthetic('gpui-base',{h_flex:()=>builder('h_flex'),v_flex:()=>builder('v_flex'),
    Popover: { new: id => builder('popover').id(id) }, InputState:textState,TextareaState:textState,
    Input:{new:()=>builder('input')},Textarea:{new:()=>builder('textarea')},Scrollbar:{vertical:id=>builder('scrollbar',id)}}));
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
  let runTasks=false;
  const cx = {spawn(fn){if(runTasks) tasks.push(fn(cx));},timer:{every(ms,handler){timers.set(ms,()=>handler(cx));return {cancel(){timers.delete(ms);}};}},notify(){},stop_propagation(){},focus_handle(){return {focusCount:0,focus(){this.focusCount++;}};}};
  instance.init({},cx); instance.outside=data.outside;
  runTasks=true;
  instance.activity=Object.fromEntries(data.agents.map(a=>[a.address,{doing:'Editing example',said:'Example result'}]));
  const render = () => { handlers.clear(); return JSON.parse(JSON.stringify(instance.render(cx))); };
  const click = id => { assert.ok(handlers.has(id),`missing click target ${id}`); handlers.get(id)({},cx); };
  return {instance,calls,writes,render,data,click,pointer:(id,type,event)=>handlers.get(`${id}:${type}`)(event,cx),timers,tasks,commands,cx,ui:modules.get('lib/ui.js').namespace,state:modules.get('lib/state.js').namespace,overview:modules.get('mods/agents-plus/overview.js')?.namespace,agentTheme:modules.get('mods/agents-plus/agent-theme.js')?.namespace,village:modules.get('mods/agents-plus/village.js')?.namespace,chat:modules.get('mods/agents-plus/village-chat.js')?.namespace,mode:modules.get('mods/agents-plus/agent-mode.js')?.namespace,dock:modules.get('mods/agents-plus/terminal-dock.js')?.namespace,workspace:modules.get('mods/agents-plus/workspace-controls.js')?.namespace};
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
  assert.ok(firstCalls.terminal_filter_items<=data.terminals.length*3,`${name}: initial activity and render indexes must stay linear`);
  assert.equal(firstCalls.panes,1,`${name}: pane reads must not grow with row count`);
  assert.equal(firstCalls['shared:wt.trees'],1,`${name}: tree reads must not grow with row count`);
  console.log(name,'after',JSON.stringify(firstCalls),'mock_median_ms',samples.sort((a,b)=>a-b)[3].toFixed(2));
}

// Overview includes parent sessions across projects without changing sidebar order.
{
  const data=fixture(4);
  data.props={mode:'overview',presentation:'cards'};
  data.outside=[{agent:'codex',pid:99,session:'one',cwd:'/example/repo-0/work-0',title:'External one',status:'working',updated:1},
    {agent:'codex',pid:99,session:'two',cwd:'/another',title:'External two',status:'blocked',updated:2}];
  const env=await environment(data,null);
  env.render();
  assert.deepEqual(env.writes.map(([key])=>key),['ag.resourcePackMigration'],'only the initial pack migration writes a preference');
  let rows=env.overview.agentViewRows(data.outside);
  assert.equal(rows.length,6,'4 parent agents and 2 sessions on the same PID');
  assert.equal(env.overview.filterAgentRows(rows,'External').length,2);
  assert.ok(!rows.some(row=>row.source==='child'),'native children are hidden');
  assert.equal(env.overview.filterAgentRows(rows,'repo-3','blocked').length,1);
  env.click('overview-t1');
  assert.deepEqual(JSON.parse(JSON.stringify(env.writes.at(-1))),['run',['pane.focus',{pane:'p1'}]]);
  // Use the actual key exported by state.js rather than an assumed storage name.
  env.data.state[env.state.LIVE]={one:'t0'};
  rows=env.overview.agentViewRows(data.outside);
  assert.equal(rows.length,5,'a session already represented in Herdr is deduplicated');
  env.instance.input.text='no match';
  assert.match(JSON.stringify(env.render()),/No matching agents/);
  env.instance.input.text='';
  env.click('village-filters');env.render();env.click('overview-status-blocked');
  const filtered=JSON.stringify(env.render());
  assert.ok(filtered.includes('overview-t3'));
  assert.ok(!filtered.includes('overview-t0"'));
  const sidebarData=fixture(1);sidebarData.layout=workspaceLayout();sidebarData.state.layout='herdr-worktrees';
  const sidebar=await environment(sidebarData,null);
  assert.ok(!JSON.stringify(sidebar.render()).includes('ag-view'),'expanded sidebar has no duplicate Agent view button');
  sidebarData.collapsed=true;
  assert.ok(!JSON.stringify(sidebar.render()).includes('ag-view-rail'),'collapsed sidebar has no duplicate mode button');
  sidebarData.props={mode:'view-switch'};
  const toolbar=await environment(sidebarData,null);toolbar.render();toolbar.click('workspace-view-agent');
  assert.equal(toolbar.writes.some(([,args])=>args[0]==='layout.clone'),false,'view switching must not create a layout');
  assert.equal(toolbar.writes.some(([,args])=>args[0]==='tab.new'),false,'Agent mode must not add a tab');
  assert.equal(toolbar.data.state.layout,'herdr-worktrees');
  assert.equal(findNode(toolbar.data.layout,'workspace-views').active,'agent-world');
  console.log('agent overview: all projects, parent agents, shared-PID sessions, deduplication, filters and navigation passed');
  const many=fixture(60);many.props={mode:'overview',presentation:'cards'};
  const paged=await environment(many,null);
  const pageOne=JSON.stringify(paged.render());
  assert.ok(pageOne.includes('overview-next'));
  assert.equal((pageOne.match(/"overview-t\d+"/g)??[]).length<=25,true);
  paged.click('overview-next');
  const pageTwo=JSON.stringify(paged.render());
  assert.notEqual(pageOne,pageTwo);
  assert.equal(paged.instance.page,1);
  paged.click('village-filters');paged.render();paged.click('overview-status-idle');paged.render();
  assert.equal(paged.instance.page,0,'filter changes return to the first page');
}

// Themes retain sessions, ordering, pagination and filters; village details are opt-in.
{
  const data=fixture(60);data.props={mode:'overview'};
  const env=await environment(data,null);
  const ids=output=>[...output.matchAll(/"overview-(?:t\d+|child-[^"]+|outside-[^"]+)"/g)].map(m=>m[0]);
  env.render();env.click('overview-next');
  const before=JSON.stringify(env.render()), page=env.instance.page;
  env.click('overview-pack-chiikawa');
  const themed=JSON.stringify(env.render());
  assert.equal(env.instance.pack,'chiikawa');
  assert.equal(env.instance.page,page,'changing a theme keeps the current page');
  assert.deepEqual(ids(themed),ids(before),'themes show the same agents in the same order');
  assert.ok(themed.includes('agent-village'),'the Chiikawa theme displays the village');
  assert.match(themed,/chiikawa\/atlases\/(done|idle|hachiware|rakko|momonga|kurimanju)(-left|-right)?\.svg/);
  const residents=new Set(env.instance.residentAssignments.values());
  for(const name of Array.from(new Set(env.instance.residentAssignments.values()))) assert.ok(residents.has(name),`resident ${name} is reachable`);
  const firstResidents=env.instance.overviewRows.slice(0,new Set(env.instance.residentAssignments.values()).size).map(row=>env.agentTheme.agentSprite(env.instance,row,true).name);
  assert.equal(new Set(firstResidents).size,firstResidents.length,'initial sessions receive distinct residents');
  assert.equal(env.agentTheme.agentSprite(env.instance,{id:'t0'},false).name,env.agentTheme.agentSprite(env.instance,{id:'t0'},true).name,'cards and village retain the same character');
  for(const status of ['working','blocked','done','seen','idle']) assert.equal(env.agentTheme.agentSprite(env.instance,{id:'t0',status},true).name,env.agentTheme.agentSprite(env.instance,{id:'t0',status:'idle'},true).name,'identity remains stable across status changes');
  assert.ok(!themed.includes('village-details') && !themed.includes('village-filter-panel'),'the initial village has no persistent panels');
  const reads=env.calls.agents;env.instance.themeClock=500;env.render();
  assert.equal(env.calls.agents,reads,'animation reuses host snapshots');
  data.windowActive=false;data.elapsed=100;env.timers.get(50)();
  assert.equal(env.instance.themeClock,600,'a visible overview animates without window focus');
  env.click('village-filters');env.render();env.click('overview-motion');assert.equal(env.instance.motionPaused,true);
  data.elapsed=150;env.timers.get(50)();
  assert.equal(env.instance.themeClock,600,'motion pause freezes playback');
  env.click('overview-motion');env.click('village-filters');data.elapsed=1000;env.timers.get(50)();
  assert.equal(env.instance.themeClock,600,'a hidden overview stops playback');
  env.render();data.elapsed=1050;env.timers.get(50)();
  assert.equal(env.instance.themeClock,650,'playback resumes when the overview is rendered again');
  data.panes.push({pane:'village',mod:'agents-plus',tab:'village-tab'});
  data.focused={pane:'village',tab:'village-tab'};
  data.elapsed+=4000;env.timers.get(50)();
  assert.equal(env.instance.themeClock,810,'a slow render does not freeze the visible village');
  data.focused={pane:'p0',tab:'b0'};
  data.elapsed+=50;env.timers.get(50)();
  assert.equal(env.instance.themeClock,810,'a different active tab suspends the village');
  env.render();env.click('overview-pack-default');
  assert.equal(env.instance.pack,'default');
  assert.deepEqual(ids(JSON.stringify(env.render())),ids(before));
  env.click('overview-pack-chiikawa');env.render();env.click('village-filters');env.render();env.click('overview-status-working');
  assert.equal(env.instance.page,0);
  env.instance.input.text='Task 0';env.render();
  const priorWrites=env.writes.length;
  env.click('overview-t0');
  assert.equal(env.writes.length,priorWrites,'selecting a resident does not navigate away');
  assert.match(JSON.stringify(env.render()),/village-details/);
  env.click('village-open-session');
  assert.deepEqual(JSON.parse(JSON.stringify(env.writes.filter(([kind])=>kind==='run').at(-1))),['run',['pane.focus',{pane:'p0'}]]);
  env.render();env.click('village-close');
  assert.ok(!JSON.stringify(env.render()).includes('village-details'),'details can be dismissed');
  assert.notEqual(env.agentTheme.spriteFrame('chiikawa','walk',0),env.agentTheme.spriteFrame('chiikawa','walk',500));
  for (const width of [360,640,1100,1800]) for (const count of [0,1,4,12,24]) {
    const layout=env.village.villageLayout(width,600,count);
    const view={themeClock:0}, rows=Array.from({length:count},(_,i)=>({id:`roamer-${i}`}));
    const initial=env.village.advanceVillage(view,rows,layout).map(({actor})=>({x:actor.x,y:actor.y}));
    for(let frame=0;frame<1200;frame++) {
      view.themeClock+=50;
      const current=env.village.advanceVillage(view,rows,layout);
      for (const {actor} of current) {
        assert.ok(actor.x>=0 && actor.x+layout.size+16<=width,'moving residents stay inside scene width');
        assert.ok(actor.y>=0 && actor.y+layout.size+12<=layout.height,'moving residents stay inside scene height');
      }
    }
    if(count) assert.ok(rows.some((row,i)=>Math.hypot(view.villageActors.get(row.id).x-initial[i].x,view.villageActors.get(row.id).y-initial[i].y)>20),'residents travel beyond an idle wiggle');
    const snapshot=JSON.stringify([...view.villageActors]);
    env.village.advanceVillage(view,rows,layout);
    assert.equal(JSON.stringify([...view.villageActors].map(([id,a])=>[id,{...a,moving:false}])),JSON.stringify(JSON.parse(snapshot).map(([id,a])=>[id,{...a,moving:false}])),'a paused clock freezes positions');
    if(count) {
      view.villageSelected=rows[0].id;
      const actor=view.villageActors.get(rows[0].id), x=actor.x,y=actor.y;
      let distance=0;
      for(let frame=0;frame<100;frame++) {
        view.themeClock+=50;env.village.advanceVillage(view,rows,layout);
        distance=Math.max(distance,Math.hypot(actor.x-x,actor.y-y));
      }
      assert.equal(distance,0,'selected residents stay still for focused interaction');
      view.villageSelected=null;
      for(let frame=0;frame<100;frame++) {
        view.themeClock+=50;env.village.advanceVillage(view,rows,layout);
        distance=Math.max(distance,Math.hypot(actor.x-x,actor.y-y));
      }
      assert.ok(distance>4,`deselecting a resident resumes roaming (${width}px, ${count} residents, ${distance}px)`);
    }
  }
  console.log('agent themes: shared sessions, opt-in filters/details, roaming bounds, motion pause, selection and navigation passed');
}

// Native Settings owns the theme; legacy shared flags cannot override it.
{
  const data=fixture(4); data.props={mode:'overview',integrated:true}; data.outside=[];
  data.layout={...workspaceLayout('agent-world'),theme:'paper'};
  data.state['ag.workspaceTheme']='chiikawa';
  const env=await environment(data,null);
  assert.equal(env.mode.workspaceTheme(),'default');
  assert.ok(!JSON.stringify(env.mode.renderViewSwitch()).includes('workspace-theme-'),'toolbar has no duplicate theme selector');
  data.layout.theme='herdr-chiikawa'; env.timers.get(50)();
  assert.equal(env.instance.pack,'default','Settings leaves the independently saved pack unchanged');
  data.layout.theme='ink'; env.timers.get(50)();
  assert.equal(env.instance.pack,'default','leaving Chiikawa also preserves the pack');
  env.mode.applyModeTheme('chiikawa'); env.timers.get(50)();
  assert.deepEqual(data.layout.theme,{light:'herdr-chiikawa',dark:'ink'},'native selection preserves the opposite appearance');
  env.mode.applyModeTheme('default'); env.timers.get(50)();
  assert.equal(data.layout.theme,'ink','Default restores the preceding native theme');
  assert.equal(env.agentTheme.agentTheme({foreground:'#abcdef'},'chiikawa').foreground,'#abcdef','native palette overrides reach cards and village');
  delete data.state['ag.nativeThemeMigrated.main']; data.state['ag.workspaceTheme']='chiikawa';
  data.layout.colors={chrome:'#f4ecdb',foreground:'#503c2e',accent:'#123123',personal:'#abcdef'};
  env.mode.migrateWorkspaceTheme();
  assert.deepEqual(data.layout.colors,{accent:'#123123',personal:'#abcdef'},'remove owned palette values; preserve custom edits');
  assert.equal(data.layout.theme,'ink','migration preserves the native theme');
  assert.equal(data.state['ag.workspaceTheme'],null);
  data.layout.colors.chrome='#f4ecdb'; env.mode.migrateWorkspaceTheme();
  assert.equal(data.layout.colors.chrome,'#f4ecdb','future user colors are not deleted by repeated migration');
  env.mode.initWorkspaceTheme(env.cx);
  data.layout.theme='moss'; env.timers.get(250)();
  data.layout.theme='herdr-chiikawa'; env.timers.get(250)();
  env.mode.applyModeTheme('default');
  assert.equal(data.layout.theme,'moss','Settings entry preserves the previously observed native theme');
  await Promise.all(env.tasks);
}


// Legacy single-theme selections must not pin Dark to a light palette.
for (const choice of ['herdr-chiikawa',{light:'herdr-chiikawa',dark:'herdr-chiikawa'}]) {
  const data=fixture(1);data.props={mode:'overview',integrated:true};data.outside=[];
  data.layout={...workspaceLayout('agent-world'),theme:choice};
  data.state['ag.nativeThemeMigrated.main']=true;
  data.state['overview.baseLook.main']={theme:{light:'herdr-chiikawa',dark:'atom-one-dark'}};
  const env=await environment(data,null);
  env.mode.migrateAppearanceTheme();
  assert.deepEqual(data.layout.theme,{light:'herdr-chiikawa',dark:'atom-one-dark'});
  const writes=env.writes.length;env.mode.migrateAppearanceTheme();
  assert.equal(env.writes.length,writes,'appearance repair runs only once');
  data.dark=true;env.timers.get(50)();
  assert.equal(env.mode.workspaceTheme(),'default','Dark picks the original dark theme');
  assert.equal(env.instance.pack,'chiikawa','Dark preserves the independently migrated pack');
  data.dark=false;env.timers.get(50)();
  assert.equal(env.instance.pack,'chiikawa','Light preserves the same resource pack');
  env.mode.applyModeTheme('default');
  assert.deepEqual(data.layout.theme,{light:'paper',dark:'atom-one-dark'},'Default removes Chiikawa from an old pair backup');
  data.dark=true;env.mode.applyModeTheme('chiikawa');
  assert.equal(data.dark,true,'theme selection never changes Appearance');
  assert.deepEqual(data.layout.theme,{light:'herdr-chiikawa',dark:'atom-one-dark'},'native selection preserves the dark preference');
}
{
  const data=fixture(1);data.props={mode:'overview',integrated:true};
  data.layout={...workspaceLayout('agent-world'),theme:{light:'paper',dark:'moss'}};
  data.state['overview.baseLook.main']={theme:'herdr-chiikawa'};
  const env=await environment(data,null);env.mode.migrateAppearanceTheme();
  assert.deepEqual(data.layout.theme,{light:'paper',dark:'moss'},'valid Settings choices are not migrated');
}

// Integrated mode uses the same rows, with quiet residents following native focus.
{
  const data=fixture(4);data.props={mode:'overview',integrated:true,skin:'chiikawa'};
  data.state.layout='herdr-worktrees';data.state['ag.workspaceTheme']='chiikawa';data.layout={...workspaceLayout('agent-world'),theme:'herdr-chiikawa'};data.outside=[];
  const env=await environment(data,null);
  let output=JSON.stringify(env.render());
  assert.ok(output.includes('overview-t0') && output.includes('overview-t3'));
  assert.ok(output.includes('overview-t1'),'seen agents stay visible');
  assert.ok(!output.includes('overview-t2"'),'idle agents are absent until focused');
  assert.equal(data.layout.theme,'herdr-chiikawa');assert.equal(data.layout.colors,undefined,'palette comes from the native theme file');
  data.focused={terminal:'t2',pane:'p2',tab:'b2'};env.timers.get(250)();
  output=JSON.stringify(env.render());
  assert.ok(output.includes('overview-t2') && output.includes('village-message-t2'));
  data.focused={terminal:'t1',pane:'p1',tab:'b1'};env.timers.get(250)();
  output=JSON.stringify(env.render());
  assert.ok(output.includes('overview-t1') && !output.includes('overview-t2"'),'previous quiet selection disappears');
  env.click('overview-t0');
  assert.deepEqual(JSON.parse(JSON.stringify(env.writes.filter(([kind])=>kind==='run').at(-1))),['run',['pane.focus',{pane:'p0'}]]);
  env.mode.renderViewSwitch();env.click('overview-layout-cards');env.timers.get(50)();
  output=JSON.stringify(env.render());
  assert.ok(!output.includes('agent-village') && output.includes('chiikawa/'),'cards keep the theme characters');
  env.mode.renderViewSwitch();env.click('overview-layout-village');env.timers.get(50)();env.mode.applyModeTheme('default');env.timers.get(50)();
  assert.equal(data.layout.colors,undefined,'default restores the original layout palette');
  env.mode.applyModeTheme('chiikawa');env.timers.get(50)();
  env.mode.leaveAgentMode();
  assert.equal(env.mode.workspaceTheme(),'chiikawa','whole-workspace native theme survives presentation changes');
  assert.equal(data.state.layout,'herdr-worktrees','switching presentation keeps the same workspace');
  assert.equal(findNode(data.layout,'workspace-views').active,'main','terminal presentation restores the original tab tree');
  assert.equal(data.focused.terminal,'t1','presentation does not choose another session');
  assert.equal(env.writes.some(([,args])=>['layout.clone','layout.switch','tab.new'].includes(args?.[0])),false);
  env.mode.openAgentMode();
  assert.equal(findNode(data.layout,'workspace-views').active,'agent-world');
  assert.ok(!JSON.stringify(env.render()).includes('overview-child-'),'children are absent in Agent mode');
  console.log('Agent mode: shared palette, cards/village, quiet visibility, bidirectional focus and exit passed');
}

// Only parent sessions appear; stale internal data and native children are ignored.
{
  const data=fixture(40);data.outside=[];
  data.agents.push({...data.agents[0],address:'child-0-0',title:'Native child',pane:'child-pane'});
  data.state['ag.info']={t0:{session_id:'parent',children:[
    {id:'internal-child',parent_session_id:'parent',name:'Internal child',state:'working',updated:now},
  ]}};
  const sidebar=await environment(data,null);
  const output=JSON.stringify(sidebar.render());
  assert.ok(!output.includes('sub-') && !output.includes('Native child') && !output.includes('Internal child'));
  data.props={mode:'overview',integrated:true};data.layout={...workspaceLayout('agent-world'),theme:'herdr-chiikawa'};
  const view=await environment(data,null);view.render();
  const rows=view.overview.agentViewRows([]);
  assert.equal(rows.length,40,'native and internal children never become residents');
  assert.ok(rows.every(row=>row.source!=='child' && !row.internal));
  sidebar.instance.focusAgent(data.agents[0]);view.timers.get(250)();
  assert.equal(view.instance.villageSelected,'t0');
  view.render();view.click('village-close');view.timers.get(250)();
  assert.equal(view.instance.villageSelected,null,'closed details stay closed until an explicit click');
  sidebar.instance.focusAgent(data.agents[0]);view.timers.get(250)();
  assert.equal(view.instance.villageSelected,'t0','same focused parent reopens from the sidebar');
  view.instance.input.text='No match';view.instance.sourceFilter='outside';view.instance.statusFilter='done';
  data.focused={terminal:'t38',pane:'p38',tab:'b38'};
  sidebar.instance.focusAgent(data.agents[38]);view.timers.get(250)();
  assert.equal(view.instance.villageSelected,'t38');
  assert.equal(view.instance.input.value(),'');
  assert.equal(view.instance.sourceFilter,'all');assert.equal(view.instance.statusFilter,'all');
  assert.ok(view.instance.page>0,'sidebar selection reveals a parent beyond the first page');
  assert.ok(JSON.stringify(view.render()).includes('village-details'));
  data.state['ag.presentation']='cards';view.timers.get(50)();
  const cards=JSON.stringify(view.render());
  assert.ok(!cards.includes('Internal child') && !cards.includes('Native child'));
  console.log('parent agents: children hidden in sidebar/cards/village, repeated selection and filtered/page navigation passed');
}

// Sidebar owns ordering, including pins, Active, outside sessions and grouped mode.
for (const skin of ['default','chiikawa']) {
  const sideData=fixture(8);
  sideData.outside[0].status='blocked';
  const sidebar=await environment(sideData,null);sidebar.render();
  const viewData={...structuredClone(sideData),state:sideData.state,props:{mode:'overview',integrated:true},
    layout:{...workspaceLayout('agent-world'),theme:skin==='chiikawa'?'herdr-chiikawa':'ink'}};
  sideData.state['ag.presentation']='cards';
  const view=await environment(viewData,null);view.render();
  const ids=()=>Array.from(view.instance.overviewRows,row=>row.id);
  const assertOrder=()=>assert.deepEqual(ids(),sideData.state['ag.order'],'cards follow the complete published sidebar order');
  assertOrder();
  assert.equal(ids()[0],'t2','pinned sessions keep the sidebar position');
  assert.equal(ids()[1],'t0','the active session precedes state sections');
  assert.ok(ids().includes('outside-codex-1000'),'external sessions participate in the shared order');
  const cachedAt=view.instance.overviewRowsAt;
  sideData.focused=viewData.focused={terminal:'t1',pane:'p1',tab:'b1'};
  sidebar.render();view.render();assertOrder();
  assert.equal(ids()[1],'t1','focus changes move Active in both presentations');
  if(skin==='chiikawa') assert.equal(view.instance.overviewRowsAt,cachedAt,'cached activity does not delay a new order');
  sideData.state['agents.sort']='grouped';sidebar.render();view.render();assertOrder();
  const filtered=view.overview.filterAgentRows(view.instance.overviewRows,'','working','all');
  assert.deepEqual(Array.from(filtered,row=>row.id),ids().filter(id=>view.instance.overviewRows.find(row=>row.id===id).status==='working'),'filters preserve relative order');
  const writes=view.writes.length;view.overview.orderAgentRows(view.instance.overviewRows);
  assert.equal(view.writes.length,writes,'the overview never publishes a competing order');
}
console.log('agent ordering: sidebar pins, Active, external sessions, grouped sorting and cached views agree');

// Native dock uses the same host terminal; it never relays or submits input.
{
  const data=fixture(4);data.outside=[];data.props={mode:'overview',integrated:true};
  data.layout=workspaceLayout('agent-world');
  data.panes=data.panes.map(({id,...pane})=>({...pane,pane:id}));
  const stack=findNode(data.layout,'workspace-views');
  const terminalTree=stack.children[0];stack.type='column';delete stack.active;
  stack.children=[
    {id:'agent-scene',type:'block',size:{weight:1},min:0,content:{mod:'agents-plus',props:data.props}},
    {id:'agent-terminal-dock',type:'column',size:{weight:0},min:20,children:[
      {id:'agent-terminal-surface',type:'column',children:[terminalTree]}]}];
  data.state['ag.composer']={address:'t0',sequence:1};
  const env=await environment(data,null);env.render();
  env.timers.get(250)();
  assert.ok(!env.instance.composerOpen,'reloading the mod does not replay an old Compose request');
  assert.equal(env.instance.input.focusCount,0,'a hidden search field never takes terminal input focus');
  assert.ok(env.dock.hasTerminalDock());assert.equal(env.dock.terminalDockOpen(),false);
  env.click('overview-open-t0');
  assert.ok(env.dock.sceneVisible(),'opening terminal retains the scene');
  assert.ok(env.dock.terminalDockOpen());
  assert.equal(env.dock.workspaceSplit().sceneShare,0.5);
  assert.deepEqual(JSON.parse(JSON.stringify(env.writes.at(-1))),['run',['pane.focus',{pane:'p0'}]]);
  env.dock.syncWorkspaceSplit();
  findNode(data.layout,'agent-scene').size={weight:0.3};findNode(data.layout,'agent-terminal-dock').size={weight:0.7};
  env.workspace.workspaceCommand('toggle_terminal');
  assert.equal(env.dock.terminalDockOpen(),false);
  env.workspace.workspaceCommand('toggle_terminal');
  assert.equal(env.dock.workspaceSplit().sceneShare,0.3,'reopening retains resized ratio');
  const original=JSON.stringify(terminalTree);
  env.workspace.workspaceCommand('toggle_view');assert.equal(env.dock.workspaceSplit().sceneShare,0);
  env.workspace.workspaceCommand('toggle_view');assert.equal(env.dock.workspaceSplit().sceneShare,1);
  env.workspace.workspaceCommand('toggle_view');assert.equal(env.dock.workspaceSplit().sceneShare,0.3);
  assert.equal(JSON.stringify(findNode(data.layout,'agent-terminal-surface').children[0]),original,'terminal tree and pane options remain unchanged');
  const toolbar=JSON.stringify(env.dock.renderTerminalToolbar());
  assert.ok(!toolbar.includes('Paste image') && !toolbar.includes('Compose'),'native terminal does not duplicate composer actions');
  env.dock.terminalAction('terminal.paste_image','t1');
  assert.deepEqual(JSON.parse(JSON.stringify(env.writes.slice(-2).map(entry=>entry[1]))),[['pane.focus',{pane:'p1'}],['terminal.paste_image']]);
  assert.equal(env.commands.length,0,'dock and clipboard actions use native commands, never hc send/keys');
  assert.ok(!env.writes.some(([kind,args])=>kind==='run' && ['layout.set','tab.new','terminal.open'].includes(args[0])));
  env.dock.showComposer('t0');env.timers.get(250)();env.render();
  assert.equal(env.instance.composerOpen,true);
  assert.equal(env.instance.villageChats.get('t0').input.focusCount,1,'Compose focuses the editor after native session selection');
  const focusedWrites=env.writes.length;env.timers.get(250)();
  assert.equal(env.writes.length,focusedWrites,'the following selection tick does not return focus to the terminal');
  env.click('village-filters');
  assert.equal(env.instance.input.focusCount,0,'opening Options does not steal focus into Search');
}
console.log('native terminal dock: shared session, collapse, resize memory, shortcuts, clipboard routing and composer passed');

// Presentation changes retain the selected resident, editor draft, native tab
// tree and independent pack/palette choices. Scene receives a neutral focus
// handle; returning to a terminal never replays a Compose request.
for (const presentation of ['cards','village']) {
  const data=fixture(4); data.outside=[]; data.props={mode:'overview',integrated:true};
  data.layout={...splitWorkspaceLayout(0.5),theme:'moss'};
  data.state['ag.presentation']=presentation; data.state['ag.resourcePack']='chiikawa';
  const env=await environment(data,null); env.render(); env.timers.get(250)();
  const chat=env.instance.villageChats.get('t0'); chat.input.set_value('Retained local draft');
  const native=JSON.stringify(findNode(data.layout,'agent-terminal-surface'));
  env.instance.input.set_value('Retained search');
  for(let index=0;index<30;index++) {
    env.workspace.workspaceCommand('toggle_view'); env.timers.get(250)();
    assert.equal(env.instance.villageSelected,'t0');
    assert.equal(chat.input.value(),'Retained local draft');
    assert.equal(chat.input.focusCount,0,'presentation changes never focus a composer');
    assert.equal(env.instance.input.focusCount,0,'presentation changes never focus Search');
    assert.equal(env.instance.input.value(),'Retained search');
    assert.equal(data.state['ag.presentation'],presentation);
    assert.equal(data.state['ag.resourcePack'],'chiikawa');
    assert.equal(data.layout.theme,'moss');
  }
  assert.equal(env.instance.handle.focusCount,10,'each Scene transition focuses the visible neutral scene handle once');
  // A delayed sidebar/composer request cannot undo a newer keyboard cycle.
  env.mode.requestAgentSelection('t0','t0'); env.dock.showComposer('t0');
  env.workspace.workspaceCommand('toggle_view');
  env.workspace.workspaceCommand('toggle_view'); env.timers.get(250)();
  assert.equal(env.dock.workspacePresentation().mode,'scene');
  assert.equal(env.dock.workspaceSplit().sceneShare,1);
  assert.equal(chat.input.focusCount,0,'superseded Compose never steals Scene focus');
  env.mode.requestAgentSelection('t0','t0'); env.timers.get(250)();
  assert.equal(env.dock.workspacePresentation().mode,'split','a fresh sidebar click still opens the selected session');
  assert.equal(JSON.stringify(findNode(data.layout,'agent-terminal-surface')),native);
  assert.equal(env.commands.length,0,'cycling never sends terminal input');
}
console.log('presentation focus: Cards/Village retain selection, drafts, search, palette, pack and native terminal tree across 30 cycles');

// Cards keep the same session focus while offering distinct details/terminal actions.
for (const skin of ['default','chiikawa']) {
  const data=fixture(4);data.outside=[];data.props={mode:'overview',integrated:true};
  data.layout={...workspaceLayout('agent-world'),theme:skin==='chiikawa'?'herdr-chiikawa':'ink'};
  data.state['ag.presentation']='cards';
  data.state['ag.info']={t0:{doing:'Editing the shared theme registry',at:now},t3:{doing:'Approve the requested build command?',at:now}};
  data.panes[0].title='A long session title that still identifies the project and current work';
  const env=await environment(data,null);
  function rendered(node,id) {
    if (!node || typeof node!=='object') return null;
    if (node.ops?.some(([key,args])=>key==='id' && args[0]===id)) return node;
    for (const value of Array.isArray(node)?node:Object.values(node)) {
      const match=rendered(value,id);if(match) return match;
    }
    return null;
  }
  for(const width of [360,720,1400]) {
    env.instance.width=width;
    const tree=env.render(), card=rendered(tree,'overview-t0');
    assert.ok(card);
    assert.ok(JSON.stringify(rendered(card,'overview-selected-t0')).includes('Active'),'native focus is visible without opening details');
    assert.ok(JSON.stringify(rendered(card,'overview-title-t0')).includes(data.panes[0].title));
    assert.ok(JSON.stringify(rendered(card,'overview-preview-t0')).includes('Editing the shared theme registry'));
    assert.ok(JSON.stringify(rendered(tree,'overview-preview-t3')).includes('Approve the requested build command?'));
  }
  assert.ok(!JSON.stringify(env.render()).includes('View details'));
  env.click('overview-t3');
  assert.equal(env.instance.villageSelected,'t3');
  assert.equal(findNode(data.layout,'workspace-views').active,'agent-world','details keep the Agent presentation');
  data.focused={terminal:'t3',pane:'p3',tab:'b3'};env.timers.get(250)();
  env.render();env.click('village-close');
  assert.equal(env.instance.villageSelected,null);
  let tree=env.render();
  assert.ok(JSON.stringify(rendered(tree,'overview-selected-t3')).includes('Active'),'closing details does not erase native focus');
  env.click('overview-t3');
  assert.equal(env.instance.villageSelected,'t3','the whole card reopens its details');
  env.render();env.click('overview-open-t3');
  assert.equal(findNode(data.layout,'workspace-views').active,'main','Open terminal switches the same workspace');
  assert.deepEqual(JSON.parse(JSON.stringify(env.writes.at(-1))),['run',['pane.focus',{pane:'p3'}]]);
  assert.ok(!env.commands.some(([,args])=>['send','keys'].includes(args[0])),'card interactions never send messages or approvals');
}
console.log('agent cards: session identity, current work, active focus and distinct details/terminal actions passed');

// Unselected local approvals work beside the native dock; reads never focus or send.
for (const presentation of ['cards','village']) {
  const data=fixture(4);data.outside=[];data.props={mode:'overview',integrated:true};
  data.layout={id:'root',theme:'herdr-chiikawa',children:[{id:'workspace-views',type:'column',children:[
    {id:'agent-scene',size:{weight:0.6},content:{mod:'agents-plus'}},
    {id:'agent-terminal-dock',size:{weight:0.4},children:[{id:'agent-terminal-surface',content:{tab:'active'}}]},
  ]}]};
  data.state['ag.presentation']=presentation;
  data.agents.forEach(agent=>{agent.status='blocked';});
  data.execHook=async (_cmd,args)=>({code:0,stdout:JSON.stringify(args[0]==='get'
    ? {address:args.at(-1),state:'live',created_ms:1,turn:1,status_ms:100,foreground:{name:'codex',pid:42},status:{state:'blocked',kind:'permission',app:'codex'}}
    : {complete:true,text:'Run the requested checks?\n› 1. Yes\n  2. Yes, allow this command for the session\n  3. No\nEnter to confirm'})});
  const env=await environment(data,null);env.instance.width=700;env.render();
  const writes=env.writes.length, selected=env.instance.villageSelected;
  env.timers.get(2000)();await Promise.all(env.tasks.splice(0));
  let output=JSON.stringify(env.render());
  assert.equal(env.writes.length,writes,'approval polling preserves host focus');
  assert.equal(env.instance.villageSelected,selected);
  for(const row of env.instance.visibleOverviewRows) {
    assert.ok(output.includes(`${presentation==='village'?'village':'card'}-${row.id}-choice-3`),'every visible blocked resident exposes choices');
    assert.ok(env.instance.villageChats.get(row.id).request);
  }
  const request=env.instance.villageChats.get('t3').request;
  env.click('overview-t3');
  assert.ok(env.instance.villageChats.get('t3').input,'selection adds an editor to the polled state');
  assert.equal(env.instance.villageChats.get('t3').request,request,'selection preserves approval identity');
  if(presentation==='village') for(let i=0;i<120;i++) {
    env.instance.themeClock+=50;env.render();
    const layout=env.instance.villageBounds;
    const boxes=env.instance.visibleOverviewRows.map(row=>env.village.noticeBounds(env.instance.villageActors.get(row.id),layout,{width:320,height:340,artTop:env.village.residentSpacing(env.instance,row,layout.size).geometry.art.top}));
    for(let a=0;a<boxes.length;a++) for(let b=a+1;b<boxes.length;b++) {
      const x=boxes[a],y=boxes[b];
      assert.ok(x.left+x.width<=y.left || y.left+y.width<=x.left || x.top+x.height+12<=y.top || y.top+y.height+12<=x.top,'expanded approval buttons remain unobscured while roaming');
    }
  }
  assert.ok(!env.commands.some(([,args])=>['send','keys'].includes(args[0])));
}
console.log('inline approvals: unselected polling, native dock, preserved composer state and unobscured options passed');

// Read-required bubbles follow host unread state without acknowledging on sight.
{
  const data=fixture(4);data.props={mode:'overview',skin:'chiikawa'};data.outside=[];
  delete data.state['ag.acked'].t1;
  data.state['ag.info']={t1:{said:'수정 완료: 결과를 확인해주세요.',at:now},t3:{doing:'이 명령을 실행하도록 승인해주세요.',at:now}};
  const env=await environment(data,null);
  const initialWrites=env.writes.length;
  let output=JSON.stringify(env.render());
  assert.ok(output.includes('village-status-t0') && output.includes('Working'));
  assert.ok(output.includes('village-status-t2') && output.includes('Idle'));
  assert.ok(!output.includes('village-notice-t0') && !output.includes('village-notice-t2'));
  for(const text of ['village-notice-t1','village-notice-t3','수정 완료: 결과를 확인해주세요.','이 명령을 실행하도록 승인해주세요.']) assert.ok(output.includes(text),text);
  assert.equal(env.writes.length,initialWrites,'showing unread messages never marks them read');
  const waiting=env.instance.villageActors.get('t3'), position=[waiting.x,waiting.y];
  for(let i=0;i<100;i++) {env.instance.themeClock+=50;env.render();}
  assert.ok(Math.hypot(waiting.x-position[0],waiting.y-position[1])>4,'residents with unread work keep roaming with their bubbles');
  env.click('village-notice-t1');
  assert.equal(env.instance.villageSelected,'t1');
  assert.equal(env.writes.length,initialWrites,'previewing a bubble does not acknowledge the host session');
  data.state['ag.acked'].t1=now;
  data.agents[3].status='working';
  data.state['ag.info'].t3.doing='Running unit checks';
  data.elapsed=2100;
  output=JSON.stringify(env.render());
  assert.ok(!output.includes('village-notice-t1'),'seen removes unread bubble');
  assert.ok(!output.includes('village-notice-t3'),'working progress does not show a speech bubble');
  assert.ok(output.includes('village-status-t3') && output.includes('Working'),'working keeps its compact status label');
  assert.ok(output.includes('village-status-t1') && output.includes('Seen'));
  for(const width of [360,640,1100]) {
    const layout=env.village.villageLayout(width,600,24,24);
    for(const x of [layout.left,layout.right]) for(const y of [layout.top,layout.bottom]) {
      const box=env.village.noticeBounds({x,y},layout);
      assert.ok(box.left>=0 && box.left+box.width<=width && box.top>=0 && box.top+box.height<=layout.height,'speech bubbles fit within the village');
    }
  }
  console.log('village status: current state, real unread previews, no automatic acknowledgement, moving notices and clearing passed');
}

// Native dismissal closes only the popup; session selection and filters survive.
for (const presentation of ['cards','village']) {
  const data=fixture(4);data.props={mode:'overview',skin:'chiikawa'};data.outside=[];
  const env=await environment(data,null);env.instance.presentation=presentation;
  env.instance.villageSelected='t0';env.render();env.click('village-filters');
  let output=JSON.stringify(env.render());
  assert.ok(output.includes('Display options') && !output.includes('overview-refresh'));
  env.click('overview-status-working');env.render();
  env.pointer('village-filters','on_open_change',false);
  output=JSON.stringify(env.render());
  assert.ok(!output.includes('village-filter-panel'));
  assert.equal(env.instance.villageSelected,'t0');assert.equal(env.instance.statusFilter,'working');
  assert.equal(env.instance.input.focusCount,0);
}
console.log('Options popover: cards/village dismissal preserves filters and session selection');

// Long animations keep one native resource and a stable image identity instead
// of churning 127+ cache entries. Pause still stops autonomous GIF playback.
{
  const data=fixture(4);data.props={mode:'overview',skin:'chiikawa'};data.outside=[];
  const env=await environment(data,null);let output=JSON.stringify(env.render());
  const row=env.instance.overviewRows[0];env.instance.residentAssignments.set(row.id,'hachiware-dance');
  const paths=new Set();
  for(const clock of [0,100,13900,14000,28000]) { env.instance.themeClock=clock;paths.add(env.agentTheme.agentSprite(env.instance,row,true).path); }
  assert.equal(paths.size,1,'every animation lap keeps one native resource');
  assert.match([...paths][0],/originals\/hachiware-dance\.gif$/);
  output=JSON.stringify(env.render());
  assert.ok(output.includes(`village-art-${row.id}-hachiware-dance`),'native animation has stable row/resource identity');
  for (const name of ['rakko','hachiware','idle','done','momonga','kurimanju','shisa','yoroi']) {
    env.instance.residentAssignments.set(row.id,name);
    for (const facing of [-1,1]) {
      const sources=new Set(), frames=new Set();
      for(let clock=0;clock<4000;clock+=25) {
        env.instance.themeClock=clock;
        const sprite=env.agentTheme.agentSprite(env.instance,row,true,facing);
        sources.add(sprite.path);frames.add(sprite.atlas.frame);
      }
      assert.equal(sources.size,1,`${name} keeps its loaded atlas through repeated loops`);
      assert.ok(frames.size>1,`${name} still animates inside that atlas`);
    }
  }
  env.instance.residentAssignments.set(row.id,'hachiware-dance');
  env.click('village-filters');output=JSON.stringify(env.render());assert.ok(output.includes('overview-motion'));
  env.click('overview-motion');assert.match(env.agentTheme.agentSprite(env.instance,row,true).path,/hachiware-dance\/\d{3}\.png$/);
  console.log('native animation: stable GIF/atlas resources over repeated loops and pause fallback passed');
}

// A child click can consume mouse-up before the viewport sees it. It must
// still end the pending grab; later unpressed motion never carries a character.
{
  const data=fixture(4);data.props={mode:'overview',skin:'chiikawa'};data.outside=[];
  const env=await environment(data,null);env.render();
  env.pointer('overview-t0','on_mouse_down',{position:{x:100,y:200}});
  assert.ok(env.instance.pointerDrag);
  env.click('overview-t0');
  assert.equal(env.instance.pointerDrag,null,'click ends its pending grab even without parent mouse-up');
  const actor=env.instance.villageActors.get('t0'), before=[actor.x,actor.y];
  env.pointer('agent-view','on_mouse_move',{position:{x:400,y:400}});
  assert.deepEqual([actor.x,actor.y],before,'unpressed motion after a click cannot move the character');
  env.render();
  env.pointer('overview-t0','on_mouse_down',{position:{x:100,y:200}});
  env.pointer('agent-view','on_mouse_move',{position:{x:140,y:250}});
  env.click('overview-t1');
  assert.equal(env.instance.pointerDrag,null);
  assert.equal(env.instance.villageSelected,'t0','dropping onto another resident does not select it');
  console.log('native click propagation: click cleanup, unpressed motion and cross-resident drops passed');
}

// Chat uses a synthetic transport only: never send a test message to a live agent.
{
  const data=fixture(4);data.props={mode:'overview',skin:'chiikawa'};
  const env=await environment(data,null);
  const getResult=(state='idle',overrides={})=>({code:0,stdout:JSON.stringify({state:'live',status:{state},foreground:{name:'claude'},...overrides})});
  const sent=()=>JSON.parse(JSON.stringify(env.commands.filter(([cmd,args])=>cmd==='hc' && args[0]==='send')));
  const edit=(chat,text)=>{chat.input.set_value(text);chat.input.emit('change');};
  let complete;
  data.execHook=async (_cmd,args)=>args[0]==='get' ? getResult() : new Promise(resolve=>{complete=resolve});
  env.render();env.click('overview-t0');env.render();
  const first=env.instance.villageChats.get('t0');
  assert.equal(env.commands.length,0,'render and selection perform no chat I/O');
  edit(first,'   ');first.input.emit('submit',{secondary:true});
  assert.equal(env.commands.length,0,'empty messages do nothing');
  const message='--literal\n$(not a shell command) 한글 메시지';
  edit(first,message);first.input.emit('submit',{secondary:true});
  assert.equal(env.commands.length,0,'Cmd+Enter does not send');
  first.input.emit('submit',{});
  first.input.emit('submit',{});
  await new Promise(setImmediate);
  assert.equal(sent().length,1,'pending sends cannot be duplicated');
  assert.deepEqual(sent()[0],['hc',['send','--json','--if','idle','--','t0',message],{timeout:90000}]);
  assert.match(JSON.stringify(env.render()),/Sending/);
  env.click('overview-t2');env.render();
  const second=env.instance.villageChats.get('t2');
  edit(second,'다른 에이전트 초안');
  complete({code:0,stdout:'{"turn":1,"started":false}'});await env.tasks.pop();
  assert.equal(first.input.value(),'','delivered text is cleared');
  assert.equal(second.input.value(),'다른 에이전트 초안','late response does not clear the selected agent draft');
  assert.match(first.receipt,/Delivered/);
  env.click('overview-t0');env.render();
  assert.equal(env.instance.villageChats.get('t0'),first,'switching residents retains the editor');
  edit(first,'보낼 메시지');first.input.emit('submit',{});
  await new Promise(setImmediate);
  edit(first,'전달 중에 새로 쓴 내용');
  complete({code:0,stdout:'{}'});await env.tasks.pop();
  assert.equal(first.input.value(),'전달 중에 새로 쓴 내용','same-agent edits survive a late response');
  data.execHook=async (_cmd,args)=>args[0]==='get' ? getResult('working') : {code:1,stderr:'timeout'};
  first.input.emit('submit',{});await env.tasks.pop();
  assert.match(first.error,/Check the terminal/);
  assert.equal(first.input.value(),'전달 중에 새로 쓴 내용');
  const failures=sent().length;
  for(let i=0;i<5;i++) env.render();
  assert.equal(sent().length,failures,'failures never auto-retry');
  for(const result of [getResult('blocked'),getResult('error'),getResult('idle',{state:'finished'}),getResult('idle',{foreground:{name:'zsh'}}),getResult('idle',{status:null}),{code:3,stdout:''},{code:0,stdout:'not JSON'}]) {
    data.execHook=async()=>result;
    first.input.emit('submit',{});await env.tasks.pop();
    assert.equal(sent().length,failures,'blocked, finished, shell and invalid preflights never send');
    assert.ok(first.error);
  }
  const beforeGuard=env.commands.length;
  data.terminals[0].state='finished';first.input.emit('submit',{});
  data.terminals[0].state='live';data.agents[0].status='blocked';first.input.emit('submit',{});
  data.agents[0].status='working';data.agents[0].program={agent:false};first.input.emit('submit',{});
  assert.equal(env.commands.length,beforeGuard,'host validation rejects stale, blocked and non-agent targets');
  data.agents[0].program={agent:true};
  edit(first,'x'.repeat(16001));first.input.emit('submit',{});
  assert.equal(env.commands.length,beforeGuard,'oversized drafts remain unsent');
  edit(first,'완료한 에이전트에게 후속 요청');
  data.execHook=async (_cmd,args)=>args[0]==='get' ? getResult('done') : {code:0,stdout:'{}'};
  env.render();env.click('village-send');await env.tasks.pop();
  assert.deepEqual(sent().at(-1)[1],['send','--json','--','t0','완료한 에이전트에게 후속 요청']);
  const external=env.overview.agentViewRows(data.outside).find(row=>row.external);
  env.render();env.click(`overview-${external.id}`);
  const externalUI=JSON.stringify(env.render());
  assert.ok(externalUI.includes('Continue this session in Herdr') && !externalUI.includes('village-send'),'outside sessions must be resumed before chatting');
  console.log('village chat: explicit send, exact target, multiline text, per-agent drafts, pending guard, late replies, failures and unavailable sessions passed');
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

// Saved history: a separate sidebar section, exact-session continuation only.
// Every exec/run below is the synthetic host; no real conversation is opened.
async function settleSaved(env) { while (env.tasks.length) await Promise.all(env.tasks.splice(0)); }
const savedId = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const savedRow = (n, agent='codex') => ({agent,session:savedId(n),cwd:"/example/space 'quotes' $(literal)",title:`Saved task ${n}`,updated:n});
for (const agent of ['claude','codex']) for (const grouped of [false,true]) {
  const data=fixture(4,grouped);data.outside=[];
  const store=new Map(),row=savedRow(1,agent),id=`saved-${agent}:${row.session}`;
  let env=await environment(data,null,store);
  assert.ok(JSON.stringify(env.render()).includes('saved-header'),'empty history still has an expandable header');
  data.execHook=async(_program,args)=>{
    assert.ok(args[1].endsWith('/saved.py') && args.length===2,'fold checks may only read synthetic history');
    return {code:0,stdout:JSON.stringify({rows:[row],errors:[]})};
  };
  const refresh=async()=>{env.instance.readingSaved=false;env.click('saved-refresh');await settleSaved(env);};
  await refresh();
  assert.ok(!JSON.stringify(env.render()).includes(id),`${agent}: newly loaded history starts collapsed`);
  assert.ok(!store.has('saved.expanded'),'initial load and Refresh do not choose a preference');
  env.click('saved-header');
  assert.ok(JSON.stringify(env.render()).includes(id),`${agent}: explicit expansion reveals history`);
  assert.equal(store.get('saved.expanded'),'true');
  await refresh();
  assert.ok(JSON.stringify(env.render()).includes(id),'Refresh keeps the explicit expansion');
  env.timers.get(45000)();await settleSaved(env);
  assert.ok(JSON.stringify(env.render()).includes(id),'background history refresh keeps the explicit expansion');
  data.state['agents.sort']=grouped?'priority':'grouped';
  assert.ok(JSON.stringify(env.render()).includes(id),'sorting keeps the explicit expansion');
  data.collapsed=true;
  assert.ok(!JSON.stringify(env.render()).includes('saved-header'),'the narrow rail hides history');
  data.collapsed=false;
  assert.ok(JSON.stringify(env.render()).includes(id),'returning from the rail keeps the explicit expansion');
  assert.ok(!env.writes.some(([key])=>key==='run'),'folding and Refresh issue no host commands');
  env=await environment(data,null,store);env.instance.saved=[row];
  assert.ok(JSON.stringify(env.render()).includes(id),'a recreated view restores explicit expansion');
  env.click('saved-header');
  assert.ok(!JSON.stringify(env.render()).includes(id),'explicit collapse hides history');
  assert.equal(store.get('saved.expanded'),'false');
  await refresh();
  assert.ok(!JSON.stringify(env.render()).includes(id),'Refresh keeps the explicit collapse');
  env.timers.get(45000)();await settleSaved(env);
  assert.ok(!JSON.stringify(env.render()).includes(id),'background history refresh keeps the explicit collapse');
  assert.equal(store.get('saved.expanded'),'false');
  assert.ok(!env.writes.some(([key])=>key==='run'),'preference restoration issues no host commands');
  env=await environment(data,null,store);env.instance.saved=[row];
  assert.ok(!JSON.stringify(env.render()).includes(id),'a recreated view restores explicit collapse');
}
for (const value of ['false','invalid']) {
  const env=await environment(fixture(0),null,new Map([['saved.expanded',value]]));
  env.instance.saved=[savedRow(1,'claude'),savedRow(2,'codex'),savedRow(3,'gemini'),savedRow(4,'opencode')];
  assert.ok(!JSON.stringify(env.render()).includes('Saved task'),'false or malformed preferences stay collapsed');
  env.click('saved-header');
  const text=JSON.stringify(env.render());
  assert.ok(text.includes('saved-claude:') && text.includes('saved-codex:'),'one expansion applies to both supported providers');
  assert.ok(!text.includes('saved-gemini:') && !text.includes('saved-opencode:'),'unregistered providers remain unsupported');
}
console.log('saved history folding: Claude/Codex defaults, explicit choices, refresh, sort, rail and view recreation passed');
{
  const data=fixture(8);data.outside=[];
  const env=await environment(data,null);
  env.instance.readingSaved=false;
  env.instance.saved=Array.from({length:14},(_,i)=>savedRow(i+1));
  env.instance.saved.push({...savedRow(14),title:'older duplicate',updated:0},null,{...savedRow(30),session:'--last'});
  data.state['wt.live']={[savedId(14)]:'t0',[savedId(13)]:'exited'};
  data.terminals[0].program={agent:true,key:'codex'};
  data.terminals.push({address:'exited',state:'exited'});
  env.instance.outside=[{...savedRow(12),status:'idle',app:'Elsewhere'}];
  env.instance.savedPending.set('codex:'+savedId(11),now+15000);
  env.render();env.click('saved-header');
  let tree=env.render(), text=JSON.stringify(tree);
  assert.ok(text.indexOf('saved-header')>text.indexOf('sec-1"'),'history follows the live Idle section');
  assert.ok(!text.includes('saved-codex:'+savedId(14)),'attached session excluded');
  assert.ok(text.includes('saved-codex:'+savedId(13)),'exited terminal mapping is not a live session');
  assert.ok(!text.includes('saved-codex:'+savedId(12)),'outside session excluded');
  assert.ok(!text.includes('saved-codex:'+savedId(11)),'opening session excluded');
  assert.equal((text.match(/"saved-codex:/g)||[]).length,8,'first page bounded');
  assert.ok(!data.state['ag.order'].some(id=>id.startsWith('saved')),'history not published as live order');
  assert.ok(!text.includes('older duplicate'));
  env.click('saved-more'); text=JSON.stringify(env.render());
  assert.equal((text.match(/"saved-codex:/g)||[]).length,11,'next page shows remaining unique entries');
  assert.ok(text.indexOf('saved-codex:'+savedId(13))<text.indexOf('saved-codex:'+savedId(10)),'newest first');
  env.click('saved-header');assert.ok(!JSON.stringify(env.render()).includes('saved-codex:'),'history folds independently');
  env.click('saved-header');
  data.state['agents.sort']='grouped';text=JSON.stringify(env.render());
  assert.ok(text.indexOf('saved-header')>text.indexOf('out-codex-'),'history also follows grouped activity');
  data.props={mode:'overview',skin:'chiikawa'};
  const residents=env.overview.agentViewRows(env.instance.outside);
  assert.ok(residents.every(row=>!row.id.startsWith('saved')),'history never creates village residents');
}
for (const agent of ['claude','codex']) for (const worktrees of [false,true]) {
  const data=fixture(0);data.outside=[];
  if(worktrees) data.layout={mod:'spaces-plus'};
  const row=savedRow(1,agent),env=await environment(data,null);
  env.instance.readingSaved=false;env.instance.saved=[row];
  const launch=agent==='codex'
    ? ['/opt/codex','resume','--last','--model','chosen','--cd','/wrong','--image','/old.png','-C/also-wrong','-i/old-attachment','old-id','old prompt']
    : ['/opt/claude','--continue','--resume','old-id','--fork-session','--model','chosen','old prompt'];
  data.state['new-menu.agents']={'':[{key:agent,installed:true,run:launch}]};
  data.execHook=async(_program,args)=>({code:0,stdout:JSON.stringify(args[2]==='check'
    ? {running:false,record:{...row,argv:['sh','-c','evil'],prompt:'do not submit',fork:true}}
    : args[1].endsWith('/session_handoff.py') ? {agent,session:row.session,state:'ready',cwd:row.cwd}
    : {rows:[],errors:[]})});
  env.instance.resumeSaved(row,env.cx);env.instance.resumeSaved(row,env.cx);
  await settleSaved(env);
  const runs=env.writes.filter(([key])=>key==='run').map(([,args])=>args);
  assert.equal(runs.length,1,`${agent}: duplicate click opens once`);
  let argv;
  if(worktrees){
    assert.ok(runs[0][0].startsWith('spaces-plus.resume@'));
    const rec=JSON.parse(runs[0][0].split('@')[1]);
    assert.equal(rec.session,row.session);assert.equal(rec.cwd,row.cwd);
    assert.equal(rec.prompt,undefined);assert.equal(rec.fork,undefined);
    // Use the same shared resume implementation as spaces-plus.
    const context=vm.createContext({});
    const host=new vm.SyntheticModule(['exec','readTextFile','home','appHome','shared','setShared','terminals','run'],function(){for(const key of ['exec','readTextFile','home','appHome','shared','setShared','terminals','run'])this.setExport(key,()=>{});},{context});
    const resume=new vm.SourceTextModule(readFileSync(resolve(root,'lib/resume.js'),'utf8'),{context});
    const launch=new vm.SourceTextModule(readFileSync(resolve(root,'lib/agent-launch.js'),'utf8'),{context});
    await launch.link(()=>{throw new Error('unexpected launch dependency')});await launch.evaluate();
    await resume.link(name=>name==='./agent-launch.js'?launch:host);await resume.evaluate();
    argv=Array.from(resume.namespace.resumeArgv(rec));
  }else{
    assert.equal(runs[0][0],'space.new');assert.equal(runs[0][1].folder,row.cwd);
    argv=Array.from(runs[0][1].argv);
  }
  assert.deepEqual(argv,agent==='codex'?['/opt/codex','resume','--dangerously-bypass-approvals-and-sandbox','--model','chosen',row.session]:['/opt/claude','--model','chosen','--resume',row.session]);
  assert.equal(env.commands[0][0],'python3');
  assert.deepEqual(JSON.parse(env.commands[0][1].at(-1)),{agent,session:row.session,cwd:row.cwd},'only identity sent to read-only check');
}
for (const failure of ['running','unknown','changed','invalid','missing','remote','parse']) {
  const data=fixture(0),env=await environment(data,null),row=savedRow(1);
  env.instance.readingSaved=false;env.instance.saved=[row];
  if(failure==='remote') data.state['new-menu.agents']={'':[{key:'codex',installed:true,run:['codex','--remote','server']}]};
  data.execHook=async()=>({code:failure==='missing'?1:0,stderr:'Gone',stdout:failure==='parse'?'invalid':JSON.stringify({
    running:failure==='running'?true:failure==='unknown'?null:false,
    record:failure==='changed'?{...row,session:savedId(2)}:failure==='invalid'?null:row})});
  env.instance.resumeSaved(row,env.cx);await settleSaved(env);
  assert.equal(env.writes.filter(([key])=>key==='run').length,0,`${failure}: no resume command`);
  assert.ok(env.instance.savedResumeError);
  assert.equal(env.instance.savedPending.size,0,'failed checks can be retried explicitly');
}
{
  const data=fixture(1),env=await environment(data,null),row=savedRow(1);
  env.instance.readingSaved=false;
  data.terminals[0].program={agent:true,key:'codex'};
  data.state['wt.live']={[row.session]:'t0'};
  env.instance.resumeSaved(row,env.cx);
  assert.equal(env.commands.length,0,'already attached goes directly to its pane');
  assert.ok(env.writes.some(([key,args])=>key==='run'&&args[0]==='pane.focus'&&args[1].terminal==='t0'));
  env.writes.length=0;delete data.state['wt.live'][row.session];
  data.execHook=async()=>{data.state['wt.live'][row.session]='t0';return {code:0,stdout:JSON.stringify({running:true,record:row})};};
  env.instance.resumeSaved(row,env.cx);await settleSaved(env);
  assert.ok(env.writes.some(([key,args])=>key==='run'&&args[0]==='pane.focus'));
  assert.ok(!env.writes.some(([key,args])=>key==='run'&&args[0]==='space.new'),'attachment racing with check is focused');
  env.writes.length=0;delete data.state['wt.live'][row.session];
  data.execHook=async()=>{data.state['wt.live'][row.session]='t0';return {code:1,stderr:'Ownership probe failed'};};
  env.instance.resumeSaved(row,env.cx);await settleSaved(env);
  assert.ok(env.writes.some(([key,args])=>key==='run'&&args[0]==='pane.focus'),'attachment wins even over failed saved check');
  assert.equal(env.instance.savedResumeError,null);
}
{
  const data=fixture(0),env=await environment(data,null),row=savedRow(1);
  env.instance.readingSaved=false;
  data.layout={mod:'spaces-plus'};data.state['wt.live']={[row.session]:'dead'};data.terminals=[{address:'dead',state:'exited'}];
  data.execHook=async(_program,args)=>({code:0,stdout:JSON.stringify(args[2]==='check'?{running:false,record:row}:args[1].endsWith('/session_handoff.py')?{agent:row.agent,session:row.session,state:'ready',cwd:row.cwd}:{rows:[],errors:[]})});
  env.instance.resumeSaved(row,env.cx);await settleSaved(env);
  assert.ok(env.writes.some(([key,args])=>key==='run'&&args[0].startsWith('spaces-plus.resume@')),'stale mapping is handled by the shared guard in spaces-plus');
  data.execHook=async()=>({code:0,stdout:JSON.stringify({rows:[null,...Array.from({length:80},(_,i)=>savedRow(i))],errors:['Provider unavailable']})});
  env.instance.readSaved(env.cx);await settleSaved(env);
  assert.equal(env.instance.saved.length,60);assert.equal(env.instance.savedError,'Provider unavailable');
  data.execHook=async()=>({code:0,stdout:'{bad'});
  env.instance.readSaved(env.cx);await settleSaved(env);
  assert.equal(env.instance.saved.length,0);assert.ok(env.instance.savedError);
}
// A terminal that returned to a shell is neither an attachment nor a reason
// to hide its saved history. Use the real Saved -> common guard path.
{
  const data=fixture(1),env=await environment(data,null),row=savedRow(1);
  data.terminals[0].program={agent:false,key:'zsh'};
  data.state['wt.live']={[row.session]:'t0'};
  env.instance.outside=[];env.instance.saved=[row];env.instance.readingSaved=false;
  env.render();env.click('saved-header');
  assert.ok(JSON.stringify(env.render()).includes('saved-codex:'+row.session),'shell mapping stays in Saved');
  data.execHook=async(_program,args)=>({code:0,stdout:JSON.stringify(args[2]==='check'
    ? {running:false,record:row}
    : args[1].endsWith('/session_handoff.py') ? {agent:row.agent,session:row.session,state:'ready',cwd:row.cwd}
    : {rows:[],errors:[]})});
  env.instance.resumeSaved(row,env.cx);await settleSaved(env);
  assert.ok(!env.writes.some(([key,args])=>key==='run'&&args[0]==='pane.focus'));
  assert.ok(env.writes.some(([key,args])=>key==='run'&&args[0]==='space.new'));
}
// Fresh common-guard failures must reach the saved error and clear pending,
// including failures returned asynchronously by the worktrees destination.
for(const worktrees of [false,true]) {
  const data=fixture(0),env=await environment(data,null),row=savedRow(1);
  env.instance.readingSaved=false;env.instance.saved=[row];
  if(worktrees) {data.layout={mod:'spaces-plus'};data.resumeReply={ok:false,error:'Writer acquired during handoff'};}
  data.execHook=async(_program,args)=>({code:0,stdout:JSON.stringify(args[2]==='check'
    ? {running:false,record:row}
    : {agent:row.agent,session:row.session,state:'active',reason:'Writer acquired during handoff'})});
  env.instance.resumeSaved(row,env.cx);await settleSaved(env);
  assert.equal(env.instance.savedResumeError,'Writer acquired during handoff');
  assert.equal(env.instance.savedPending.size,0);
  assert.ok(!env.writes.some(([key,args])=>key==='run'&&['space.new','tab.new'].includes(args[0])));
}
{
  const data=fixture(0),env=await environment(data,null);
  env.instance.saved=[{...savedRow(1),origin:'desktop',historyMode:'paginated',handoff:{state:'active',reason:'Writer retained; Idle is not released.'}},
    {...savedRow(2),handoff:{state:'unknown',reason:'Ownership probe failed.'}}];
  env.render();env.click('saved-header');
  const text=JSON.stringify(env.render());
  assert.ok(text.includes('Writer retained; Idle is not released.')&&text.includes('Ownership probe failed.'));
  assert.ok(text.includes('Codex app')&&text.includes('paginated history'));
}
console.log('saved history: below Idle, bounded pages, dedupe, independent residents, safe Claude/Codex payloads and check failures passed');

// Optional native GPUI smoke/limit check with the SAME synthetic data. No live app
// state is read, and these temporary mods are never installed in the user's layout.
if (process.argv.includes('--native')) {
  const failures=[];
  let checked=0, baselineInterrupted=0;
  for (const [count,depth,mode] of [[40,1,'sidebar'],[200,1,'sidebar'],[120,5,'sidebar'],[40,1,'overview'],[200,1,'overview'],[40,1,'chiikawa'],[200,1,'chiikawa'],[40,1,'chiikawa-cards'],[4,1,'chiikawa-cards-narrow'],[4,1,'chiikawa-approval'],[0,1,'dock-placeholder'],[4,1,'chiikawa-dock-placeholder'],[4,1,'dock-terminal-only'],[4,1,'terminal-toolbar']]) for (const revision of process.argv.includes('--baseline-native') ? ['HEAD'] : before ? [before,null] : [null]) {
    if (process.argv.includes('--overview-only') && mode === 'sidebar') continue;
    if (revision && mode !== 'sidebar') continue;
    const directory=mkdtempSync(resolve(tmpdir(),'herdr-agents-bench-'));
    try {
      const read=file=>revision ? execFileSync('git',['show',`${revision}:${file}`],{cwd:root,encoding:'utf8'}) : readFileSync(resolve(root,file),'utf8');
      const revisionFiles=revision ? new Set(execFileSync('git',['ls-tree','-r','--name-only',revision,'lib','mods/agents-plus'],{cwd:root,encoding:'utf8'}).trim().split('\n')) : null;
      const has=file=>revisionFiles ? revisionFiles.has(file) : existsSync(resolve(root,file));
      for (const name of ['state','ui','agent-status','resume','agent-launch','places','saved-sessions']) if(has(`lib/${name}.js`)) writeFileSync(resolve(directory,`${name}.js`),read(`lib/${name}.js`).replaceAll('from "herdr"','from "./mock-herdr.js"'));
      writeFileSync(resolve(directory,'agents.js'),read('mods/agents-plus/main.js').replaceAll('from "herdr"','from "./mock-herdr.js"'));
      for (const file of ['overview','overview-header','agent-theme','theme-assets','pack-chiikawa','resource-packs','resource-pack-state','themes','legacy-theme','agent-mode','theme-contrast','village','village-spacing','village-chat','session-controls','approval-providers','terminal-dock','workspace-controls','composer','drag-layout','sprite-directions','resident-assignment','sprite-layout','sprite-art','sprite-motion','agent-empty-state']) if(has(`mods/agents-plus/${file}.js`)) writeFileSync(resolve(directory,`${file}.js`),read(`mods/agents-plus/${file}.js`).replaceAll('from "herdr"','from "./mock-herdr.js"'));
      if (has('mods/agents-plus/render-profile.js'))
        writeFileSync(resolve(directory,'render-profile.js'),read('mods/agents-plus/render-profile.js'));
      const data=fixture(count,false,false,depth);
      if (mode==='terminal-toolbar') data.layout=splitWorkspaceLayout(0.5);
      if (mode.includes('dock-')) {
        data.layout=splitWorkspaceLayout(mode==='dock-terminal-only'?0:0.6);
        data.focused={pane:'legacy',tab:'legacy-tab'};
        data.panes.push({pane:'legacy',tab:'legacy-tab',mod:'agents-plus',title:'Agent view'});
      }
      data.saved = !revision && mode === 'sidebar' ? Array.from({length:12},(_,i)=>savedRow(i+1)) : [];
      if (mode==='chiikawa-cards-narrow') {
        data.panes[0].title='A long session title for a narrow card with a readable project and branch';
        data.state['ag.info']={t3:{doing:'Please review the full build command before approving this request.',at:now}};
      }
      writeFileSync(resolve(directory,'mock-herdr.js'),`
const data=${JSON.stringify(data)};
const copy=x=>JSON.parse(JSON.stringify(x??null));
export const agents=()=>copy(data.agents), terminals=()=>copy(data.terminals), spaces=()=>copy(data.spaces), panes=()=>copy(data.panes);
export const shared=k=>copy(data.state[k]), setShared=(k,v)=>{data.state[k]=v}, setAgentOrder=()=>{};
export const focused=()=>data.focused??({agent:'t0',terminal:'t0',tab:'b0'}), layout=()=>data.layout??({id:'sidebar',size:{px:268}}), layouts=()=>['main'], props=()=>({mode:'${mode.startsWith('chiikawa')||mode.includes('dock-')?'overview':mode}'}), window=()=>({active:true});
export const settings=()=>({theme:'paper',dark:false});
export const nextCommand=()=>new Promise(()=>{});
export const themes=()=>[{name:'paper',light:true},{name:'herdr-chiikawa',light:true},{name:'graphite',light:false},{name:'atom-one-dark',light:false}];
export const theme=()=>Object.fromEntries(['foreground','solid','solid_foreground','muted','dim','raised','hover','input','chrome','border','working','blocked','done','idle','accent','selected','ansi5','popover','background'].map(k=>[k,'#123456']));
export const run=()=>{},notify=()=>{},openOverlay=()=>{},closeOverlay=()=>{},exec=async()=>({code:0,stdout:'[]'}),appHome=()=>'/example/app',home=()=>'/example',readTextFile=async()=>'{}',writeTextFile=async()=>{};
export const outside=data.outside;
export const saved=data.saved;
`);
      writeFileSync(resolve(directory,'main.js'),`
import Agents from './agents.js';
import { outside, saved } from './mock-herdr.js';
import { InputState } from 'gpui-base';
${!revision ? "import { selectVillageResident } from './village-chat.js';\nimport { agentViewRows } from './overview.js';" : ''}
export default class Probe extends Agents {
 init(_props,cx) { this.folded=new Set();this.outside=outside;this.changed={};this.seen={};this.raw=new Map();this.pendingPins=[];this.migratingPins=new Set();this.activity={};this.saved=saved;this.savedLimit=8;this.savedPending=new Map();
   if ('${mode}'!=='sidebar') {this.input=InputState.new({value:''});this.handle=cx.focus_handle();this.statusFilter='all';this.sourceFilter='all';this.pack='${mode.startsWith('chiikawa')?'chiikawa':'default'}';this.presentation='${mode.startsWith('chiikawa-cards')?'cards':'village'}';this.themeClock=0;this.width=${mode.endsWith('-narrow')?360:1100};}
   ${!revision ? `if ('${mode}'==='chiikawa' && ${count}===40) {selectVillageResident(this,agentViewRows(outside).find(row=>row.id==='t0'),cx);this.villageFilters=true;}
   if ('${mode}'==='chiikawa-approval') { selectVillageResident(this,agentViewRows(outside).find(row=>row.id==='t3'),cx); const chat=this.villageChats.get('t3');chat.request={address:'t3',text:'Run unit tests?\\n› 1. Yes\\n  2. No',fingerprint:'fixture',choices:[{number:1,label:'Yes',selected:true},{number:2,label:'No'}]}; }` : ''} }
 render(cx) { const start=Date.now();const result=super.render(cx);console.error('BENCH_RENDER_MS='+String(Date.now()-start));return result; }
}
`);
      const result=spawnSync('herdr-app',['check',directory],{encoding:'utf8',timeout:10000});
      const output=result.stdout+result.stderr;
      checked++;
      console.log('native',mode,count,'depth',depth,revision??'working-tree',JSON.stringify({passed:result.status===0,interrupted:output.includes('interrupted'),timing:output.match(/BENCH_RENDER_MS=\d+/g)}));
      if(result.status!==0 && (!revision || !output.includes('interrupted'))) {
        failures.push(`${mode}/${count}/depth-${depth}/${revision??'working-tree'}`);
        console.error(output);
      } else if(result.status!==0) baselineInterrupted++;
    } finally { rmSync(directory,{recursive:true,force:true}); }
  }
  console.log(`native scenarios: ${checked} checked, ${failures.length} failed, ${baselineInterrupted} baseline interrupted`);
  if(failures.length) throw new Error(`Native scenarios failed: ${failures.join(', ')}`);
}
