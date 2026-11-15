// Actual restore/discovery code in an isolated VM. All host transports are inert.
// No real files, processes, sessions, app/core commands, or reset/redemption paths.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const KEY = 'wt.restoreProgress';
const plain = value => JSON.parse(JSON.stringify(value));
const defer = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
const flush = async () => { for(let i=0;i<200;i++) await Promise.resolve(); };
const record = (i, extra={}) => ({address:`t${i}`,agent:'codex',session:`session-${i}`,argv:['codex'],cwd:'/example/work',space:'s1',title:`Synthetic ${i}`,status:'idle',...extra});
const core = {pid:2,start:100000};
const previous = rows => JSON.stringify({core:{pid:1,start:0},sessions:Object.fromEntries(rows.map(r=>[r.address,r]))});

async function environment(options={}) {
  let now=160000, viewProps={};
  const state=options.state ?? {}, snapshots=[], notices=[], calls=[], logs=[], overlays=[], tasks=[], timers=[];
  const disk={'/home/.herdr/restore/last.json': options.last ?? null};
  const settings=new Map(options.auto ? [['auto','1']] : []);
  const config={uptime:60000,records:[],spaces:[{id:'s1',tabs:[]}],...options};
  function builder(kind, initial) {
    const node={kind,initial,ops:[]}; let proxy;
    proxy=new Proxy(node,{get(target,key){
      if(key==='then')return undefined;
      if(key==='toJSON')return ()=>node;
      if(key in target)return target[key];
      if(key==='when')return (ok,fn)=>ok?fn(proxy):proxy;
      return (...args)=>{ if(key==='hover')args[0](builder('hover'));else node.ops.push([key,...args]);return proxy;};
    }});return proxy;
  }
  const palette=Object.fromEntries(['popover','foreground','muted','border','accent','blocked','hover'].map(k=>[k,'#234567']));
  const host={
    shared:k=>state[k],setShared:(k,v)=>{state[k]=plain(v);if(k===KEY)snapshots.push(plain(v));},
    home:()=>'/home',appHome:()=>'/app',props:()=>viewProps,theme:()=>palette,spaces:()=>config.spaces,
    terminals:()=>[],nextCommand:()=>new Promise(()=>{}),notify:n=>notices.push(plain(n)),
    openOverlay:p=>{if(config.overlayError)throw Error('overlay unavailable');overlays.push(plain(p));},closeOverlay:()=>{},
    run:(name,args)=>{calls.push(['run',name,plain(args)]);if(config.runError)throw Error('dispatch unavailable');},
    readTextFile:async path=>{calls.push(['read',path]);if(config.readGate)await config.readGate;if(config.readError)throw Error('read unavailable');return disk[path]??null;},
    writeTextFile:async(path,value)=>{calls.push(['write',path]);if(config.writeError)throw Error('disk unavailable');disk[path]=value;},
    hc:async args=>{
      calls.push(['hc',...args]);
      if(args[0]==='send')return config.send ? config.send(args) : {code:0};
      if(args[0]==='server'){
        if(config.lookGate)await config.lookGate;
        if(config.lookError)throw Error('status unavailable');
        return {code:0,stdout:JSON.stringify({pid:core.pid,uptime_ms:config.uptime})};
      }
      if(args[0]==='ls')return {code:0,stdout:JSON.stringify({terminals:config.records})};
      if(args[0]==='get'){
        if(config.discoveryGate)await config.discoveryGate;
        const term=config.get ? config.get(args[1]) : {state:'live',foreground:{argv:['zsh']}};
        return term ? {code:0,stdout:JSON.stringify(term)} : {code:1,stdout:'gone'};
      }
      assert.fail(`unexpected hc ${args}`);
    },
    exec:async(program,args)=>{
      calls.push(['exec',program,...args]);
      if(args[1]?.endsWith('/diagnostics.py')){logs.push(JSON.parse(args.at(-1)));if(config.logError)throw Error('log unavailable');return {code:0,stdout:''};}
      if(program==='mkdir')return {code:0,stdout:''};
      if(program==='sh')return {code:0,stdout:config.elsewhere?'123':''};
      if(program==='ps')return {code:0,stdout:'123 codex'};
      if(args[1]?.endsWith('/codex_live.py'))return {code:0,stdout:'false'};
      assert.fail(`unexpected exec ${program}`);
    }
  };
  const context=vm.createContext({console,Date:class extends Date {static now(){return now;}},localStorage:{getItem:k=>settings.get(k),setItem:(k,v)=>settings.set(k,v),removeItem:k=>settings.delete(k)}});
  const synthetic=(name,exports)=>new vm.SyntheticModule(Object.keys(exports),function(){for(const [k,v]of Object.entries(exports))this.setExport(k,v);},{context,identifier:name});
  const modules=new Map([
    ['herdr',synthetic('herdr',host)],
    ['gpui-kit',synthetic('gpui-kit',{View:class{},div:()=>builder('div'),svg:s=>builder('svg',s),image:s=>builder('image',s)})],
    ['gpui-base',synthetic('gpui-base',{v_flex:()=>builder('column'),h_flex:()=>builder('row')})],
  ]);
  const files={'main':'mods/wt-restore/main.js','./progress.js':'mods/wt-restore/progress.js','./state.js':'lib/state.js','./resume.js':'lib/resume.js'};
  const module=name=>{
    if(modules.has(name))return modules.get(name);
    assert.ok(files[name],`unexpected module ${name}`);
    const m=new vm.SourceTextModule(readFileSync(files[name],'utf8'),{context,identifier:name});modules.set(name,m);return m;
  };
  const main=module('main');await main.link(name=>module(name));await main.evaluate();
  const Type=main.namespace.default, view=new Type();
  const cx={spawn:fn=>{const task=fn(cx);tasks.push(task);return task;},notify:()=>{},timer:{every:(ms,fn)=>timers.push({ms,fn})},focus_handle:()=>({focus(){}})};
  return {config,state,snapshots,notices,calls,logs,overlays,disk,view,cx,Type,restore:main.namespace.restore,
    render:()=>plain(view.render(cx)), progress:()=>state[KEY],
    progressModule:modules.get('./progress.js').namespace,
    start:()=>{view.init({},cx);return tasks[0];},
    tick:()=>{const n=tasks.length;view.tick(cx);return tasks[n]??Promise.resolve();},
    timer:()=>{const n=tasks.length;timers[0].fn(cx);return tasks[n]??Promise.resolve();},
    setProps:p=>{viewProps=p;},advance:ms=>{now+=ms;},timers};
}
const sends=e=>e.calls.filter(c=>c[0]==='hc'&&c[1]==='send');
const runs=e=>e.calls.filter(c=>c[0]==='run');
const check = async (name, fn) => { await fn(); console.log(`restore progress: ${name}`); };

