// Composer transports are synthetic. This file never contacts Herdr sessions.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

async function fixture(address='t1') {
  const calls=[], tasks=[], commands=[], inputs=[];
  const state={status:'working',terminalState:'live',program:{agent:true},hook:null,dock:true};
  const context=vm.createContext({console});
  const cx={notify(){},stop_propagation(){},spawn(fn){tasks.push(fn(cx))}};
  function builder(){let p; p=new Proxy({}, {get:(_t,key)=>key==='when'?(ok,fn)=>ok?fn(p):p:key==='then'?undefined:()=>p});return p;}
  const text={new:({value=''}={})=>{
    const input={text:value,events:{},value(){return this.text},set_value(next){this.text=next},on(event,fn){this.events[event]=fn},focus(){},
      edit(next){this.text=next;this.events.change?.({},cx)},
      press(event={},start=this.text.length,end=start){this.edit(this.text.slice(0,start)+'\n'+this.text.slice(end));this.events.submit?.(event,cx)}};
    inputs.push(input);return input;
  }};
  const host={agents:()=>[{address,status:state.status,program:state.program}],terminals:()=>[{address,state:state.terminalState,program:state.program}],
    run:(...args)=>commands.push(args),exec:async(_cmd,args)=>{
      calls.push(args);
      if(state.hook){const out=await state.hook(args);if(out)return out;}
      if(args[0]==='get') return {code:0,stdout:JSON.stringify({state:state.terminalState,status:{state:state.status},foreground:{name:'codex'}})};
      if(args[0]==='put')return {code:0,stdout:JSON.stringify({path:'/uploaded/'+args.at(-1).split('/').pop()})};
      if(args[0]==='send')return {code:0,stdout:'{}'};
      throw Error('Unexpected transport');
    }};
  const module=(name,exports)=>new vm.SyntheticModule(Object.keys(exports),function(){for(const [key,value] of Object.entries(exports))this.setExport(key,value)},{context,identifier:name});
  const modules={
    'herdr':module('herdr',host),
    'gpui-kit':module('gpui-kit',{div:builder,image:builder}),
    'gpui-base':module('gpui-base',{h_flex:builder,v_flex:builder,InputState:text,TextareaState:text,Input:{new:builder},Textarea:{new:builder}}),
    './ui.js':module('ui',{button:builder}),
    './agent-mode.js':module('mode',{inAgentMode:()=>true,requestAgentSelection:()=>1}),
    './terminal-dock.js':module('dock',{hasTerminalDock:()=>state.dock,openTerminalDock:(target)=>commands.push(['dock',target])}),
    './composer.js':new vm.SourceTextModule(readFileSync('mods/agents-plus/composer.js','utf8'),{context}),
  };
  const chatModule=new vm.SourceTextModule(readFileSync('mods/agents-plus/village-chat.js','utf8'),{context});
  await chatModule.link(name=>modules[name]);await chatModule.evaluate();
  const api=chatModule.namespace, view={};
  api.selectVillageResident(view,{id:address,address,pane:'p1',agent:'Codex'},cx);
  const chat=view.villageChats.get(address);
  const flush=async()=>{while(tasks.length)await tasks.shift()};
  return {api,chat,view,cx,state,calls,commands,flush,policy:modules['./composer.js'].namespace};
}

// Enter at an arbitrary cursor or over a selection sends the intact draft.
for(const [text,start,end] of [['hello',5,5],['a\nb',1,1],['a\nb',1,3],['a\nb',0,2],['😀한글',2,4]]){
  const f=await fixture();f.chat.input.edit(text);f.chat.input.press({},start,end);await f.flush();
  assert.equal(f.calls.find(c=>c[0]==='send').at(-1),text);
  assert.equal(f.chat.input.value(),'');
}
for(const modifier of [{secondary:true},{shift:true}]){
  const f=await fixture();f.chat.input.edit('ab');f.chat.input.press(modifier,1);await f.flush();
  assert.equal(f.chat.input.value(),'a\nb');assert.equal(f.calls.length,0);
}
{
  const f=await fixture();f.chat.input.edit('ㅎ');f.chat.input.edit('하');f.chat.input.edit('한');await f.flush();
  assert.equal(f.calls.length,0,'native composition changes do not send without a committed submit');
  f.chat.input.press();f.chat.input.press();await f.flush();
  assert.equal(f.calls.filter(c=>c[0]==='send').length,1,'pending sends are deduplicated');
}
{
  const f=await fixture();f.chat.input.press();await f.flush();assert.equal(f.calls.length,0,'empty Enter does not send');
  assert.equal(f.chat.input.value(),'');
  assert.deepEqual(JSON.parse(JSON.stringify(f.commands)),[['dock','t1']], 'native dock owns session focus');
}

