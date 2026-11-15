// Read-only startup investigation. Never initializes the live mod or calls restore().
// node --experimental-vm-modules scripts/audit-restore-startup.mjs [--live]
// JSON on stdout; redirect it to a file in this worktree to retain measurements.
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import { performance } from 'node:perf_hooks';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const execute = promisify(execFile);
const source = await readFile(resolve(root, 'mods/wt-restore/main.js'), 'utf8');
const files = { main: 'mods/wt-restore/main.js', './resume.js': 'lib/resume.js',
  // resume.js imports this pure argv helper; keep the reviewed module allowlist explicit.
  './agent-launch.js': 'lib/agent-launch.js',
  './state.js': 'lib/state.js', './progress.js': 'mods/wt-restore/progress.js' };
const denied = () => { throw Error('Audit forbids session launch, input and application mutations'); };
const digest = text => createHash('sha256').update(text).digest('hex');
const round = n => Math.round(n * 1000) / 1000;

async function load(host, clock = Date) {
  const context = vm.createContext({ console, Date: clock,
    localStorage: { getItem: () => null, setItem: denied, removeItem: denied } });
  const synthetic = (name, exports) => new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
  }, { context, identifier: name });
  const modules = new Map([
    ['herdr', synthetic('herdr', host)],
    ['gpui-kit', synthetic('gpui-kit', { View: class {}, div: denied, svg: denied, image: denied })],
    ['gpui-base', synthetic('gpui-base', { v_flex: denied, h_flex: denied })],
  ]);
  async function module(name) {
    if (modules.has(name)) return modules.get(name);
    assert.ok(files[name], `Unreviewed import: ${name}`);
    let text = await readFile(resolve(root, files[name]), 'utf8');
    if (name === 'main') text += '\nexport { look, restorable, runningElsewhere, EVERY, SETTLE };';
    const result = new vm.SourceTextModule(text, { context, identifier: name });
    modules.set(name, result);
    return result;
  }
  const main = await module('main');
  await main.link(module);
  await main.evaluate();
  return main.namespace;
}

function hostBase() {
  return { hc: denied, exec: denied, readTextFile: denied, writeTextFile: denied,
    home: () => homedir(), appHome: () => '/audit', props: () => ({}),
    openOverlay: denied, closeOverlay: denied, theme: denied, spaces: denied,
    notify: denied, run: denied, nextCommand: () => new Promise(() => {}),
    shared: () => undefined, setShared: denied, terminals: denied };
}

// Execute the actual startup/tick branch with a fake clock and inert transports.
// Stop at the offer; AUTO is absent and hc send/run are always forbidden.
async function timeline(offset, sameCore = false) {
  let uptime = offset;
  const epoch = 1800000000000, state = {}, disk = {}, offers = [], tasks = [], timers = [];
  const last = { core: { pid: sameCore ? 2 : 1, start: sameCore ? epoch : epoch - 60000 },
    sessions: { t1: { address: 't1', agent: 'codex', session: 'synthetic-session',
      argv: ['codex'], cwd: '/synthetic', space: 's1', title: 'Synthetic', status: 'idle' } } };
  disk[`${homedir()}/.herdr/restore/last.json`] = JSON.stringify(last);
  const host = { ...hostBase(),
    shared: key => state[key], setShared: (key, value) => { state[key] = value; },
    readTextFile: async path => disk[path] ?? null,
    writeTextFile: async (path, value) => { disk[path] = value; },
    openOverlay: value => offers.push({ uptime_ms: uptime, candidates: value.props.sessions.length }),
    hc: async args => {
      if (args[0] === 'server') return { code: 0, stdout: JSON.stringify({ pid: 2, uptime_ms: uptime }) };
      if (args[0] === 'ls') return { code: 0, stdout: '{"terminals":[]}' };
      if (args[0] === 'get') return { code: 0, stdout: '{"state":"live","foreground":{"argv":["zsh"]}}' };
      return denied();
    },
    exec: async (program, args) => {
      if (program === 'mkdir' || program === 'sh') return { code: 0, stdout: '' };
      if (program === 'python3' && args[1].endsWith('/diagnostics.py')) return { code: 0, stdout: '' };
      if (program === 'python3' && args[1].endsWith('/codex_live.py')) return { code: 0, stdout: 'false' };
      return denied();
    },
  };
  const mod = await load(host, class extends Date { static now() { return epoch + uptime; } });
  const view = new mod.default();
  const cx = { spawn: fn => { const task = fn(cx); tasks.push(task); return task; },
    notify() {}, timer: { every: (ms, fn) => timers.push({ ms, fn }) } };
  view.init({}, cx);
  await tasks[0];
  const phases = [{ uptime_ms: uptime, phase: state['wt.restoreProgress'].phase }];
  assert.equal(timers[0].ms, mod.EVERY);
  if (!sameCore) while (!offers.length && uptime < mod.SETTLE + mod.EVERY) {
    uptime += timers[0].ms;
    const n = tasks.length;
    timers[0].fn(cx);
    await tasks[n];
    phases.push({ uptime_ms: uptime, phase: state['wt.restoreProgress'].phase });
  }
  if (sameCore) assert.equal(offers.length, 0);
  else {
    assert.equal(offers.length, 1);
    assert.equal(offers[0].uptime_ms, offset + Math.max(0, Math.ceil((mod.SETTLE - offset) / mod.EVERY)) * mod.EVERY);
  }
  return { clock: 'synthetic; zero transport duration', same_core: sameCore, offset_ms: offset,
    settle_ms: mod.SETTLE, poll_ms: mod.EVERY, phases, offers };
}