await check('serial processed/total, queued/in-flight snapshots and overlap guard',async()=>{
  const gates=[defer(),defer(),defer()];let next=0;
  const e=await environment({send:()=>gates[next++].promise});
  const pending=e.restore([record(1),record(2),record(3)]);
  assert.equal(e.progress().processed,0);assert.equal(e.progress().inFlight,1);assert.equal(e.progress().total,3);
  assert.equal(await e.restore([record(4)]),false);assert.equal(sends(e).length,1);
  assert.match(JSON.stringify(e.render()),/0\/3 processed/);
  assert.match(JSON.stringify(e.render()),/1 opening now · 2 waiting to open/);
  for(let i=0;i<3;i++){
    gates[i].resolve({code:0});await flush();
    assert.equal(e.progress().processed,i+1);assert.equal(sends(e).length,Math.min(i+2,3));
  }
  await pending;assert.equal(e.progress().phase,'complete');assert.equal(e.progress().sent,3);
  assert.equal(e.notices[0].level,'info');assert.match(e.notices[0].body,/agents may still be opening/);
  assert.ok(!e.notices.some(n=>/^Restored/.test(n.title)));
  assert.equal(e.logs.at(-1).problem.outcomes.length,3);
  assert.ok(!JSON.stringify(e.logs).includes('session-1'));
  assert.ok(!JSON.stringify(e.logs).includes('/example/work'));
});