// Images are staged locally and copied only on explicit send, targeting the same session.
{
  const f=await fixture('remote/t7');
  f.api.addVillageImages(f.chat,['/tmp/a b.png',"/tmp/O'Brien.jpg",'/tmp/a b.png'],f.cx);
  assert.equal(f.chat.images.length,2);assert.equal(f.calls.length,0);
  f.chat.input.edit('Inspect these');f.chat.input.press();await f.flush();
  assert.deepEqual(f.calls.filter(c=>c[0]==='put').map(c=>Array.from(c)),[
    ['put','--json','--','remote/t7','/tmp/a b.png'],['put','--json','--','remote/t7',"/tmp/O'Brien.jpg"]]);
  const sent=f.calls.find(c=>c[0]==='send');
  assert.equal(sent.at(-2),'remote/t7');
  assert.equal(sent.at(-1),"Inspect these\n\n'/uploaded/a b.png' '/uploaded/O'\\''Brien.jpg'");
  assert.equal(f.calls.filter(c=>c[0]==='get').length,2,'status is checked again after file transfer');
  assert.equal(f.chat.images.length,0);
}
{
  const f=await fixture();
  f.api.addVillageImages(f.chat,['/tmp/safe.png','/tmp/a\nb.png'],f.cx);
  assert.equal(f.chat.images.length,0,'invalid batches are rejected before staging');
  f.api.addVillageImages(f.chat,['/tmp/a.txt'],f.cx);assert.match(f.chat.error,/Supported images/);
  f.api.addVillageImages(f.chat,['relative.png'],f.cx);assert.match(f.chat.error,/absolute/);
  f.api.addVillageImages(f.chat,Array.from({length:7},(_,i)=>`/tmp/${i}.png`),f.cx);assert.equal(f.chat.images.length,0);
  f.api.addVillageImages(f.chat,['/tmp/only.png'],f.cx);f.api.sendVillageMessage(f.chat,f.cx);await f.flush();
  assert.equal(f.calls.find(c=>c[0]==='send').at(-1),'/uploaded/only.png','image-only messages work');
}
{
  const f=await fixture();f.chat.input.edit('keep me');f.api.addVillageImages(f.chat,['/tmp/a.png'],f.cx);
  f.state.hook=async args=>args[0]==='put'?{code:1,stdout:''}:null;
  f.api.sendVillageMessage(f.chat,f.cx);await f.flush();
  assert.equal(f.chat.input.value(),'keep me');assert.equal(f.chat.images.length,1);assert.match(f.chat.error,/Could not attach/);
  assert.equal(f.calls.filter(c=>c[0]==='send').length,0);
}
{
  const f=await fixture();f.api.addVillageImages(f.chat,['/tmp/a.png'],f.cx);
  f.state.hook=async args=>{if(args[0]==='put')f.state.status='blocked';};
  f.api.sendVillageMessage(f.chat,f.cx);await f.flush();
  assert.equal(f.calls.filter(c=>c[0]==='send').length,0,'approval changes during upload never receive a message');
  assert.equal(f.chat.images.length,1);
}
{
  const f=await fixture();let finish;
  f.chat.input.edit('original');f.api.addVillageImages(f.chat,['/tmp/a.png'],f.cx);
  f.state.hook=args=>args[0]==='send'?new Promise(resolve=>{finish=resolve}):null;
  f.api.sendVillageMessage(f.chat,f.cx);
  for(let i=0;i<20&&!finish;i++)await Promise.resolve();
  assert.ok(finish);f.chat.input.edit('next draft');finish({code:0,stdout:'{}'});await f.flush();
  assert.equal(f.chat.input.value(),'next draft');assert.equal(f.chat.images.length,1,'late success preserves a newer draft');
}
for(const mutate of [s=>s.program={agent:false},s=>s.terminalState='finished',s=>s.status='blocked']){
  const f=await fixture();f.chat.input.edit('message');mutate(f.state);f.chat.input.press();await f.flush();assert.equal(f.calls.length,0);
}
console.log('village composer: Enter/newline, native composition events, draft preservation, image staging/uploads and exact-session guards passed');
