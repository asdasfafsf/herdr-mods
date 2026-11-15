// Synthetic argv/host checks only. Never launch an agent or send a user message.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';

const context=vm.createContext({console});
const launch=new vm.SourceTextModule(readFileSync('lib/agent-launch.js','utf8'),{context});
await launch.link(()=>assert.fail('unexpected dependency'));await launch.evaluate();
const {agentLaunchArgv,CODEX_YOLO}=launch.namespace;
const plain=x=>JSON.parse(JSON.stringify(x));
const fixtures=JSON.parse(readFileSync('tests/fixtures/agent-launch.json','utf8'));
const python=spawnSync('python3',['-c',`
import ast,json,re
from pathlib import Path
tree=ast.parse(Path('bin/hm').read_text())
scope={'re':re}
nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in {'agent_launch_argv','agent_run'}]
exec(compile(ast.Module(body=nodes,type_ignores=[]),'hm-agent-launch','exec'),scope)
results=[]
for item in json.loads(Path('tests/fixtures/agent-launch.json').read_text()):
    scope['shared']=lambda: {'new-menu.agents':{'':[{'key':item['agent'],'installed':True,'run':item['argv']}]}}
    results.append(scope['agent_run'](item['agent']))
print(json.dumps(results))
`],{encoding:'utf8'});
assert.equal(python.status,0,python.stderr);
const pyResults=JSON.parse(python.stdout);
for(const [i,item] of fixtures.entries()){
  const before=JSON.stringify(item.argv);
  const expected=item.default?[item.argv[0],CODEX_YOLO,...item.argv.slice(1)]:item.argv;
  const actual=plain(agentLaunchArgv(item.agent,item.argv));
  assert.deepEqual(actual,expected,item.name);
  assert.deepEqual(pyResults[i],expected,`hm: ${item.name}`);
  assert.equal(JSON.stringify(item.argv),before,'does not mutate program settings');
  assert.deepEqual(plain(agentLaunchArgv(item.agent,actual)),actual,'idempotent');
}

// Actual worktree creation routine, with all filesystem/git/app effects stubbed.
const state={};let commands=[];
const host={run:(...args)=>commands.push(args),exec:async(program)=>({code:program==='test'?1:0,stdout:''}),
  home:()=>'/home/test',knownAgents:()=>[],shared:k=>state[k],setShared:(k,v)=>state[k]=v,notify:()=>{}};
const synthetic=values=>new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v] of Object.entries(values))this.setExport(k,v);},{context});
const herdr=synthetic(host);
const states=synthetic({META:'meta',metaKey:(_on,path)=>path,setMeta:()=>{},dropMeta:()=>{},REPOS:'repos',KNOWN:'known',LAST_AGENT:'last'});
const worktree=new vm.SourceTextModule(readFileSync('lib/worktree.js','utf8'),{context});
await worktree.link(name=>({'herdr':herdr,'./state.js':states,'./agent-launch.js':launch}[name]));await worktree.evaluate();
for(const setup of ['', 'echo fixture'])for(const explicit of [false,true]){
  commands=[];
  const argv=explicit?['codex','--sandbox','read-only']:['codex','--model','chosen'];
  await worktree.namespace.createWorktree({name:'fixture',base:'main',repo:{top:'/repo',main:'/repo',name:'repo'},
    agent:'codex',agents:[{key:'codex',run:argv}],includeFile:[],setup,prompt:'fixture prompt'});
  const emitted=commands[0][1].argv;
  if(setup)assert.equal(emitted.at(-1).includes(CODEX_YOLO),!explicit);
  else assert.deepEqual(plain(emitted),explicit?argv:['codex',CODEX_YOLO,'--model','chosen']);
}
commands=[];
await worktree.namespace.createWorktree({name:'fixture',base:'main',repo:{top:'/repo',main:'/repo',name:'repo'},
  agent:'codex',agents:[{key:'codex',run:['codex']}],includeFile:[],setup:'',argv:['custom-shell']});
assert.deepEqual(plain(commands[0][1].argv),['custom-shell'],'explicit replacement program is preserved');

const source=readFileSync('mods/wt-menu/main.js','utf8');
const method=source.slice(source.indexOf('  newItems() {'),source.indexOf('  // Sort mode:'));
for(const exists of [true,false]){
  commands=[];
  const Type=new Function('props','run','agentLaunchArgv',`return class {${method}space(){return ${exists?'{id:"space"}':'null'};}}`)(()=>({path:'/work'}),host.run,agentLaunchArgv);
  const view=new Type();view.agents=[{key:'codex',name:'Codex',run:['codex']}];
  view.newItems()[1][1]();
  assert.deepEqual(plain(commands[0][1].argv),['codex',CODEX_YOLO]);
}
console.log(`agent launch: ${fixtures.length} shared JS/hm cases, worktree setup and menu paths passed`);
