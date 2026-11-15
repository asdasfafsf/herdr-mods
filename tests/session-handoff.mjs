import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const context=vm.createContext({console});
const state={};
let result, probes=0;
const host={
  shared:k=>state[k],setShared:(k,v)=>{state[k]=v},home:()=>'/home/test',appHome:()=>'/app',readTextFile:async()=>null,
  exec:async()=>{probes++;return {code:0,stdout:JSON.stringify(result)}},
};
const herdr=new vm.SyntheticModule(Object.keys(host),function(){for(const [k,v] of Object.entries(host))this.setExport(k,v)},{context});
const module=new vm.SourceTextModule(readFileSync('lib/resume.js','utf8'),{context});
await module.link(()=>herdr);await module.evaluate();
const {resumeSession,inspectSession,AGENTS,resumeArgv,nativeSessionUrl,agentKind}=module.namespace;
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

// Exercise the real picker handler: refusal never launches or closes the picker;
// a represented session focuses its terminal without consulting the backend.
const source=readFileSync('mods/wt-sessions/main.js','utf8');
const method=source.slice(source.indexOf('  async resume(s, fork) {'),source.indexOf('  key(e, cx) {'));
for(const represented of [false,true]) {
  const commands=[],notices=[];let closed=0;
  const Type=new Function('AGENTS','shared','KNOWN','LIVE','P','spaces','run','resumeSession','notify','close',`return class {${method}close(){close();}}`)(
    AGENTS,k=>k==='live'&&represented?{one:'t1'}:null,'known','live',()=>({}),()=>[],(...args)=>commands.push(args),
    async()=>{throw Error('active writer')},value=>notices.push(value),()=>closed++);
  await new Type().resume({agent:'codex',id:'one',cwd:'/work',title:'Fixture'},false);
  assert.equal(closed,represented?1:0);
  assert.deepEqual(commands,represented?[['pane.focus',{terminal:'t1'}]]:[]);
  assert.equal(notices.length,represented?0:1);
}
console.log('handoff: provider dispatch, fail-closed ownership, exact ID, duplicate launch guard and extensibility passed');
