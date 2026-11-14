// Pure label-index checks; native UI imports are inert stubs, no sessions/I/O.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../mods/agents-plus/main.js', import.meta.url), 'utf8');
const context = vm.createContext({});
const imports = new Map();
for (const [, names, name] of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g)) {
  const values = Object.fromEntries(names.split(',').map(part => {
    const key = part.trim();
    return [key, key === 'View' ? class {} : key === 'AGENT_STATUSES' || key === 'STATUS_RANK' ? {} : () => {}];
  }));
  imports.set(name, new vm.SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) this.setExport(key, value);
  }, { context }));
}
const main = new vm.SourceTextModule(source, { context });
await main.link(name => imports.get(name));
await main.evaluate();
const { indexLeadPanes, nearestCheckout } = main.namespace;
const pane = (id, tab, extra = {}) => ({ id, tab, terminal: id, ...extra });
const rows = [
  { id: 'not-terminal', tab: 'empty', program: { agent: true }, focused: true },
  pane('first', 'mixed'), pane('focused', 'mixed', { focused: true }),
  pane('agent', 'mixed', { program: { agent: true } }),
  pane('later-agent', 'mixed', { program: { agent: true }, focused: true }),
  pane('plain-first', 'plain'), pane('plain-next', 'plain'),
  pane('focus-first', 'focus', { focused: true }), pane('focus-next', 'focus', { focused: true }),
];
const leads = indexLeadPanes(rows);
assert.equal(leads.has('empty'), false, 'non-terminal panes cannot win');
assert.equal(leads.get('mixed').id, 'agent', 'first agent wins even after a focused shell');
assert.equal(leads.get('plain').id, 'plain-first');
assert.equal(leads.get('focus').id, 'focus-first');
rows[2].title = 'Updated focused title';
rows[3].program.agent = false; rows[4].program.agent = false;
assert.equal(indexLeadPanes(rows).get('mixed').title, 'Updated focused title', 'each render reflects changed priorities and titles');

let visits = 0;
const many = Array.from({ length: 2000 }, (_, index) => pane(String(index), `tab-${index % 200}`));
const counted = { *[Symbol.iterator]() { for (const row of many) { visits++; yield row; } } };
assert.equal(indexLeadPanes(counted).size, 200);
assert.equal(visits, many.length, 'the index scans panes once, independent of agent count');
const paths = new Set(['/repo', '/repo/work', '/repo/work/src', '/repo/other', '/with-trailing/']);
assert.equal(nearestCheckout('/repo/work/src/main', paths), '/repo/work/src');
assert.equal(nearestCheckout('/repo/work', paths), '/repo/work');
assert.equal(nearestCheckout('/repo/work/', paths), '/repo/work');
assert.equal(nearestCheckout('/repo/worktree', paths), '/repo', 'a sibling prefix is not an ancestor');
assert.equal(nearestCheckout('/with-trailing/file', paths), undefined, 'preserve slash-prefix semantics without normalizing user paths');
assert.equal(nearestCheckout('/with-trailing//file', paths), '/with-trailing/');
assert.equal(nearestCheckout('', paths), undefined);
let lookups = 0;
assert.equal(nearestCheckout('/missing/deep/file', { has() { lookups++; return false; } }), undefined);
assert.equal(lookups, 3, 'lookup work depends on path depth, not repository count');
console.log('sidebar labels: stable pane priority, fresh updates, one-pass indexing and deepest checkout lookup passed');
