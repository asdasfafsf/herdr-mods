import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const context=vm.createContext({console});
const state={};
let result, probes=0, terminalRows=[], commands=[], duringProbe=null;
const host={
  shared:k=>state[k],setShared:(k,v)=>{state[k]=v},home:()=>'/home/test',appHome:()=>'/app',readTextFile:async()=>null,
  terminals:()=>terminalRows, run:(...args)=>commands.push(args),
  exec:async()=>{probes++;if(duringProbe) await duringProbe();return {code:0,stdout:JSON.stringify(result)}},
};
const herdr=new vm.SyntheticModule(Object.keys(host),function(){for(const [k,v] of Object.entries(host))this.setExport(k,v)},{context});
const launchModule=new vm.SourceTextModule(readFileSync('lib/agent-launch.js','utf8'),{context});
await launchModule.link(()=>{throw new Error('unexpected launch dependency')});await launchModule.evaluate();
const linker=name=>name==='./agent-launch.js'?launchModule:herdr;
const module=new vm.SourceTextModule(readFileSync('lib/resume.js','utf8'),{context});
await module.link(linker);await module.evaluate();
const {resumeSession,inspectSession,AGENTS,resumeArgv,nativeSessionUrl,agentKind,focusSession}=module.namespace;
const plain=x=>JSON.parse(JSON.stringify(x));

for(const agent of ['codex','claude']) {
  const rec={agent,session:'one',argv:[agent]};
  let launches=[];
  for(const status of ['active','unknown','missing','unsupported']) {
    result={agent,session:'one',state:status,reason:status};
    await assert.rejects(resumeSession(rec,argv=>launches.push(argv)),new RegExp(status));
    assert.equal(launches.length,0);
  }
  result={agent,session:'wrong',state:'ready'};
  await assert.rejects(resumeSession(rec,()=>assert.fail('mismatched identity')),/did not match/);
  result={agent,session:'one',state:'ready'};
  const first=resumeSession(rec,argv=>launches.push(plain(argv)));
  await assert.rejects(resumeSession(rec,()=>assert.fail('duplicate launch')),/already being opened/);
  await first;
  assert.deepEqual(launches,[agent==='codex'?[agent,'resume','--dangerously-bypass-approvals-and-sandbox','one']:[agent,'--resume','one']]);
  await assert.rejects(resumeSession(rec,()=>assert.fail('launch gap duplicate')),/already being opened/);
}
const before=probes;
assert.equal((await inspectSession({agent:'gemini',session:'one'})).state,'unsupported');
assert.equal((await inspectSession({agent:'codex',session:'one',argv:['codex','--remote=unix:///fixture']})).state,'unsupported');
assert.equal(probes,before);
const sid='00000000-0000-4000-8000-000000000001';
assert.equal(nativeSessionUrl({agent:'codex',session:sid}),`codex://threads/${sid}`);
assert.equal(nativeSessionUrl({agent:'codex',session:'new?prompt=accident'}),null);
assert.equal(nativeSessionUrl({agent:'codex',session:sid,argv:['codex','--remote','host']}),null);
assert.equal(nativeSessionUrl({agent:'claude',session:sid}),null);
AGENTS.fixture={matches:command=>command==='fixture-cli',valued:new Set(),dropped:new Set(),droppedValued:new Set(),resume:(bin,flags,id)=>[bin,'continue',id]};
assert.deepEqual(plain(resumeArgv({agent:'fixture',session:'one'})),['fixture','continue','one']);
assert.equal(agentKind(['/tools/fixture-cli']),'fixture');
assert.equal(agentKind(['gemini']),null);