async function live() {
  const calls = [], transportFailures = [];
  async function command(program, args, stage) {
    const started = performance.now();
    let result;
    try {
      const r = await execute(program, args, { cwd: root, timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
      result = { code: 0, stdout: r.stdout, stderr: r.stderr };
    } catch (error) {
      if (error.killed || typeof error.code !== 'number') throw Error(`Read-only ${stage} failed or exceeded 15s`);
      result = { code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
    }
    calls.push({ stage, elapsed_ms: round(performance.now() - started), code: result.code });
    return result;
  }
  const host = { ...hostBase(),
    hc: args => {
      assert.ok((args[0] === 'server' && args[1] === 'status' && args.length === 3)
        || (args[0] === 'ls' && args.length === 2)
        || (args[0] === 'get' && /^t[0-9a-z]+$/.test(args[1]) && args.length === 3));
      assert.equal(args.at(-1), '--json');
      return command('hc', args, `hc.${args[0]}`);
    },
    readTextFile: async path => {
      assert.ok(path.startsWith(`${homedir()}/.claude/sessions/`) && /\/\d+\.json$/.test(path));
      return readFile(path, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    },
    exec: async (program, args) => {
      if (program === 'ps') {
        assert.equal(args[0], '-o'); assert.equal(args[1], 'pid=,args=');
        assert.equal(args[2], '-p'); assert.match(args[3], /^\d+(,\d+)*$/); assert.equal(args.length, 4);
        return command(program, args, 'ps.foreground');
      }
      if (program === 'python3') {
        assert.deepEqual(Array.from(args.slice(0, 2)), ['-I', '/audit/mods/wt-restore/codex_live.py']);
        assert.equal(args.length, 3);
        const request = JSON.parse(args[2]);
        const r = await command(program, ['-B', '-I', resolve(root, 'lib/codex_live.py'), args[2]],
          'writer' in request ? 'codex.writer' : 'codex.identity');
        if (!('writer' in request) && r.code === 0) calls.at(-1).source = JSON.parse(r.stdout)?.source ?? 'unresolved';
        return r;
      }
      if (program === 'sh') {
        assert.equal(args.length, 4); assert.equal(args[0], '-c'); assert.equal(args[2], 'sh');
        assert.match(args[3], /^[0-9a-f-]{36}$/);
        // Accept only the read-only Codex scan copied verbatim from this revision.
        const literal = source.match(/\n    : ('for p in .*');\n  const r = await exec\("sh"/);
        assert.ok(literal, 'Codex discovery shell changed; review the audit allowlist');
        assert.equal(args[1], vm.runInNewContext(literal[1]));
        return command(program, args, 'codex.runningElsewhere');
      }
      return denied();
    },
  };
  // Production identity helpers catch probe errors. Do not let an audit guard
  // failure silently turn into a successful, suspiciously fast unresolved look.
  for (const key of ['hc', 'exec', 'readTextFile']) {
    const original = host[key];
    host[key] = async (...args) => {
      try { return await original(...args); }
      catch (error) { transportFailures.push(key); throw error; }
    };
  }
  const mod = await load(host);
  const batches = [];
  for (let i = 0; i < 3; i++) {
    const start = performance.now(), begin = calls.length;
    const snapshot = await mod.look();
    assert.deepEqual(transportFailures, [], 'Audit transport/allowlist failed; discard the timings');
    batches.push({ kind: 'look', elapsed_ms: round(performance.now() - start),
      identified: Object.keys(snapshot.sessions).length, unresolved: snapshot.unresolved.length,
      core_pid: snapshot.core.pid, core_start_ms: snapshot.core.start, calls: calls.slice(begin) });
  }
  // One absent UUID per scan forces a miss; no session is launched or touched.
  // These are current-machine discovery costs, not replayed startup durations.
  for (let i = 0; i < 3; i++) {
    const start = performance.now(), begin = calls.length;
    const found = await mod.runningElsewhere({ agent: 'codex', session: randomUUID() });
    assert.deepEqual(transportFailures, [], 'Audit transport/allowlist failed; discard the timings');
    batches.push({ kind: 'absent_codex_scan', elapsed_ms: round(performance.now() - start), found,
      calls: calls.slice(begin) });
  }
  const installed = resolve(homedir(), '.config/herdr-app/mods/wt-restore');
  const hashes = [];
  for (const [name, local] of [['main.js', files.main], ['resume.js', files['./resume.js']],
    ['codex_live.py', 'lib/codex_live.py'], ['agentfiles.py', 'lib/agentfiles.py']]) {
    const current = await readFile(resolve(root, local));
    const active = await readFile(resolve(installed, name));
    hashes.push({ name, checkout_sha256: digest(current), installed_sha256: digest(active) });
  }
  const offers = [];
  for (const name of ['restore.jsonl.1', 'restore.jsonl']) {
    const text = await readFile(resolve(installed, '../../diagnostics', name), 'utf8')
      .catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
    for (const line of text.split('\n').filter(Boolean)) {
      const event = JSON.parse(line);
      if (event.channel === 'offer' && Date.parse(event.at) >= batches[0].core_start_ms)
        offers.push({ at: event.at, recorded: event.problem.recorded, offered: event.problem.offered,
          seconds_since_core_start: round((Date.parse(event.at) - batches[0].core_start_ms) / 1000) });
    }
  }
  const processes = (await execute('ps', ['-axo', 'pid=,ppid=,%cpu=,rss=,comm='])).stdout.trim().split('\n').map(line => {
    const [pid, ppid, cpu, rss, ...command] = line.trim().split(/\s+/);
    return { pid: +pid, ppid: +ppid, cpu_ps_percent: +cpu, rss_kib: +rss, name: basename(command.join(' ')) };
  });
  const index = resolve(process.env.CODEX_HOME || resolve(homedir(), '.codex'), 'session_index.jsonl');
  return { measurement: 'read-only current-machine commands, sequential; no restart', batches, hashes, offers,
    codex_processes: processes.filter(p => p.name === 'codex').length,
    orca_processes: processes.filter(p => /orca/i.test(p.name)).length,
    background_process_snapshot: processes.sort((a, b) => b.cpu_ps_percent - a.cpu_ps_percent).slice(0, 12),
    session_index_bytes: await stat(index).then(s => s.size).catch(() => null) };
}

const report = { at: new Date().toISOString(),
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  main_sha256: digest(source),
  timelines: await Promise.all([0, 1000, 19999, 20000].map(offset => timeline(offset))),
  same_core: await timeline(60000, true) };
if (process.argv.includes('--live')) report.live = await live();
console.log(JSON.stringify(report, null, 2));
