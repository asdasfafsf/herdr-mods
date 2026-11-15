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
const module=new vm.SourceTextModule(readFileSync('lib/resume.js','utf8'),{context});
await module.link(()=>herdr);await module.evaluate();
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
  assert.deepEqual(launches,[[agent,agent==='codex'?'resume':'--resume','one']]);
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
await other.link(()=>herdr);await other.evaluate();
const first=resumeSession({agent:'codex',session:'shared'},host.run,'agents-plus');
await assert.rejects(other.namespace.resumeSession({agent:'codex',session:'shared'},host.run,'spaces-plus'),/already being opened/);
await first;
assert.equal(commands.length,1);
console.log('handoff: providers, fresh cwd, shared reservation, stale LIVE and attachment races passed');