// Each visible entry point uses the real shared wrapper. Never launch a process.
const pickerSource=readFileSync('mods/wt-sessions/main.js','utf8');
const pickerMethod=pickerSource.slice(pickerSource.indexOf('  async resume(s, fork) {'),pickerSource.indexOf('  key(e, cx) {'));
const spacesSource=readFileSync('mods/spaces-plus/main.js','utf8');
const spacesMethod=spacesSource.slice(spacesSource.indexOf('  async resumeHere(rec) {'),spacesSource.indexOf('  // Sleep, as Orca'));
for (const entry of ['picker','spaces']) for (const scenario of ['live','stale','shell','other-provider','foreground-shell','foreground-agent','active','unknown','race-active','race-ready','cwd-change','cwd-missing']) {
  for(const key of Object.keys(state)) delete state[key];
  commands=[];terminalRows=[];duringProbe=null;
  const notices=[];let closed=0;
  const rec={agent:'codex',session:'one',cwd:'/work',title:'Fixture',argv:['codex']};
  result={agent:'codex',session:'one',state:'ready',cwd:'/work'};
  if(['live','stale','shell','other-provider','foreground-shell','foreground-agent'].includes(scenario)) {
    state['wt.live']={one:'t1'};
    terminalRows=[{address:'t1',state:scenario==='stale'?'exited':'live',program:{agent:true,key:'codex'}}];
    if(scenario==='shell') terminalRows[0].program={key:'zsh',agent:false};
    if(scenario==='other-provider') terminalRows[0].program={key:'claude',agent:true};
    if(scenario==='foreground-shell') terminalRows[0].foreground={argv:['/bin/zsh']};
    if(scenario==='foreground-agent') {delete terminalRows[0].program;terminalRows[0].foreground={argv:['/bin/codex','resume','one']};}
  }
  if(scenario==='active'||scenario==='unknown') result={...result,state:scenario,reason:scenario};
  if(scenario==='cwd-change') result.cwd='/moved';
  if(scenario==='cwd-missing') delete result.cwd;
  if(scenario.startsWith('race')) {
    result.state=scenario==='race-active'?'active':'ready';
    duringProbe=async()=>{state['wt.live']={one:'t1'};terminalRows=[{address:'t1',state:'live',program:{agent:true,key:'codex'}}];};
  }
  if(entry==='picker') {
    const Type=new Function('AGENTS','shared','KNOWN','P','spaces','run','resumeSession','focusSession','notify','close',`return class {${pickerMethod}close(){close();}}`)(
      AGENTS,host.shared,'known',()=>({}),()=>[],host.run,resumeSession,focusSession,value=>notices.push(value),()=>closed++);
    await new Type().resume({...rec,id:rec.session},false);
  } else {
    const Type=new Function('AGENTS','panes','spaces','where','place','run','resumeSession','focusSession',`return class {trees={};git={};${spacesMethod}}`)(
      AGENTS,()=>[],()=>[],()=>'',()=>'',host.run,resumeSession,focusSession);
    try {await new Type().resumeHere(rec);} catch(error) {notices.push(error);}
  }
  const blocked=['active','unknown','cwd-change','cwd-missing'].includes(scenario);
  assert.equal(notices.length,blocked?1:0,`${entry}/${scenario}: refusal is visible`);
  assert.equal(commands.length,blocked?0:1,`${entry}/${scenario}: exactly one action`);
  if(!blocked) assert.equal(commands[0][0],['stale','shell','other-provider','foreground-shell'].includes(scenario)?'space.new':'pane.focus',`${entry}/${scenario}`);
  if(entry==='picker') assert.equal(closed,blocked?0:1,`${scenario}: only close on success`);
  if(blocked||scenario.startsWith('race')) assert.equal(state['sessions.pending-resumes']?.['codex:one'],undefined);
}
// Separate installed bundles still reserve the same provider/session before await.
for(const key of Object.keys(state)) delete state[key];
terminalRows=[];commands=[];duringProbe=null;
result={agent:'codex',session:'shared',state:'ready'};
const other=new vm.SourceTextModule(readFileSync('lib/resume.js','utf8'),{context});
await other.link(linker);await other.evaluate();
const first=resumeSession({agent:'codex',session:'shared'},host.run,'agents-plus');
await assert.rejects(other.namespace.resumeSession({agent:'codex',session:'shared'},host.run,'spaces-plus'),/already being opened/);
await first;
assert.equal(commands.length,1);
console.log('handoff: providers, fresh cwd, shared reservation, stale LIVE and attachment races passed');

