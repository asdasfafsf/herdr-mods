// Render the real usage view against synthetic credits; no account queries.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const source=readFileSync('mods/usage-bar/main.js','utf8');
const clicks=new Map();
function builder() {
  const node={ops:[]};
  const proxy=new Proxy(node,{get(target,key) {
    if(key==='toJSON') return ()=>node;
    if(key==='when') return (condition,fn)=>condition?fn(proxy):proxy;
    if(key in target) return target[key];
    return (...args)=>{
      if(key==='hover') return proxy;
      if(key==='on_click') clicks.set(node.ops.find(([name])=>name==='id')?.[1][0],args[0]);
      node.ops.push([key,args.map(value=>typeof value==='function'?'[handler]':value)]);
      return proxy;
    };
  }});
  return proxy;
}
let properties={mode:'detail'}, overlay;
const t=Object.fromEntries(['foreground','muted','dim','hover','selected','accent','border','working','blocked','popover','chrome'].map(key=>[key,'#123456']));
const Type=new Function('View','div','image','svg','v_flex','h_flex','props','theme','openOverlay','closeOverlay','agoText','button','exec','appHome',
  source.replace(/^import .*;\n/gm,'').replace('export default class UsageBar','return class UsageBar'))(
  class {},builder,builder,builder,builder,builder,()=>properties,()=>t,value=>{overlay=value},()=>{},()=> 'just now',
  (id,label,fn,_t,options={})=>builder().id(id).child(label).when(!options.disabled,el=>el.on_click((_e,cx)=>fn(cx))),
  async()=>assert.fail('Usage rendering must never invoke reset actions'),()=>'/example');
const view=new Type();
const fixture=JSON.parse(readFileSync('docs/porting/fixtures/usage.json','utf8'));
const credit={id:'one',title:'Bonus reset',status:'available',grantedAt:1794500000,expiresAt:1894500000,description:'A plan reset'};
const render=summary=>{
  view.usage=structuredClone(fixture);view.usage.codex.resetCredits=summary;
  clicks.clear();return JSON.stringify(view.render({}));
};
assert.match(render(null),/Reset credit information isn't available/);
assert.match(render({availableCount:0,credits:[],updated:100}),/No reset credits available/);
assert.match(render({availableCount:2,credits:null,updated:100}),/Individual credit details aren't available/);
let output=render({availableCount:2,credits:[credit],updated:100});
for(const text of ['2 available','Bonus reset','Expires','Showing 1 of 2 available credits.','usage-refresh','usage-close']) assert.ok(output.includes(text),text);
output=render({availableCount:1,credits:[{...credit,expiresAt:null}],updated:100});
assert.match(output,/No expiration/);
assert.ok(!output.includes('consume'),'displaying credits must not redeem them');
properties={};view.width=720;
output=JSON.stringify(view.render({}));
assert.ok(output.includes('↺ 1'));
clicks.get('usage-pill')();
assert.equal(overlay.props.mode,'detail');assert.equal(overlay.width,380);
view.width=360;
output=JSON.stringify(view.render({}));
assert.ok(output.includes('Reset credits: 1 available'),'narrow bar retains count in tooltip');
console.log('usage rendering: unknown/zero/count-only/partial credits, expiration, refresh and detail entry passed');

if(process.argv.includes('--native')) {
  const directory=mkdtempSync(join(tmpdir(),'herdr-usage-view-'));
  try {
    for(const file of ['ui','state']) writeFileSync(join(directory,`${file}.js`),readFileSync(`lib/${file}.js`,'utf8').replaceAll('from "herdr"','from "./mock-herdr.js"'));
    writeFileSync(join(directory,'usage.js'),source.replaceAll('from "herdr"','from "./mock-herdr.js"'));
    writeFileSync(join(directory,'mock-herdr.js'),`
export const theme=()=>(${JSON.stringify(t)}),props=()=>({mode:'detail'}),shared=()=>null,setShared=()=>{};
export const exec=async()=>({code:0,stdout:'{}'}),appHome=()=>'/example',openOverlay=()=>{},closeOverlay=()=>{};
`);
    writeFileSync(join(directory,'main.js'),`
import Usage from './usage.js';
export default class Probe extends Usage {init(){this.usage=${JSON.stringify(view.usage)};}}
`);
    const result=spawnSync('herdr-app',['check',directory],{encoding:'utf8',timeout:15000});
    assert.equal(result.status,0,result.stdout+result.stderr+String(result.error??''));
    console.log('native usage detail: passed');
  } finally {rmSync(directory,{recursive:true,force:true});}
}
