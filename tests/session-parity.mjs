import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const context=vm.createContext({console});
let calls=[];
const sharedState={};
const host={terminals:()=>[],run:()=>{},exec:async (...args)=>{calls.push(args);return {code:0,stdout:JSON.stringify({session:'sid'})}},readTextFile:async()=>JSON.stringify({sessionId:'claude-id'}),home:()=>'/home/test',appHome:()=>'/app',shared:k=>sharedState[k],setShared:(k,v)=>{sharedState[k]=v}};
const herdr=new vm.SyntheticModule(Object.keys(host),function(){for(const [k,v] of Object.entries(host))this.setExport(k,v)},{context});
const module=new vm.SourceTextModule(readFileSync('lib/resume.js','utf8'),{context});
await module.link(()=>herdr);await module.evaluate();
const {resumeArgv,sessionOf,AGENTS}=module.namespace;
const plain=x=>JSON.parse(JSON.stringify(x));
assert.deepEqual(plain(resumeArgv({agent:'codex',session:'sid',argv:['codex','resume','--last','--enable','feature','--disable=other','--oss','--model','local','--cd','/new path','old-id','old prompt']})),['codex','resume','--enable','feature','--disable=other','--oss','--model','local','--cd','/new path','sid']);
assert.deepEqual(plain(resumeArgv({agent:'claude',session:'sid',argv:['claude','--resume','old','--model','model','prompt']},'continue')),['claude','--model','model','--resume','sid','continue']);
assert.equal(await sessionOf('claude',123),'claude-id');
assert.equal(await sessionOf('codex',123,{cwd:'/work',title:'Task | work'},'spaces-plus'),'sid');
assert.equal(calls[0][1][1],'/app/mods/spaces-plus/codex_live.py');

// Execute the actual UI handler with host commands stubbed: both agents, both actions.
const text=readFileSync('mods/wt-sessions/main.js','utf8');
const handler=text.slice(text.indexOf('  async resume(s, fork) {'),text.indexOf('  key(e, cx) {'));
for(const agent of ['claude','codex'])for(const fork of [false,true]){
 const commands=[];
 const Type=new Function('AGENTS','shared','KNOWN','P','spaces','run','resumeSession','notify','focusSession',`return class { ${handler} close() {} }`)(AGENTS,()=>null,'known',()=>({space:'space1'}),()=>[{id:'space1'}],(...args)=>commands.push(args),async(rec,open)=>open(resumeArgv(rec)),()=>assert.fail('unexpected rejection'),()=>false);
 await new Type().resume({agent,id:'sid',cwd:'/work',title:'Task'},fork);
 assert.equal(commands[0][0],'tab.new');
 assert.ok(commands[0][1].argv.includes('sid'));
 assert.ok(commands[0][1].argv.includes(agent==='codex'?(fork?'fork':'resume'):(fork?'--fork-session':'--resume')));
}
console.log('session parity: options, discovery and Claude/Codex resume/fork handlers passed');

// Unknown sessions must never be silently dropped by Sleep before closing the worktree.
const spacesText=readFileSync('mods/spaces-plus/main.js','utf8');
const sleepMethod=spacesText.slice(spacesText.indexOf('  async sleep(w, g, quiet = false) {'),spacesText.indexOf('  // The next (+1)'));
for(const identified of [false,true]){
 const writes=[],commands=[];
 const Type=new Function('panes','hc','agentKind','sessionOf','setShared','shared','SLEEP','metaKey','run','notify',`return class {${sleepMethod}}`)(
  ()=>[{tab:'b1',terminal:'t1'}],async()=>({code:0,stdout:JSON.stringify({foreground:{pid:1,argv:['codex']},cwd:'/work',title:'Task'})}),()=> 'codex',async()=>identified?'sid':null,
  (...a)=>writes.push(a),()=>({}),'sleep',()=>'/work',(...a)=>commands.push(a),()=>{});
 const pending=new Type().sleep({tabs:[{id:'b1'}],name:'work'},{top:'/work'},true);
 if(identified){await pending;assert.equal(commands[0][0],'space.close');assert.equal(writes[0][1]['/work'].sessions[0].session,'sid');}
 else {await assert.rejects(pending,/Cannot identify codex/);assert.equal(commands.length,0);assert.equal(writes.length,0);}
}

const restoreText=readFileSync('mods/wt-restore/main.js','utf8');
const candidateFunction=restoreText.slice(restoreText.indexOf('async function restorable('),restoreText.indexOf('// Starts each again:'));
for (const backend of ['true', 'null', 'false']) {
 const candidates=new Function('hcJson','runningElsewhere','isShell','exec','appHome',`${candidateFunction}; return restorable;`)(
  async()=>({state:'live',foreground:{argv:['zsh']}}),async()=>false,()=>true,async()=>({code:0,stdout:backend}),()=>'/app');
 const last={sessions:{t1:{agent:'codex',address:'t1',session:'sid',status:'working'}}};
 assert.equal((await candidates(last,{sessions:{}}))[0].go,backend==='false','only a confirmed stopped backend gets continuation');
 assert.equal((await candidates(last,{sessions:{t2:{session:'sid'}}})).length,0,'already attached sessions are not restored twice');
}
console.log('session parity: Sleep safety and daemon continuation guards passed');
