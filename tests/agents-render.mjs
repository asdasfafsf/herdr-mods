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
function findNode(node,id) {
  return node?.id===id ? node : node?.children?.map(child=>findNode(child,id)).find(Boolean);
}
async function environment(data, revision) {
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
          node.ops.push([key, args.map(v => typeof v === 'function' ? '[callback]' : v)]);
        }
        return proxy;
      };
    }});
    return proxy;
  }
  const theme = Object.fromEntries(['foreground','solid','solid_foreground','muted','dim','raised','hover','input','chrome','border','working','blocked','done','idle','accent','selected','ansi5'].map(k => [k, '#123456']));
  const host = {
    agents: () => cloneRead('agents', data.agents), terminals: () => cloneRead('terminals', data.terminals), panes: () => cloneRead('panes', data.panes), spaces: () => cloneRead('spaces', data.spaces),
    shared: key => cloneRead(`shared:${key}`, data.state[key]), setShared: (key, value) => { data.state[key] = structuredClone(value); writes.push([key,value]); },
    setAgentOrder: value => writes.push(['setAgentOrder',value]),
    focused: () => data.focused ?? ({agent:'t0',terminal:'t0',pane:'p0',tab:'b0'}), layout: () => data.layout ?? ({id:'root',type:'row',children:[{id:'sidebar',size:{px:data.collapsed ? 76 : 268}},{id:'main',type:'block',content:{tab:'active'}}]}), layouts:()=>data.layouts ?? ['main'], props: () => data.props ?? {}, theme: () => theme, window: () => ({active:data.windowActive ?? true}),
    run: (...args) => {writes.push(['run',args]);if(args[0]==='layout.set') data.layout=structuredClone(args[1].layout); if(args[0]==='layout.clone') {data.state.layout=args[1].as;data.layouts=['main',args[1].as];}if(args[0]==='layout.switch') data.state.layout=args[1].name; if(args[0]==='layout.select') findNode(data.layout,args[1].stack).active=args[1].child;}, openOverlay: value => writes.push(['openOverlay',value]), closeOverlay: value => writes.push(['closeOverlay',value]), exec: async (...args) => { commands.push(args); return data.execHook ? data.execHook(...args) : ({code:0,stdout:'[]'}); }, appHome: () => '/example/app', home: () => '/example', readTextFile: async () => data.settingsRaw ?? '{}', writeTextFile: async (_path, text, expected) => { assert.equal(expected, data.settingsRaw ?? '{}'); data.settingsRaw=text; },
  };
  const store = new Map();
  const context = vm.createContext({ console, Date: class extends Date { static now() { return now + (data.elapsed ?? 0); } }, localStorage: { getItem:k => store.get(k), setItem:(k,v) => store.set(k,v), removeItem:k => store.delete(k) } });
  const modules = new Map();
  const synthetic = (id, exports) => new vm.SyntheticModule(Object.keys(exports), function() { for(const [k,v] of Object.entries(exports)) this.setExport(k,v); }, {context,identifier:id});
  modules.set('herdr',synthetic('herdr',host));
  modules.set('gpui-kit',synthetic('gpui-kit',{View:class {},div:()=>builder('div'),image:s=>builder('image',s),svg:s=>builder('svg',s)}));
  const textState={new:({value=''}={})=>({text:value,events:{},value(){return this.text},set_value(value){this.text=value},on(event,fn){this.events[event]=fn},focus(){},emit(event,payload={}){this.events[event]?.(payload,cx)}})};
  modules.set('gpui-base',synthetic('gpui-base',{h_flex:()=>builder('h_flex'),v_flex:()=>builder('v_flex'),
    InputState:textState,TextareaState:textState,
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
  const cx = {spawn(fn){if(runTasks) tasks.push(fn(cx));},timer:{every(ms,handler){timers.set(ms,()=>handler(cx));}},notify(){},stop_propagation(){},focus_handle(){return {};}};
  instance.init({},cx); instance.outside=data.outside;
  runTasks=true;
  instance.activity=Object.fromEntries(data.agents.map(a=>[a.address,{doing:'Editing example',said:'Example result'}]));
  const render = () => { handlers.clear(); return JSON.parse(JSON.stringify(instance.render(cx))); };
  const click = id => { assert.ok(handlers.has(id),`missing click target ${id}`); handlers.get(id)({},cx); };
  return {instance,calls,writes,render,data,click,timers,tasks,commands,cx,ui:modules.get('lib/ui.js').namespace,state:modules.get('lib/state.js').namespace,overview:modules.get('mods/agents-plus/overview.js')?.namespace,agentTheme:modules.get('mods/agents-plus/agent-theme.js')?.namespace,village:modules.get('mods/agents-plus/village.js')?.namespace,chat:modules.get('mods/agents-plus/village-chat.js')?.namespace,mode:modules.get('mods/agents-plus/agent-mode.js')?.namespace};
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

// Overview includes every project and live child, filters without changing the
// sidebar order, focuses local panes and peeks at children without panes.
{
  const data=fixture(4);
  data.props={mode:'overview',presentation:'cards'};
  data.outside=[{agent:'codex',pid:99,session:'one',cwd:'/example/repo-0/work-0',title:'External one',status:'working',updated:1},
    {agent:'codex',pid:99,session:'two',cwd:'/another',title:'External two',status:'blocked',updated:2}];
  const env=await environment(data,null);
  env.render();
  assert.equal(env.writes.length,0,'overview rendering must not change sidebar state');
  let rows=env.overview.agentViewRows(data.outside);
  assert.equal(rows.length,7,'4 agents, 1 child and 2 sessions on the same PID');
  assert.equal(env.overview.filterAgentRows(rows,'External').length,2);
  assert.equal(env.overview.filterAgentRows(rows,'','all','child').length,1);
  assert.equal(env.overview.filterAgentRows(rows,'repo-3','blocked').length,1);
  env.click('overview-t1');
  assert.deepEqual(JSON.parse(JSON.stringify(env.writes.at(-1))),['run',['pane.focus',{pane:'p1'}]]);
  env.click('overview-child-0-0');
  assert.deepEqual(JSON.parse(JSON.stringify(env.writes.at(-1))),['run',['terminal.peek',{terminal:'child-0-0'}]]);
  // Use the actual key exported by state.js rather than an assumed storage name.
  env.data.state[env.state.LIVE]={one:'t0'};
  rows=env.overview.agentViewRows(data.outside);
  assert.equal(rows.length,6,'a session already represented in Herdr is deduplicated');
  env.instance.input.text='no match';
  assert.match(JSON.stringify(env.render()),/No matching agents/);
  env.instance.input.text='';
  env.click('village-filters');env.render();env.click('overview-status-blocked');
  const filtered=JSON.stringify(env.render());
  assert.ok(filtered.includes('overview-t3'));
  assert.ok(!filtered.includes('overview-t0"'));
  const sidebarData=fixture(1);sidebarData.layout=workspaceLayout();sidebarData.state.layout='herdr-worktrees';
  const sidebar=await environment(sidebarData,null);
  sidebar.render();sidebar.click('ag-view');
  assert.equal(sidebar.writes.some(([,args])=>args[0]==='layout.clone'),false,'view switching must not create a layout');
  assert.match(JSON.stringify(sidebar.data.layout),/agent-world/);
  assert.equal(sidebar.writes.some(([,args])=>args[0]==='tab.new'),false,'Agent mode must not add a tab');
  sidebar.data.panes.push({pane:'board',mod:'agents-plus',tab:'board-tab'});
  sidebar.render();sidebar.click('ag-view');
  assert.equal(sidebar.data.state.layout,'herdr-worktrees');
  assert.equal(findNode(sidebar.data.layout,'workspace-views').active,'agent-world');
  console.log('agent overview: all projects, child agents, shared-PID sessions, deduplication, filters and navigation passed');
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
  env.click('overview-theme-chiikawa');
  const themed=JSON.stringify(env.render());
  assert.equal(env.instance.skin,'chiikawa');
  assert.equal(env.instance.page,page,'changing a theme keeps the current page');
  assert.deepEqual(ids(themed),ids(before),'themes show the same agents in the same order');
  assert.ok(themed.includes('chiikawa-village'),'the Chiikawa theme displays the village');
  assert.match(themed,/chiikawa\/(done|idle|hachiware|rakko|momonga|kurimanju)\/\d{3}\.png/);
  const residents=new Set(Array.from({length:12},(_,i)=>env.agentTheme.agentSprite(env.instance,{id:`t${i}`,status:'idle'},true).name));
  for(const name of env.agentTheme.RESIDENTS) assert.ok(residents.has(name),`resident ${name} is reachable`);
  for(const status of ['working','blocked','done','seen','idle']) assert.equal(env.agentTheme.agentSprite(env.instance,{id:'t0',status},true).name,env.agentTheme.agentSprite(env.instance,{id:'t0',status:'idle'},true).name,'identity remains stable across status changes');
  assert.ok(!themed.includes('village-details') && !themed.includes('village-filter-panel'),'the initial village has no persistent panels');
  const reads=env.calls.agents;env.instance.themeClock=500;env.render();
  assert.equal(env.calls.agents,reads,'animation reuses host snapshots');
  data.windowActive=false;data.elapsed=100;env.timers.get(50)();
  assert.equal(env.instance.themeClock,600,'a visible overview animates without window focus');
  env.click('overview-motion');assert.equal(env.instance.motionPaused,true);
  data.elapsed=150;env.timers.get(50)();
  assert.equal(env.instance.themeClock,600,'motion pause freezes playback');
  env.click('overview-motion');data.elapsed=1000;env.timers.get(50)();
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
  env.render();env.click('overview-theme-default');
  assert.equal(env.instance.skin,'default');
  assert.deepEqual(ids(JSON.stringify(env.render())),ids(before));
  env.click('overview-theme-chiikawa');env.render();env.click('village-filters');env.render();env.click('overview-status-working');
  assert.equal(env.instance.page,0);
  env.instance.input.text='Task 0';env.render();
  const priorWrites=env.writes.length;
  env.click('overview-t0');
  assert.equal(env.writes.length,priorWrites,'selecting a resident does not navigate away');
  assert.match(JSON.stringify(env.render()),/village-details/);
  env.click('village-open-session');
  assert.deepEqual(JSON.parse(JSON.stringify(env.writes.at(-1))),['run',['pane.focus',{pane:'p0'}]]);
  env.render();env.click('village-close');
  assert.ok(!JSON.stringify(env.render()).includes('village-details'),'details can be dismissed');
  assert.notEqual(env.agentTheme.spriteFrame('walk',0),env.agentTheme.spriteFrame('walk',500));
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
      for(let frame=0;frame<100;frame++) {view.themeClock+=50;env.village.advanceVillage(view,rows,layout);}
      assert.equal(actor.x,x);assert.equal(actor.y,y,'selected residents stop for inspection');
    }
  }
  console.log('agent themes: shared sessions, opt-in filters/details, roaming bounds, motion pause, selection and navigation passed');
}

// Integrated mode uses the same rows, with quiet residents following native focus.
{
  const data=fixture(4);data.props={mode:'overview',integrated:true,skin:'chiikawa'};
  data.state.layout='herdr-worktrees';data.state['ag.workspaceTheme']='chiikawa';data.layout=workspaceLayout('agent-world');data.outside=[];
  const env=await environment(data,null);
  let output=JSON.stringify(env.render());
  assert.ok(output.includes('overview-t0') && output.includes('overview-t3'));
  assert.ok(output.includes('overview-t1'),'seen agents stay visible');
  assert.ok(!output.includes('overview-t2"'),'idle agents are absent until focused');
  assert.equal(data.layout.theme,'paper');assert.equal(data.layout.colors.chrome,'#f4ecdb','the shared layout gets the same theme tokens');
  data.focused={terminal:'t2',pane:'p2',tab:'b2'};env.timers.get(250)();
  output=JSON.stringify(env.render());
  assert.ok(output.includes('overview-t2') && output.includes('village-message-t2'));
  data.focused={terminal:'t1',pane:'p1',tab:'b1'};env.timers.get(250)();
  output=JSON.stringify(env.render());
  assert.ok(output.includes('overview-t1') && !output.includes('overview-t2"'),'previous quiet selection disappears');
  env.click('overview-t0');
  assert.deepEqual(JSON.parse(JSON.stringify(env.writes.at(-1))),['run',['pane.focus',{pane:'p0'}]]);
  env.mode.renderViewSwitch();env.click('overview-layout-cards');env.timers.get(50)();
  output=JSON.stringify(env.render());
  assert.ok(!output.includes('chiikawa-village') && output.includes('chiikawa/'),'cards keep the theme characters');
  env.mode.renderViewSwitch();env.click('overview-layout-village');env.timers.get(50)();env.mode.renderViewSwitch();env.click('workspace-theme-default');env.timers.get(50)();
  assert.equal(data.layout.colors,undefined,'default restores the original layout palette');
  env.mode.renderViewSwitch();env.click('workspace-theme-chiikawa');env.timers.get(50)();
  env.mode.leaveAgentMode();
  assert.equal(data.layout.colors.chrome,'#f4ecdb','whole-workspace theme survives presentation changes');
  assert.equal(data.state.layout,'herdr-worktrees','switching presentation keeps the same workspace');
  assert.equal(findNode(data.layout,'workspace-views').active,'main','terminal presentation restores the original tab tree');
  assert.equal(data.focused.terminal,'t1','presentation does not choose another session');
  assert.equal(env.writes.some(([,args])=>['layout.clone','layout.switch','tab.new'].includes(args?.[0])),false);
  env.mode.openAgentMode();
  assert.equal(findNode(data.layout,'workspace-views').active,'agent-world');
  env.render();env.click('overview-child-0-0');
  assert.equal(env.writes.some(([,args])=>args?.[0]==='terminal.peek'),false,'child selection must not expose a terminal');
  console.log('Agent mode: shared palette, cards/village, quiet visibility, bidirectional focus and exit passed');
}

// Read-required bubbles follow host unread state without acknowledging on sight.
{
  const data=fixture(4);data.props={mode:'overview',skin:'chiikawa'};data.outside=[];
  delete data.state['ag.acked'].t1;
  data.state['ag.info']={t1:{said:'수정 완료: 결과를 확인해주세요.',at:now},t3:{doing:'이 명령을 실행하도록 승인해주세요.',at:now}};
  const env=await environment(data,null);
  let output=JSON.stringify(env.render());
  assert.ok(output.includes('village-status-t0') && output.includes('작업 중'));
  assert.ok(output.includes('village-status-t2') && output.includes('쉬는 중'));
  assert.ok(!output.includes('village-notice-t0') && !output.includes('village-notice-t2'));
  for(const text of ['village-notice-t1','village-notice-t3','수정 완료: 결과를 확인해주세요.','이 명령을 실행하도록 승인해주세요.']) assert.ok(output.includes(text),text);
  assert.equal(env.writes.length,0,'showing unread messages never marks them read');
  const waiting=env.instance.villageActors.get('t3'), position=[waiting.x,waiting.y];
  for(let i=0;i<100;i++) {env.instance.themeClock+=50;env.render();}
  assert.deepEqual([waiting.x,waiting.y],position,'residents with unread work stand still');
  env.click('village-notice-t1');
  assert.equal(env.instance.villageSelected,'t1');
  assert.equal(env.writes.length,0,'previewing a bubble does not acknowledge the host session');
  data.state['ag.acked'].t1=now;
  data.agents[3].status='working';
  data.elapsed=2100;
  output=JSON.stringify(env.render());
  assert.ok(!output.includes('village-notice-t1') && !output.includes('village-notice-t3'),'read or resumed work removes its bubble');
  assert.ok(output.includes('village-status-t1') && output.includes('확인함'));
  for(const width of [360,640,1100]) {
    const layout=env.village.villageLayout(width,600,24,24);
    for(const x of [layout.left,layout.right]) for(const y of [layout.top,layout.bottom]) {
      const box=env.village.noticeBounds({x,y},layout);
      assert.ok(box.left>=0 && box.left+box.width<=width && box.top>=0 && box.top+box.height<=layout.height,'speech bubbles fit within the village');
    }
  }
  console.log('village status: current state, real unread previews, no automatic acknowledgement, stable reading and clearing passed');
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
  edit(first,message);first.input.emit('submit',{});
  assert.equal(env.commands.length,0,'plain Enter does not send');
  first.input.emit('submit',{secondary:true});
  first.input.emit('submit',{secondary:true});
  await new Promise(setImmediate);
  assert.equal(sent().length,1,'pending sends cannot be duplicated');
  assert.deepEqual(sent()[0],['hc',['send','--json','--if','idle','--','t0',message],{timeout:90000}]);
  assert.match(JSON.stringify(env.render()),/전달 중/);
  env.click('overview-t2');env.render();
  const second=env.instance.villageChats.get('t2');
  edit(second,'다른 에이전트 초안');
  complete({code:0,stdout:'{"turn":1,"started":false}'});await env.tasks.pop();
  assert.equal(first.input.value(),'','delivered text is cleared');
  assert.equal(second.input.value(),'다른 에이전트 초안','late response does not clear the selected agent draft');
  assert.match(first.receipt,/전달했어요/);
  env.click('overview-t0');env.render();
  assert.equal(env.instance.villageChats.get('t0'),first,'switching residents retains the editor');
  edit(first,'보낼 메시지');first.input.emit('submit',{secondary:true});
  await new Promise(setImmediate);
  edit(first,'전달 중에 새로 쓴 내용');
  complete({code:0,stdout:'{}'});await env.tasks.pop();
  assert.equal(first.input.value(),'전달 중에 새로 쓴 내용','same-agent edits survive a late response');
  data.execHook=async (_cmd,args)=>args[0]==='get' ? getResult('working') : {code:1,stderr:'timeout'};
  first.input.emit('submit',{secondary:true});await env.tasks.pop();
  assert.match(first.error,/도착 여부/);
  assert.equal(first.input.value(),'전달 중에 새로 쓴 내용');
  const failures=sent().length;
  for(let i=0;i<5;i++) env.render();
  assert.equal(sent().length,failures,'failures never auto-retry');
  for(const result of [getResult('blocked'),getResult('error'),getResult('idle',{state:'finished'}),getResult('idle',{foreground:{name:'zsh'}}),getResult('idle',{status:null}),{code:3,stdout:''},{code:0,stdout:'not JSON'}]) {
    data.execHook=async()=>result;
    first.input.emit('submit',{secondary:true});await env.tasks.pop();
    assert.equal(sent().length,failures,'blocked, finished, shell and invalid preflights never send');
    assert.ok(first.error);
  }
  const beforeGuard=env.commands.length;
  data.terminals[0].state='finished';first.input.emit('submit',{secondary:true});
  data.terminals[0].state='live';data.agents[0].status='blocked';first.input.emit('submit',{secondary:true});
  data.agents[0].status='working';data.agents[0].program={agent:false};first.input.emit('submit',{secondary:true});
  assert.equal(env.commands.length,beforeGuard,'host validation rejects stale, blocked and non-agent targets');
  data.agents[0].program={agent:true};
  edit(first,'x'.repeat(16001));first.input.emit('submit',{secondary:true});
  assert.equal(env.commands.length,beforeGuard,'oversized drafts remain unsent');
  edit(first,'완료한 에이전트에게 후속 요청');
  data.execHook=async (_cmd,args)=>args[0]==='get' ? getResult('done') : {code:0,stdout:'{}'};
  env.render();env.click('village-send');await env.tasks.pop();
  assert.deepEqual(sent().at(-1)[1],['send','--json','--','t0','완료한 에이전트에게 후속 요청']);
  env.render();env.click('overview-child-0-0');env.render();
  const child=env.instance.villageChats.get('child-0-0');edit(child,'하위 작업 확인');
  env.render();env.click('village-send');await env.tasks.pop();
  assert.equal(sent().at(-1)[1].at(-2),'child-0-0','pane-less children keep their own address');
  const external=env.overview.agentViewRows(data.outside).find(row=>row.external);
  env.render();env.click(`overview-${external.id}`);
  const externalUI=JSON.stringify(env.render());
  assert.ok(externalUI.includes('Herdr에서 이어 열면') && !externalUI.includes('village-send'),'outside sessions must be resumed before chatting');
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

// Optional native GPUI smoke/limit check with the SAME synthetic data. No live app
// state is read, and these temporary mods are never installed in the user's layout.
if (process.argv.includes('--native')) {
  for (const [count,depth,mode] of [[40,1,'sidebar'],[200,1,'sidebar'],[120,5,'sidebar'],[40,1,'overview'],[200,1,'overview'],[40,1,'chiikawa'],[200,1,'chiikawa'],[40,1,'chiikawa-cards']]) for (const revision of process.argv.includes('--baseline-native') ? ['HEAD'] : before ? [before,null] : [null]) {
    if (process.argv.includes('--overview-only') && mode === 'sidebar') continue;
    if (revision && mode !== 'sidebar') continue;
    const directory=mkdtempSync(resolve(tmpdir(),'herdr-agents-bench-'));
    try {
      const read=file=>revision ? execFileSync('git',['show',`${revision}:${file}`],{cwd:root,encoding:'utf8'}) : readFileSync(resolve(root,file),'utf8');
      for (const name of ['state','ui','resume','places']) writeFileSync(resolve(directory,`${name}.js`),read(`lib/${name}.js`).replaceAll('from "herdr"','from "./mock-herdr.js"'));
      writeFileSync(resolve(directory,'agents.js'),read('mods/agents-plus/main.js').replaceAll('from "herdr"','from "./mock-herdr.js"'));
      if (!revision) for (const file of ['overview','overview-header','agent-theme','theme-assets','themes','agent-mode','village','village-chat']) writeFileSync(resolve(directory,`${file}.js`),read(`mods/agents-plus/${file}.js`).replaceAll('from "herdr"','from "./mock-herdr.js"'));
      if (!revision || execFileSync('git',['ls-tree',revision,'mods/agents-plus/render-profile.js'],{cwd:root,encoding:'utf8'}).trim())
        writeFileSync(resolve(directory,'render-profile.js'),read('mods/agents-plus/render-profile.js'));
      const data=fixture(count,false,false,depth);
      writeFileSync(resolve(directory,'mock-herdr.js'),`
const data=${JSON.stringify(data)};
const copy=x=>JSON.parse(JSON.stringify(x??null));
export const agents=()=>copy(data.agents), terminals=()=>copy(data.terminals), spaces=()=>copy(data.spaces), panes=()=>copy(data.panes);
export const shared=k=>copy(data.state[k]), setShared=(k,v)=>{data.state[k]=v}, setAgentOrder=()=>{};
export const focused=()=>({agent:'t0',terminal:'t0',tab:'b0'}), layout=()=>({id:'sidebar',size:{px:268}}), layouts=()=>['main'], props=()=>({mode:'${mode.startsWith('chiikawa')?'overview':mode}'}), window=()=>({active:true});
export const theme=()=>Object.fromEntries(['foreground','solid','solid_foreground','muted','dim','raised','hover','input','chrome','border','working','blocked','done','idle','accent','selected','ansi5','popover','background'].map(k=>[k,'#123456']));
export const run=()=>{},openOverlay=()=>{},closeOverlay=()=>{},exec=async()=>({code:0,stdout:'[]'}),appHome=()=>'/example/app',home=()=>'/example',readTextFile=async()=>'{}',writeTextFile=async()=>{};
export const outside=data.outside;
`);
      writeFileSync(resolve(directory,'main.js'),`
import Agents from './agents.js';
import { outside } from './mock-herdr.js';
import { InputState } from 'gpui-base';
${!revision ? "import { selectVillageResident } from './village-chat.js';\nimport { agentViewRows } from './overview.js';" : ''}
export default class Probe extends Agents {
 init(_props,cx) { this.folded=new Set();this.outside=outside;this.changed={};this.seen={};this.raw=new Map();this.pendingPins=[];this.migratingPins=new Set();this.activity={};
   if ('${mode}'!=='sidebar') {this.input=InputState.new({value:''});this.handle=cx.focus_handle();this.statusFilter='all';this.sourceFilter='all';this.skin='${mode.startsWith('chiikawa')?'chiikawa':'default'}';this.presentation='${mode==='chiikawa-cards'?'cards':'village'}';this.themeClock=0;}
   ${!revision ? `if ('${mode}'==='chiikawa' && ${count}===40) {selectVillageResident(this,agentViewRows(outside).find(row=>row.id==='t0'),cx);this.villageFilters=true;}` : ''} }
 render(cx) { const start=Date.now();const result=super.render(cx);console.error('BENCH_RENDER_MS='+String(Date.now()-start));return result; }
}
`);
      const result=spawnSync('herdr-app',['check',directory],{encoding:'utf8',timeout:10000});
      const output=result.stdout+result.stderr;
      console.log('native',mode,count,'depth',depth,revision??'working-tree',JSON.stringify({passed:result.status===0,interrupted:output.includes('interrupted'),timing:output.match(/BENCH_RENDER_MS=\d+/g)}));
      if(result.status!==0 && (!revision || !output.includes('interrupted'))) throw new Error(output);
    } finally { rmSync(directory,{recursive:true,force:true}); }
  }
}