// Race actual Saved/Outside handlers, including command fanout to two copies of
// spaces-plus. Every transport is synthetic; launch means a recorded host action.
const agentsSource=readFileSync('mods/agents-plus/main.js','utf8');
const savedMethod=agentsSource.slice(agentsSource.indexOf('  resumeSaved(row, cx) {'),agentsSource.indexOf('  savedRows(t, all, now) {'));
const outsideMethod=agentsSource.slice(agentsSource.indexOf('  async resume(x, cx = null) {'),agentsSource.indexOf("  // A section's outside agents"));
const settings=new vm.SourceTextModule(readFileSync('lib/state.js','utf8'),{context});
await settings.link(()=>herdr);await settings.evaluate();
const statuses=new vm.SourceTextModule(readFileSync('lib/agent-status.js','utf8'),{context});
await statuses.link(()=>settings);await statuses.evaluate();
const saved=new vm.SourceTextModule(readFileSync('lib/saved-sessions.js','utf8'),{context});
await saved.link(name=>name==='./resume.js'?module:statuses);await saved.evaluate();
let raceChecks=0;
for(const agent of ['codex','claude']) for(const delegated of [false,true]) for(const ownership of ['ready','active','unknown']) {
  for(const key of Object.keys(state)) delete state[key];
  terminalRows=[];commands=[];duringProbe=null;
  const row={agent,session:sid,cwd:'/work',title:'Synthetic session',updated:1,argv:[agent]};
  result={agent,session:sid,cwd:'/work',state:ownership,reason:ownership};
  const tasks=[],timers=new Set(),notices=[];
  const cx={notify(){},spawn(fn){tasks.push(fn(cx));},timer:{every(_ms,fn){timers.add(fn);return {cancel(){timers.delete(fn);}};}}};
  const spaces=()=>[{id:'work-space',folder:'/work'}];
  const destinations=[resumeSession,other.namespace.resumeSession].map(guard=>{
    const Type=new Function('AGENTS','panes','spaces','where','place','run','resumeSession','focusSession',`return class {trees={};git={};${spacesMethod}}`)(
      AGENTS,()=>[],spaces,()=>'/work',s=>s.folder,host.run,guard,focusSession);
    return new Type();
  });
  const run=(name,args)=>{
    if(!name.startsWith('spaces-plus.resume@')) return host.run(name,args);
    const rec=JSON.parse(name.split('@')[1]);
    for(const destination of destinations) tasks.push(destination.resumeHere(rec).then(
      ()=>{if(rec.request) state['wt.results']={...state['wt.results'],[rec.request]:{ok:true}};},
      error=>{if(rec.request) state['wt.results']={...state['wt.results'],[rec.request]:{ok:false,error:error.message}};else notices.push(error.message);},
    ));
  };
  const Type=new Function('d',`const {AGENTS,focusSession,runs,layout,panes,spaces,placeOf,inside,run,shared,RESULTS,notify,resumeSession,
    validSavedSession,savedSessionKey,savedLiveTerminal,savedResumeRecord,LIVE,KNOWN,terminals,exec,appHome}=d;
    return class {savedPending=new Map();readSaved(){}focusAgent(){throw Error('unexpected live session');}${savedMethod}${outsideMethod}}`)(
    {AGENTS,focusSession,resumeSession,runs:module.namespace.runs,layout:()=>delegated?{mod:'spaces-plus'}:{},panes:()=>[],spaces,
      placeOf:s=>s.folder,inside:(path,dir)=>path===dir||path.startsWith(dir+'/'),run,shared:host.shared,RESULTS:'wt.results',notify:value=>notices.push(value),
      ...saved.namespace,LIVE:'wt.live',KNOWN:'new-menu.agents',terminals:host.terminals,appHome:host.appHome,
      exec:async()=>({code:0,stdout:JSON.stringify({running:false,record:row})})});
  const views=[new Type(),new Type()];
  for(const view of views) {view.resumeSaved(row,cx);view.resumeSaved(row,cx);}
  tasks.push(views[0].resume(row),views[1].resume(row));
  // Let saved checks, destination acknowledgements and timer callbacks settle.
  for(let tick=0;tick<40;tick++) {await Promise.resolve();for(const timer of [...timers]) timer();}
  await Promise.all(tasks);
  const launches=commands.filter(([name])=>['tab.new','space.new'].includes(name));
  assert.equal(launches.length,ownership==='ready'?1:0,`${agent}/${delegated}/${ownership}: at most one launch across all entry points`);
  if(launches.length) {
    assert.equal(launches[0][0],'tab.new');
    assert.deepEqual(plain(launches[0][1].argv),agent==='codex'?[agent,'resume','--dangerously-bypass-approvals-and-sandbox',sid]:[agent,'--resume',sid]);
    await views[0].resume(row);
    assert.equal(commands.filter(([name])=>['tab.new','space.new'].includes(name)).length,1,'launch-gap repeat cannot launch again');
  } else assert.ok(notices.length||views.some(view=>view.savedResumeError),'ownership refusal remains visible');
  raceChecks++;
}
console.log(`handoff duplicate-launch races: ${raceChecks} passed (Saved/Outside, standalone/delegated fanout, both providers, ownership refusal)`);
