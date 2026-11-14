import assert from 'node:assert/strict';
import { RenderProfile } from '../mods/agents-plus/render-profile.js';

let time = 1000;
const profile = new RenderProfile(() => time);
profile.begin();
profile.counts({ agents: 12 });
time += 5;
profile.phase('rows');
time += 30;
profile.finish();
let batch = profile.take();
assert.equal(batch.completed, 1);
assert.equal(batch.slow, 1);
assert.equal(batch.total_ms, 35);
assert.equal(batch.phases.inputs.total_ms, 5);
assert.equal(batch.phases.rows.total_ms, 30);
assert.equal(batch.worst.counts.agents, 12);
assert.equal(profile.take(), null);

// A host interruption may not run finally. Time before the next timer/render
// must never become a fabricated 60-second render duration.
profile.begin();
time += 4;
profile.phase('rows');
time += 60000;
batch = profile.take();
assert.equal(batch.completed, 0);
assert.equal(batch.unfinished, 1);
assert.equal(batch.total_ms, 0);
assert.equal(batch.samples[0].last_phase, 'rows');
assert.deepEqual(batch.samples[0].completed_phases, { inputs: 4 });
assert.equal(batch.samples[0].total_ms, undefined);

profile.begin();
time += 1;
profile.begin(); // A later render also notices the unfinished predecessor.
time += 2;
profile.finish();
batch = profile.take();
assert.equal(batch.unfinished, 1);
assert.equal(batch.completed, 1);
assert.equal(batch.total_ms, 2);

// Bound memory even during persistent write failures; preserve worst + latest 8.
for (let i = 100; i > 0; i--) {
  profile.begin();
  time += 25 + i;
  profile.finish();
}
batch = profile.take();
assert.equal(batch.samples.length, 8);
assert.equal(batch.slow, 100);
assert.equal(batch.worst.total_ms, 125);
assert.equal(batch.samples.at(-1).total_ms, 26);

profile.begin();
time -= 10;
profile.finish();
batch = profile.take();
assert.equal(batch.invalid_clock, 1);
assert.equal(batch.completed, 0);
console.log('render profile: timing, unfinished, bounds and clock checks passed');
