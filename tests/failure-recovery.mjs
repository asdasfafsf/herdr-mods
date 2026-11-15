// Exercise production async methods with failures; never touch user sessions or files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const restoreText = readFileSync('mods/wt-restore/main.js', 'utf8');
const progressSource = readFileSync('mods/wt-restore/progress.js', 'utf8');
const Progress = new Function(progressSource.slice(progressSource.indexOf('export class RestoreProgress'), progressSource.indexOf('export function progressText')).replace('export class RestoreProgress', 'return class RestoreProgress'))();
let restoreState;
const progress = new Progress(() => restoreState, value => { restoreState = value; });
const methods = restoreText.slice(restoreText.indexOf('  // Record health transitions'), restoreText.indexOf('  initDialog('));
let pending;
const cx = { spawn(fn) { pending = fn(cx); }, notify() {}, timer: { after() {} } };
const old = JSON.stringify({core:{pid:1,start:0},sessions:{t1:{session:'old'}}});
const now = {core:{pid:2,start:100000},uptime:60000,sessions:{t2:{session:'new',address:'t2'}},unresolved:[]};
let disk = old, fail = true, readFails = false, auto = false, writes = 0, offers = 0, resumed = 0, live, previous = null;
const health = [];
const Type = new Function('look','exec','LAST_FILE','PREV_FILE','SETTLE','readTextFile','localStorage','LAST','sameRun','restorable','offer','writeTextFile','setShared','LIVE','notify','appHome','shared','RESTORE_PROGRESS','progress','logRestore', `let polling = false; return class {${methods}}`)(
 async()=>now, async()=>({code:0}), ()=>'/restore', ()=>'/previous', 20000,
 async(path)=>{if(path==='/previous')return previous;if(readFails)throw Error('read unavailable');return disk;},
 {getItem:(key)=>key==='auto' && auto ? '1' : null}, 'last', (a,b)=>a?.pid===b?.pid, async()=>[{session:'old'}],
 async(list)=>{if(!list.length)return;if(auto)resumed++;else offers++;},
 async(path,value,expected)=>{if(path==='/previous'){assert.equal(expected,previous);previous=value;return;}writes++;if(fail)throw Error('disk unavailable');assert.equal(expected,disk);disk=value;},
 (_key,value)=>{live=value;}, 'live', ()=>{}, ()=>'/app', () => restoreState, 'restore-progress', progress, async()=>{});
// A core younger than SETTLE still reports what it saved before starting: no offer, no write.
now.uptime=5000;
const young = new Type();young.health=async()=>{};young.log=async()=>{};
young.tick(cx); await pending;
assert.equal(writes,0); assert.equal(offers,0); assert.equal(disk,old); assert.equal(previous,null); assert.equal(young.offeredCore,undefined); assert.equal(young.busy,false);
now.uptime=60000;
const view = new Type();
view.health = async (...args)=>health.push(args);
view.log = async()=>{};
view.tick(cx); await pending;
assert.equal(view.savedText,old); assert.equal(disk,old); assert.equal(writes,2);
assert.equal(offers,1); assert.equal(live.new,'t2'); assert.equal(view.busy,false);
// The run that stopped is kept for `hm restore`, apart from last.json.
assert.equal(previous,old);
view.tick(cx); await pending;
assert.equal(writes,4); assert.equal(offers,1); assert.equal(resumed,0);
fail=false;
view.tick(cx); await pending;
assert.equal(view.savedText,disk); assert.equal(JSON.parse(disk).sessions.t2.session,'new');
assert.ok(health.some(([key,value])=>key==='storage'&&value===null));
const before=writes;
view.tick(cx);await pending;assert.equal(writes,before);
// A failed initial read is not interpreted as a missing file; no overwrite is attempted.
readFails=true;
const unreadable=new Type();unreadable.health=async()=>{};unreadable.log=async()=>{};
unreadable.tick(cx);await pending;assert.equal(writes,before);assert.equal(unreadable.savedText,undefined);assert.equal(unreadable.busy,false);
// A conflict refresh must read successfully before retrying a compare-and-swap write.
view.savedText=old;fail=true;
view.tick(cx);await pending;assert.equal(writes,before+1);assert.equal(view.savedText,old);

// Automatic continuation also runs at most once while saving keeps failing.
readFails=false;auto=true;disk=old;restoreState=null;
const automatic=new Type();automatic.health=async()=>{};automatic.log=async()=>{};
automatic.tick(cx);await pending;automatic.tick(cx);await pending;
assert.equal(resumed,1);assert.equal(automatic.savedText,old);assert.equal(offers,1);

const usageText=readFileSync('mods/usage-bar/main.js','utf8');
const reader=usageText.slice(usageText.indexOf('  // Manual refresh'),usageText.indexOf('  // A window'));
let response, deferred, calls=0;
const Usage=new Function('exec','appHome','AGENTS',`return class {${reader}}`)(async()=>{calls++;if(deferred)await deferred;if(response instanceof Error)throw response;return response;},()=>'/app',[['claude','Claude'],['codex','Codex']]);
const bar=new Usage();const cached={claude:{updated:100,windows:[{name:'5h',used:10}]},codex:null};bar.usage=cached;
for (const failure of [{code:1,stdout:''},{code:0,stdout:'bad json'},{code:0,stdout:'{}'},Error('offline')]) {
 response=failure;bar.read(cx,true);await pending;
 assert.equal(bar.usage,cached);assert.equal(bar.refreshResult,'Failed');assert.equal(bar.reading,false);assert.equal(bar.refreshing,false);
}
response={code:0,stdout:JSON.stringify({...cached,refresh:{claude:{ok:true},codex:{ok:false,error:'offline'}}})};
bar.read(cx,true);await pending;assert.equal(bar.refreshResult,'Partial');assert.match(bar.readError,/Codex: offline/);assert.equal(bar.usage.claude.updated,100);
response={code:0,stdout:JSON.stringify({...cached,refresh:{claude:{ok:true},codex:{ok:true}}})};
let release;deferred=new Promise(resolve=>release=resolve);const n=calls;
bar.read(cx,true);bar.read(cx,true);assert.equal(calls,n+1);release();await pending;
assert.equal(bar.refreshResult,'Updated');assert.equal(bar.readError,'');
console.log('failure recovery: settle wait, previous run kept, save retries, single restore offer, live mapping, failed reads, usage failures/partial/success and overlap passed');