await check('rejected sends, fire-and-forget tab requests, missing spaces and bounded outcomes',async()=>{
  const e=await environment({send:async()=>({code:7})});
  await e.restore([record(1),record(2,{gone:true}),record(3,{gone:true,space:'removed'})]);
  assert.equal(e.progress().phase,'partial');assert.equal(e.progress().processed,3);
  assert.equal(e.progress().sent,0);assert.equal(e.progress().dispatched,1);assert.equal(e.progress().failed,2);
  assert.equal(runs(e).length,1);assert.equal(e.notices[0].level,'warning');
  assert.deepEqual(e.logs.at(-1).problem.outcomes.map(x=>x.result),['send_rejected','tab_dispatched_unconfirmed','missing_space']);
  assert.equal(e.logs.at(-1).problem.outcomes[0].code,7);
  const many=await environment();await many.restore(Array.from({length:103},(_,i)=>record(i)));
  assert.equal(many.logs.at(-1).problem.outcomes.length,100);assert.equal(many.logs.at(-1).problem.omitted,3);
});

await check('thrown requests are unconfirmed, never retried, and remaining entries continue exactly once',async()=>{
  for(const rejection of [0,1]){
    let n=0;const e=await environment({send:async()=>{if(n++===rejection)throw Error('transport closed');return {code:0};}});
    await e.restore([record(1),record(2),record(3)]);
    assert.equal(e.progress().phase,'partial');assert.equal(e.progress().inFlight,0);
    assert.deepEqual(sends(e).map(c=>c[2]),['t1','t2','t3']);
    assert.equal(e.progress().processed,3);assert.equal(e.progress().sent,2);assert.equal(e.progress().unknown,1);
    assert.equal(e.logs.at(-1).problem.notAttempted,0);
    assert.equal(e.logs.at(-1).problem.outcomes[rejection].result,'request_threw');
    assert.match(e.notices[0].body,/could not be confirmed/);
  }
  const all=await environment({send:async()=>{throw Error('transport closed');}});
  await all.restore([record(1),record(2)]);assert.equal(all.progress().phase,'failed');assert.equal(all.progress().unknown,2);
  const e=await environment({runError:true});await e.restore([record(1,{gone:true}),record(2)]);
  assert.equal(e.progress().phase,'partial');assert.equal(sends(e).length,1);assert.equal(e.progress().dispatched,0);
  const empty=await environment();assert.equal(await empty.restore([]),false);assert.equal(empty.progress(),undefined);
  let attempt=0;const choices=await environment({send:async()=>{if(++attempt===1)throw Error('transport closed');return {code:0};}});
  await choices.restore([record(1,{go:false}),record(2,{go:true}),record(3,{go:false,agent:'claude',argv:['claude']})]);
  const commands=sends(choices).map(c=>c[3]);
  assert.match(commands[0],/codex resume session-1$/);
  assert.match(commands[1],/codex resume session-2 'Herdr/,'continue choice survives the previous rejection');
  assert.match(commands[2],/claude --resume session-3$/,'reopen-only choice is unchanged');
});

await check('delayed look, settle wait and delayed candidate discovery stay visible',async()=>{
  const look=defer(),discovery=defer(),send=defer();
  const e=await environment({auto:true,last:previous([record(1)]),uptime:1000,lookGate:look.promise,send:()=>send.promise});
  const started=e.start();assert.equal(e.progress().phase,'checking');assert.equal(e.progress().total,null);
  await e.view.askAgain();assert.match(e.notices.at(-1).title,/check is already running/);
  look.resolve();await started;assert.equal(e.progress().phase,'waiting');assert.equal(sends(e).length,0);
  assert.equal(e.progressModule.progressText(e.progress()).detail,'Waiting for Herdr to finish starting');
  assert.ok(!e.calls.some(c=>c[0]==='write'));
  e.config.uptime=60000;e.config.discoveryGate=discovery.promise;
  const tick=e.tick();await flush();assert.equal(e.progress().phase,'checking');assert.equal(sends(e).length,0);
  discovery.resolve();await flush();assert.equal(e.progress().phase,'restoring');assert.equal(e.progress().inFlight,1);
  await e.view.askAgain();assert.match(e.notices.at(-1).title,/restore is already running/);
  send.resolve({code:0});await tick;assert.equal(e.progress().phase,'complete');assert.equal(sends(e).length,1);
  const snapshot=plain(e.progress());await e.tick();assert.deepEqual(e.progress(),snapshot);
  assert.equal(sends(e).length,1);assert.deepEqual(e.timers.map(t=>t.ms),[5000],'reuse the record timer; no redraw animation timer');
  e.advance(11000);await e.timer();assert.equal(e.progress().hidden,true);assert.ok(!JSON.stringify(e.render()).includes('spin'));
});

await check('no saved/candidate sessions, already running and busy terminals complete without requests',async()=>{
  for(const options of [{},{last:previous([])},{last:previous([record(1)]),elsewhere:true},
    {last:previous([record(1)]),get:()=>({state:'live',foreground:{argv:['vim']}})}]){
    const e=await environment(options);await e.start();
    assert.equal(e.progress().phase,'complete');assert.equal(e.progress().total,0);
    assert.equal(sends(e).length,0);assert.equal(runs(e).length,0);assert.equal(e.overlays.length,0);
    const n=e.snapshots.length;await e.tick();assert.equal(e.snapshots.length,n,'background checks remain silent');
  }
});

await check('same-core startup stays neutral even with stopped previous sessions; only candidate scans report none found',async()=>{
  const last=JSON.stringify({core,sessions:{}});
  const e=await environment({last});
  e.disk['/home/.herdr/restore/previous.json']=previous([record(1)]);
  await e.start();
  const text=e.progressModule.progressText(e.progress());
  assert.equal(text.title,'Startup check finished');assert.equal(text.detail,'');
  assert.equal(e.progress().total,0);assert.ok(!e.progress().candidatesChecked);
  assert.ok(!e.calls.some(c=>c[0]==='read'&&c[1].endsWith('/previous.json')),'startup did not scan previous candidates');
  assert.doesNotMatch(JSON.stringify(e.render()),/No (?:stopped )?sessions|all restored|none remaining/i);
  await e.view.askAgain();
  assert.equal(e.progress().phase,'ready');assert.equal(e.progress().total,1,'the stopped previous session is still available');
  assert.equal(sends(e).length,0);

  const empty=await environment({last,elsewhere:true});
  empty.disk['/home/.herdr/restore/previous.json']=previous([record(1)]);
  await empty.start();await empty.view.askAgain();
  assert.equal(empty.progress().candidatesChecked,true);
  assert.equal(empty.progressModule.progressText(empty.progress()).detail,'No stopped sessions found');
  const transition=await environment({last:previous([])});await transition.start();
  assert.equal(transition.progress().candidatesChecked,true,'an empty offer is an actual candidate result');
  assert.equal(transition.progressModule.progressText(transition.progress()).detail,'No stopped sessions found');
});

await check('startup read/poll errors end loading and storage retries do not repeat offers',async()=>{
  for(const options of [{lookError:true},{readError:true}]){
    const e=await environment(options);await e.start();
    assert.equal(e.progress().phase,'failed');assert.equal(e.view.busy,false);assert.equal(sends(e).length,0);
    assert.ok(!JSON.stringify(e.render()).includes('spin'));
    e.config.lookError=false;e.config.readError=false;await e.tick();assert.equal(e.view.busy,false);
  }
  const e=await environment({auto:true,last:previous([record(1)]),writeError:true});await e.start();await e.tick();
  assert.equal(sends(e).length,1);assert.equal(e.progress().phase,'complete');
  const fresh=await environment({auto:true,last:previous([record(1)]),state:e.state,writeError:true});await fresh.start();
  assert.equal(sends(fresh).length,0,'persisted offered core prevents replay after layout/build refresh');
});

await check('dialog is non-spinning, cancel/zero selection and duplicate submit are one-shot',async()=>{
  for(const cancel of ['button','close','empty','submit']){
    const e=await environment({last:previous([record(1)])});await e.start();
    assert.equal(e.progress().phase,'ready');assert.ok(!JSON.stringify(e.render()).includes('spin'));
    e.setProps({...e.overlays[0].props,overlay:'test-dialog'});const dialog=new e.Type();dialog.init({},e.cx);
    if(cancel==='button')dialog.dismissDialog();
    if(cancel==='close')dialog.close();
    if(cancel==='empty'){dialog.picked.clear();dialog.go();}
    if(cancel==='submit'){dialog.go();await flush();assert.equal(e.progress().phase,'complete');}
    dialog.go();await flush();dialog.go();await flush();
    assert.equal(sends(e).length,cancel==='submit'?1:0);
    assert.equal(e.progress().phase,cancel==='submit'?'complete':'cancelled');
  }
  const broken=await environment({last:previous([record(1)]),overlayError:true});await broken.start();
  assert.equal(broken.progress().phase,'failed');assert.ok(!JSON.stringify(broken.render()).includes('spin'));
});

await check('closing/reloading during look or a request invalidates work, preserves uncertainty and never replays',async()=>{
  const look=defer();const checking=await environment({last:previous([record(1)]),auto:true,lookGate:look.promise});
  const first=checking.start();checking.view.close();look.resolve();await first;
  assert.equal(checking.progress().phase,'interrupted');assert.equal(sends(checking).length,0);
  for(const reload of [false,true]){
    const send=defer();const e=await environment({auto:true,last:previous([record(1),record(2)]),send:()=>send.promise});
    const work=e.start();await flush();assert.equal(sends(e).length,1);
    if(reload){
      const fresh=await environment({auto:true,last:previous([record(1),record(2)]),state:e.state});await fresh.start();
      assert.equal(sends(fresh).length,0);assert.equal(fresh.progress().phase,'interrupted');
    }else e.view.close();
    assert.equal(e.progress().phase,'interrupted');assert.equal(e.progress().uncertain,1);
    send.resolve({code:0});await work;assert.equal(sends(e).length,1);assert.equal(e.progress().phase,'interrupted');
    assert.equal(e.progress().processed,0,'old async completion cannot overwrite replacement state');
    assert.equal(e.logs.at(-1).problem.phase,'interrupted');
    assert.equal(e.logs.at(-1).problem.notAttempted,1);
  }
});

await check('late file reads cannot reclaim progress after close/reload; duplicate layout copies share one producer',async()=>{
  for(const reload of [false,true]){
    const read=defer();const e=await environment({auto:true,last:previous([record(1)]),readGate:read.promise});
    const work=e.start();await flush();assert.ok(e.calls.some(c=>c[0]==='read'));
    if(reload){const fresh=await environment({state:e.state});await fresh.start();}
    else e.view.close();
    const retained=plain(e.progress());read.resolve();await work;
    assert.deepEqual(e.progress(),retained);assert.equal(sends(e).length,0);
  }
  const look=defer();const e=await environment({lookGate:look.promise});
  const work=e.start();const second=new e.Type();second.init({},e.cx);
  assert.equal(e.calls.filter(c=>c[0]==='hc'&&c[1]==='server').length,1);
  e.view.close();look.resolve();await work;
  second.tick(e.cx);await flush();assert.equal(e.progress().phase,'complete');
  assert.equal(sends(e).length,0);
});

await check('native spinner appears only in active phases, rendering is read-only, result dismissal expires',async()=>{
  const e=await environment();const p=e.progressModule;
  for(const phase of ['checking','waiting','restoring','ready','complete','partial','failed','interrupted','cancelled']){
    const s={phase,total:5,processed:2,sent:1,dispatched:1,failed:0,inFlight:phase==='restoring'?1:0};
    const tree=JSON.stringify(p.renderProgress(s,{},()=>{}));
    assert.equal(tree.includes('spin'),['checking','waiting','restoring'].includes(phase),phase);
    assert.ok(!tree.includes('in flight')&&!tree.includes('dispatched')&&!tree.includes('unconfirmed'));
  }
  assert.equal(e.calls.length,0);
  let state,now=0;const controller=new p.RestoreProgress(()=>state,v=>{state=v;},()=>now);
  const id=controller.startup();controller.finish(id,'failed');now=10001;controller.expire();
  assert.equal(state.hidden,true);assert.ok(!JSON.stringify(p.renderProgress(state,{})).includes('spin'));
});
console.log('restore progress: all synthetic lifecycle/queue/renderer checks passed');
