// Bounded, in-memory wall-clock measurements. No host reads, I/O or redraws here.
// Only completed phase boundaries are timed after an unfinished render: the next
// callback's delay is NOT execution time. This is JS description time, not a GPU frame.
export class RenderProfile {
  constructor(clock = () => Date.now()) {
    this.clock = clock;
    this.instance = `${clock()}-${Math.random().toString(36).slice(2, 10)}`;
    this.reset();
  }

  reset() {
    this.stats = { completed: 0, slow: 0, unfinished: 0, invalid_clock: 0, total_ms: 0,
      max_ms: 0, phases: {}, samples: [], worst: null };
  }

  begin() {
    this.abandon();
    const at = this.clock();
    this.pending = { started_at_ms: at, last: at, phase: "inputs", phases: {}, counts: {} };
  }

  phase(next) {
    const p = this.pending;
    const at = this.clock();
    if (at < p.last) p.invalid_clock = true;
    p.phases[p.phase] = Math.max(0, at - p.last);
    p.last = at;
    p.phase = next;
  }

  counts(values) { Object.assign(this.pending.counts, values); }

  sample(value) {
    this.stats.samples.push(value);
    if (this.stats.samples.length > 8) this.stats.samples.shift();
  }

  abandon() {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    this.stats.unfinished++;
    this.sample({ outcome: "unfinished", started_at_ms: p.started_at_ms,
      last_phase: p.phase, completed_phases: p.phases, counts: p.counts,
      invalid_clock: Boolean(p.invalid_clock) });
  }

  finish() {
    this.phase("finished");
    const p = this.pending;
    this.pending = null;
    if (p.invalid_clock) { this.stats.invalid_clock++; return; }
    const ms = p.last - p.started_at_ms;
    const s = this.stats;
    s.completed++;
    s.total_ms += ms;
    s.max_ms = Math.max(s.max_ms, ms);
    for (const [name, elapsed] of Object.entries(p.phases)) {
      const phase = s.phases[name] ??= { total_ms: 0, max_ms: 0 };
      phase.total_ms += elapsed;
      phase.max_ms = Math.max(phase.max_ms, elapsed);
    }
    const record = { outcome: "completed", started_at_ms: p.started_at_ms, total_ms: ms,
      phases: p.phases, counts: p.counts };
    if (!s.worst || ms > s.worst.total_ms) s.worst = record;
    if (ms >= 25) { s.slow++; this.sample(record); }
  }

  take() {
    this.abandon();
    const s = this.stats;
    if (!s.completed && !s.unfinished && !s.invalid_clock) return null;
    const batch = { schema: 1, instance: this.instance, slow_ms: 25, ...s };
    this.reset();
    return batch;
  }
}
