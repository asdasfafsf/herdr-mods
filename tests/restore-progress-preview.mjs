// Generate a test-only native preview. It imports only the production presentation
// module, never the restore producer. No fake shared state or production preview mode.
// node tests/restore-progress-preview.mjs [--native]
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const directory=mkdtempSync(join(tmpdir(),'herdr-restore-progress-preview-'));
const source=readFileSync(new URL('../mods/wt-restore/progress.js',import.meta.url),'utf8');
assert.ok(!source.includes('from "herdr"'),'the presentation module must have no host transports');
writeFileSync(join(directory,'progress.js'),source);
writeFileSync(join(directory,'mod.json'),JSON.stringify({place:'pane'}));
const base={total:5,processed:2,sent:2,dispatched:0,failed:0,unknown:0,inFlight:0};
const states=[
  {label:'Startup check',state:{...base,phase:'checking',total:null,processed:0,sent:0}},
  {label:'Startup wait',state:{...base,phase:'waiting',total:null,processed:0,sent:0}},
  {label:'Opening sessions',state:{...base,phase:'restoring',inFlight:1}},
  {label:'Partial result',state:{...base,phase:'partial',processed:5,sent:3,failed:2,unknown:1}},
  {label:'Failed check',state:{...base,phase:'failed',total:null,processed:0,sent:0,detail:'Could not check saved sessions. Retrying on the next check.'}},
  {label:'Requests complete',state:{...base,phase:'complete',processed:5,sent:4,dispatched:1}},
  {label:'Same-core startup (no candidate scan)',state:{...base,phase:'complete',total:0,processed:0,sent:0}},
  {label:'Empty candidate scan',state:{...base,phase:'complete',total:0,processed:0,sent:0,candidatesChecked:true}},
];
writeFileSync(join(directory,'main.js'),`
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme } from "herdr";
import { renderProgress } from "./progress.js";
const states = ${JSON.stringify(states)};
export default class RestorePreview extends View {
  render() {
    const t = theme();
    const panel = entry => v_flex().id('preview-' + entry.label).gap(2)
      .child(div().px(10).text_size(12).text_color(t.muted).child(entry.label))
      .child(renderProgress(entry.state, t));
    return v_flex().id('restore-preview').w(800).p(16).gap(12).bg(t.background)
      .child(div().text_size(18).font_semibold().text_color(t.foreground).child('Preview - no sessions started'))
      .child(div().text_size(12).text_color(t.muted).child('Static test states using the production progress renderer.'))
      .children([0,2,4,6].map(i => h_flex().gap(8).items_start().child(panel(states[i])).child(panel(states[i+1]))));
  }
}
`);
writeFileSync(join(directory,'README.md'),`# Preview - no sessions started\n\nGenerated from ${resolve('mods/wt-restore/progress.js')}.\n\nThe wrapper only reads the theme and renders fixed fixtures. It has no init handler, shared state, session data, restore import, hc/exec/run calls or click handlers. Native spin is rendered by GPUI. This directory is not installed and is safe for an isolated parent preview.\n`);
console.log(`Preview: ${directory}`);
if(process.argv.includes('--native')){
  const result=spawnSync('herdr-app',['check',directory],{encoding:'utf8',timeout:20000});
  process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');
  if(result.error)console.error(String(result.error));
  assert.equal(result.status,0,'native progress renderer check');
  console.log(`native restore progress preview: ${states.length} production render states passed`);
}
