// wt-restore (herdr-mods): brings Claude Code and Codex sessions back after Herdr's core
// restarts (a reboot, a logout, a core crash or update).
//
// Herdr keeps spaces, tabs and panes through that, but a lost terminal comes back as a
// shell in its last folder, with the same address, and its program is never run again.
// So this copy, floating in the layout with restore progress (see mod.json), looks every
// EVERY ms at which terminals run an agent and keeps, per terminal address: the agent,
// its session id, how it was started (argv) and where (cwd, space, tab). Claude Code's
// session id comes from the file every running claude keeps (~/.claude/sessions/<pid>.json),
// Codex's from an open rollout or an unambiguous live session name/cwd match.
//
// When the core is another run than the one the records were taken in, each recorded
// session whose terminal is now a bare shell, and that runs nowhere else, can come back:
// in that same terminal, the agent resumes it (claude --resume <id>, codex resume <id>)
// with the flags it had. A session ended on purpose (/exit) isn't recorded by then: the
// next look saw it gone while the core still ran.
//
// A session that was working when the core went (mid-turn) can also go on by itself: it
// resumes with CONTINUE as its first message, which asks the agent to check how far it
// got before carrying on (a command may have been cut off halfway). Orca only reopens
// such sessions and waits; here it's the default for those, and can be turned off per
// session. Sessions that were idle or done just reopen.
//
// The records go to ~/.herdr/restore/last.json (see LAST_FILE). It asks first, in a dialog (this mod with props { mode: "dialog", sessions }), unless
// "Restore without asking" was ticked there; `herdr-app do wt-restore.ask` (or a key bound
// to "wt-restore:ask", or `hm restore`) asks again from now on and offers the stopped
// sessions once more.
//
// A freshly started core is not judged at once: for its first SETTLE ms it still reports
// the terminals as they were saved (claude in the foreground, with a pid from before the
// reboot) and only then gives them shells. Deciding in that window found every session
// "still running", offered nothing, and the next look overwrote the record. So nothing is
// decided or written until the core has run SETTLE ms, a foreground only counts when its
// pid is alive and runs that agent, and the previous run's record is kept in PREV_FILE so
// the offer can be made again.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { hc, exec, readTextFile, writeTextFile, home, appHome, props, openOverlay, closeOverlay, theme, spaces, notify, run, nextCommand, shared, setShared } from "herdr";
// How sessions are found and resumed: lib/resume.js in the repo, copied here by install.sh.
import { AGENTS, agentKind, resumeArgv, sessionOf } from "./resume.js";
import { LIVE, RESTORE_PROGRESS } from "./state.js";
import { RestoreProgress, renderProgress, progressText } from "./progress.js";

const progress = new RestoreProgress(() => shared(RESTORE_PROGRESS), value => setShared(RESTORE_PROGRESS, value));
let polling = false; // one discovery loop even when a layout has multiple copies
let producers = 0;

const EVERY = 5000;
const AUTO = "auto"; // localStorage: "1" restores without asking
// The latest look, { core: { pid, start }, sessions: { address: record } }, in a file of its
// own, written as soon as it changes: a mod's localStorage reaches the disk only now and
// then, and after a reboot this must be what ran just before. (Older builds kept it in
// localStorage "last"; that's read once if the file isn't there yet.)
const LAST = "last";
const LAST_FILE = () => `${home()}/.herdr/restore/last.json`;
// The record of the run before the current core, kept when the core changes, for asking again.
const PREV_FILE = () => `${home()}/.herdr/restore/previous.json`;
// How long a new core runs before its terminals are judged (see the header). The core starts
// lost programs again 1.5s after it starts; this leaves room for slow shells too.
const SETTLE = 20000;
// The first message for a session cut off mid-turn (see the header).
const CONTINUE = "Herdr가 재시작되면서 작업이 중간에 끊겼어. 마지막으로 하던 작업이 어디까지 됐는지 먼저 확인하고, 이어서 진행해줘.";

const base = (p) => String(p ?? "").split("/").pop();
const quote = (s) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`);
const isShell = (argv) => /^-?(zsh|bash|fish|sh|dash|ksh|nu|pwsh|powershell)$/.test(base(argv?.[0]));
// The same core run: the same process, started at the same time (give or take the clock).
const sameRun = (a, b) => Boolean(a && b) && a.pid === b.pid && Math.abs(a.start - b.start) < 60000;

async function hcJson(args) {
  const r = await hc([...args, "--json"]);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || `hc ${args.join(" ")} failed`);
  return JSON.parse(r.stdout);
}

// Which of these pids run now, and which agent each runs: { pid: "claude" | "codex" | null },
// judged from its command line like agentKind (the executable's own name can be a version).
// One ps for all; null when ps itself fails.
async function running(pids) {
  if (!pids.length) return {};
  const r = await exec("ps", ["-o", "pid=,args=", "-p", pids.join(",")]);
  // ps exits 1 when some pid is gone and still lists the others.
  if (r.code !== 0 && !r.stdout.trim()) return r.code === 1 ? {} : null;
  return Object.fromEntries(r.stdout.trim().split("\n").filter(Boolean).map((l) => {
    const [pid, argv0] = l.trim().split(/\s+/);
    return [pid, agentKind([argv0])];
  }));
}

// One look: the core's run (and how long it has run, uptime), and every terminal running
// an agent with what it would take to start that session again. A foreground whose pid
// doesn't run that agent now is a record the core kept from before it started (see SETTLE):
// it isn't counted as running.
async function look() {
  const status = await hcJson(["server", "status"]);
  const core = { pid: status.pid, start: Date.now() - status.uptime_ms };
  const listed = await hcJson(["ls"]);
  const sessions = {};
  const unresolved = [];
  const found = [];
  for (const t of listed.terminals ?? []) {
    if (t.state !== "live" || !/^(claude|codex)/.test(t.agent ?? "")) continue;
    const term = await hcJson(["get", t.address]).catch(() => null);
    const fg = term?.foreground;
    const kind = agentKind(fg?.argv);
    if (!kind || !fg.pid) {
      unresolved.push({ address: t.address, agent: /^claude/.test(t.agent) ? "claude" : "codex", reason: term ? "foreground_unavailable" : "terminal_read_failed" });
      continue;
    }
    found.push({ t, term, fg, kind });
  }
  const alive = await running(found.map((f) => f.fg.pid));
  if (!alive) throw new Error("Cannot list running processes");
  for (const { t, term, fg, kind } of found) {
    if (alive[fg.pid] !== kind) continue;
    const session = await sessionOf(kind, fg.pid, term, "wt-restore");
    if (!session) { unresolved.push({ address: t.address, agent: kind, reason: "session_unresolved" }); continue; }
    sessions[t.address] = {
      address: t.address, agent: kind, session, argv: fg.argv, cwd: fg.cwd || term.cwd,
      space: term.labels?.["herdr.space"] ?? null, tab: term.labels?.["herdr.tab"] ?? null,
      title: String(term.title ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim(),
      // working, blocked, done, idle: what it was doing at this look.
      status: typeof t.status === "string" ? t.status : (t.status?.state ?? term.status?.state ?? null),
    };
  }
  return { core, uptime: status.uptime_ms, sessions, unresolved };
}

// Is this Claude Code session running anywhere now (Orca, another terminal)? Its process
// keeps ~/.claude/sessions/<pid>.json with its id; after a reboot that file can outlive it
// and its pid belong to another program, so the pid must still run claude. Codex: a TUI
// with it open; a shared server is handled separately, because reattaching its UI is allowed.
async function runningElsewhere(rec) {
  const script = rec.agent === "claude"
    ? 'for f in "$HOME"/.claude/sessions/*.json; do grep -q "\\"sessionId\\":\\"$1\\"" "$f" 2>/dev/null && p=$(basename "$f" .json) && case "$(ps -p "$p" -o args= 2>/dev/null | awk \'{n=split($1,a,"/"); print a[n]}\')" in claude*) echo "$p";; esac; done'
    : 'for p in $(pgrep -x codex); do case "$(ps -p "$p" -o args=)" in *" app-server"|*" app-server "*) continue;; esac; lsof -a -p "$p" -Fn 2>/dev/null | grep -q "$1\\.jsonl" && echo "$p"; done';
  const r = await exec("sh", ["-c", script, "sh", rec.session]).catch(() => null);
  return Boolean(r?.stdout.trim());
}

// The recorded sessions that can come back now: their terminal is a bare shell (or gone,
// then a new tab in their space), and they run nowhere else. Why each other one was left
// out goes to `skipped` ({ address, agent, reason }), for the restore log.
async function restorable(last, now, skipped = []) {
  const out = [];
  const live = new Set(Object.values(now.sessions).map((s) => s.session));
  for (const rec of Object.values(last.sessions ?? {})) {
    const skip = (reason) => skipped.push({ address: rec.address, agent: rec.agent, reason });
    if (live.has(rec.session)) { skip("running_in_herdr"); continue; }
    if (await runningElsewhere(rec)) { skip("running_elsewhere"); continue; }
    const term = await hcJson(["get", rec.address]).catch(() => null);
    const bare = term && term.state === "live" && (!term.foreground || isShell(term.foreground.argv));
    if (term && !bare) { skip("terminal_busy"); continue; } // something else runs there now
    // A daemon can keep working after the terminal/core closes. Reattach its UI,
    // but don't submit an extra continuation prompt to an already loaded session.
    let backendAlive = false;
    if (rec.agent === "codex") {
      try {
        const r = await exec("python3", ["-I", `${appHome()}/mods/wt-restore/codex_live.py`, JSON.stringify({ writer: rec.session })]);
        backendAlive = r.code !== 0 || JSON.parse(r.stdout) !== false;
      } catch { backendAlive = true; } // unknown: reopen without triggering work
    }
    out.push({ ...rec, gone: !term, go: rec.status === "working" && !backendAlive });
  }
  return out;
}

// Starts each again: typed into its terminal's shell, in its folder; a terminal that's
// gone gets a new tab in its space (if the space is still there).
async function logRestore(channel, problem) {
  try {
    const r = await exec("python3", ["-I", `${appHome()}/mods/wt-restore/diagnostics.py`, appHome(), JSON.stringify({ channel, problem })]);
    if (r.code !== 0) throw new Error("restore diagnostic write failed");
  } catch { console.warn("wt-restore: diagnostic log unavailable"); }
}

export async function restore(list) {
  if (shared(RESTORE_PROGRESS)?.phase === "restoring") return false;
  if (!list.length) return false;
  const id = progress.begin("restoring", { total: list.length });
  let processed = 0, sent = 0, dispatched = 0, failed = 0, unknown = 0, detail = "", phase = "interrupted";
  const outcomes = [];
  try {
    for (const rec of list) {
      // Closing/reloading the producer invalidates its queue. An already sent
      // request may finish, but no remaining request is silently replayed.
      if (!progress.owns(id)) return false;
      progress.update(id, { inFlight: 1 });
      let result, code;
      try {
        const argv = resumeArgv(rec, rec.go ? CONTINUE : null);
        if (!rec.gone) {
          const r = await hc(["send", rec.address, `cd ${quote(rec.cwd)} && ${argv.map(quote).join(" ")}`]);
          code = r.code;
          if (r.code === 0) { sent++; result = "send_accepted"; }
          else { failed++; result = "send_rejected"; detail = "Some opening requests failed. Check the sessions before trying again."; }
        } else if (spaces().some((s) => s.id === rec.space)) {
          run("tab.new", { space: rec.space, folder: rec.cwd, argv, name: rec.title.slice(0, 28) || undefined });
          dispatched++; // fire-and-forget: never claim the tab or agent is ready
          result = "tab_dispatched_unconfirmed";
        } else {
          failed++;
          result = "missing_space";
          detail = "A session's workspace is no longer open.";
        }
      } catch {
        failed++;
        unknown++;
        result = "request_threw"; // may have reached the shell; do not retry it
        detail = "An opening request could not be confirmed. Check that session before trying again.";
      }
      if (outcomes.length < 100) outcomes.push({ address: rec.address, agent: rec.agent, result, ...(code === undefined ? {} : { code }) });
      processed++;
      if (!progress.update(id, { processed, sent, dispatched, failed, unknown, inFlight: 0, detail })) return false;
    }
    phase = failed ? sent + dispatched ? "partial" : "failed" : "complete";
    progress.finish(id, phase);
    const text = progressText(shared(RESTORE_PROGRESS));
    notify({ title: text.title, body: text.detail, level: failed ? "warning" : "info", timeout: 5000 });
    return true;
  } finally {
    // One bounded event per batch, even when a request throws. No titles, cwd,
    // session IDs, argv, prompts or raw command output enter the diagnostic log.
    await logRestore("restore", { total: list.length, processed, sent, dispatched, failed, unknown,
      phase, notAttempted: list.length - processed, outcomes, omitted: processed - outcomes.length });
  }
}

// Restores the list at once if "Restore without asking" was ticked, else asks in the dialog.
async function offer(list) {
  if (!list.length) {
    const id = progress.begin("checking", { total: 0, candidatesChecked: true });
    progress.finish(id, "complete");
    return;
  }
  if (localStorage.getItem(AUTO) === "1") await restore(list);
  else {
    const id = progress.begin("ready", { total: list.length });
    try { openOverlay({ mod: "wt-restore", kind: "dialog", modal: true, width: 520, height: Math.min(560, 190 + list.length * 46), props: { mode: "dialog", sessions: list, progressId: id, progressOwner: progress.owner } }); }
    catch (error) { progress.finish(id, "failed", { detail: "Could not open the restore dialog." }); throw error; }
  }
}

export default class WtRestore extends View {
  init(_props, cx) {
    if (props()?.mode === "dialog") return this.initDialog(cx);
    this.producer = true;
    producers++;
    this.busy = false;
    this.checkId = progress.startup();
    this.tick(cx);
    cx.timer.every(EVERY, (cx) => { progress.expire(); this.tick(cx); });
    // Key commands. The loop touches its cx each time round, so a reload's old build stops
    // at its next command instead of answering it too.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        cx.notify();
        if (c !== "ask") continue;
        localStorage.removeItem(AUTO);
        await this.askAgain();
      }
    });
  }

  // `ask`: from now on ask before restoring, and offer again what the last core restart
  // stopped (PREV_FILE) that runs nowhere now (one restored since is left out).
  async askAgain() {
    if (polling || shared(RESTORE_PROGRESS)?.phase === "restoring") {
      notify({ title: shared(RESTORE_PROGRESS)?.phase === "restoring" ? "Session restore is already running" : "Session check is already running",
        body: "Please wait for it to finish, then try again.", level: "info", timeout: 5000 });
      return;
    }
    polling = true;
    const id = progress.begin("checking");
    let list = [];
    try {
      const prev = JSON.parse((await readTextFile(PREV_FILE())) ?? "null");
      if (prev) list = await restorable(prev, await look());
      if (this.closed || !progress.owns(id)) return;
      await offer(list);
    } catch (error) {
      progress.finish(id, "failed", { detail: "Could not check saved sessions. Try again later." });
      notify({ title: "Could not read the stopped sessions", body: String(error.message ?? error).slice(0, 160), level: "warning", timeout: 6000 });
      return;
    } finally { polling = false; }
    if (!list.length) notify({ title: "No stopped sessions to restore", body: "Herdr will ask before restoring sessions after the next restart.", level: "info", timeout: 5000 });
  }

  // Record health transitions outside the restore file; do not store conversation content.
  async health(channel, problem) {
    this.healthStates ??= {};
    const signature = JSON.stringify(problem), previous = this.healthStates[channel];
    if (!previous && !problem) return;
    if (previous?.signature === signature && Date.now() - previous.at < 60000) return;
    if (previous?.signature === signature && !problem) return;
    this.healthStates[channel] = { signature, at: Date.now() };
    if (problem && previous?.signature !== signature) notify({ title: "Session restore needs attention", body: channel === "identity" ? "Some agent sessions could not be identified. Their terminals remain open; details are in diagnostics/restore.jsonl." : "Restore records could not be updated. Retrying on the next check.", level: "warning", timeout: 7000 });
    await this.log(channel, problem);
  }

  // One line in diagnostics/restore.jsonl (hm logs --restore), without a toast.
  async log(channel, problem) {
    await logRestore(channel, problem);
  }

  // One look; offer restoration once per runtime transition, independent of save retries.
  // A core younger than SETTLE still shows its terminals as saved before it started (see the
  // header): nothing is decided or written yet, so the previous run's record stays as it was.
  tick(cx) {
    if (this.busy || polling || this.closed || !progress.current() || shared(RESTORE_PROGRESS)?.phase === "restoring") return;
    this.busy = true;
    polling = true;
    cx.spawn(async () => {
      try {
        const now = await look();
        if (this.closed || !progress.current()) return;
        if (now.uptime < SETTLE) {
          if (this.checkId != null) progress.update(this.checkId, { phase: "waiting" });
          return;
        }
        if (this.checkId != null) progress.update(this.checkId, { phase: "checking" });
        let last = null;
        if (this.savedText === undefined) {
          const directory = await exec("mkdir", ["-p", LAST_FILE().replace(/\/[^/]+$/, "")]);
          if (directory.code !== 0) throw new Error("Cannot create restore directory");
          this.savedText = await readTextFile(LAST_FILE());
          if (this.savedText == null) this.savedText = null;
        }
        try { last = JSON.parse(this.savedText ?? localStorage.getItem(LAST) ?? "null"); } catch {}
        if (this.closed || !progress.current()) return;
        if (last && !sameRun(last.core, now.core) && !sameRun(this.offeredCore, now.core) && !sameRun(shared(RESTORE_PROGRESS)?.offeredCore, now.core)) {
          this.checkId = progress.begin("checking");
          const skipped = [];
          const list = await restorable(last, now, skipped);
          if (this.closed || !progress.owns(this.checkId)) return;
          this.offeredCore = now.core; // Do not repeat a prompt/auto-resume when disk retries fail.
          progress.update(this.checkId, { offeredCore: now.core });
          // Keep the run that stopped (last.json is overwritten below), for `ask` to offer again.
          if (Object.keys(last.sessions ?? {}).length) {
            try { await writeTextFile(PREV_FILE(), JSON.stringify(last), await readTextFile(PREV_FILE())); }
            catch (error) { await this.log("previous", { reason: String(error.message ?? error).slice(0, 240) }); }
          }
          await this.log("offer", { recorded: Object.keys(last.sessions ?? {}).length, offered: list.length, skipped });
          if (this.closed || !progress.owns(this.checkId)) return;
          await offer(list);
        }
        // Only the initial check is visible. Ordinary recording polls stay quiet.
        if (this.checkId != null && progress.owns(this.checkId)) progress.finish(this.checkId, "complete", { total: 0 });
        this.checkId = null;
        // Written only when it changed (a session started, ended or changed state).
        const record = JSON.stringify({ core: now.core, sessions: now.sessions });
        try {
          if (record !== this.savedText) {
            try { await writeTextFile(LAST_FILE(), record, this.savedText); }
            catch { await writeTextFile(LAST_FILE(), record, await readTextFile(LAST_FILE())); }
            this.savedText = record; // Only an acknowledged atomic write advances the cache.
          }
          await this.health("storage", null);
        } catch (error) {
          await this.health("storage", { reason: String(error.message ?? error).slice(0, 240) });
        }
        await this.health("identity", now.unresolved?.length ? { unresolved: now.unresolved } : null);
        // Which sessions run in Herdr's terminals now, for other mods (agents-plus goes to one
        // instead of opening it again): shared "wt.live" = { session id: terminal address }.
        const live = Object.fromEntries(Object.values(now.sessions).map((r) => [r.session, r.address]));
        const text = JSON.stringify(live);
        if (text !== this.liveText) { this.liveText = text; setShared(LIVE, live); }
        await this.health("poll", null);
      } catch (error) {
        if (this.checkId != null) progress.finish(this.checkId, "failed", { detail: "Could not check saved sessions. Retrying on the next check." });
        this.checkId = null;
        await this.health("poll", { reason: String(error.message ?? error).slice(0, 240) });
      } finally { this.busy = false; polling = false; }
    });
  }

  initDialog(cx) {
    this.picked = new Set((props().sessions ?? []).map((s) => s.address));
    this.goOn = new Set((props().sessions ?? []).filter((s) => s.go).map((s) => s.address)); // resume with CONTINUE
    this.auto = false;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  dismissDialog() {
    this.dismissed = true;
    const p = props();
    if (!this.submitted && p.progressOwner === progress.owner) progress.finish(p.progressId, "cancelled");
    closeOverlay(props().overlay);
  }

  close() {
    if (props()?.mode === "dialog") {
      this.dismissed = true;
      const p = props();
      if (!this.submitted && p.progressOwner === progress.owner) progress.finish(p.progressId, "cancelled");
    } else {
      this.closed = true;
      if (this.producer) { producers--; this.producer = false; }
      if (!producers) progress.interrupt();
    }
  }

  go() {
    if (this.submitted || this.dismissed) return;
    const list = (props().sessions ?? []).filter((s) => this.picked.has(s.address)).map((s) => ({ ...s, go: this.goOn.has(s.address) }));
    if (this.auto) localStorage.setItem(AUTO, "1");
    this.submitted = list.length > 0;
    this.dismissDialog();
    if (list.length) restore(list);
  }

  check(on, t) {
    return div().size(15).flex_none().rounded(4).border(1).border_color(on ? t.accent : t.border).bg(on ? t.accent : t.background)
      .flex().items_center().justify_center()
      .when(on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(11).text_color(t.accent_foreground)));
  }

  renderDialog(t) {
    const list = props().sessions ?? [];
    const where = (s) => {
      const sp = spaces().find((x) => x.id === s.space);
      const tab = sp?.tabs?.find((x) => x.id === s.tab);
      return [sp?.name, tab ? (tab.named ? tab.name : `tab ${tab.index}`) : null].filter(Boolean).join(" › ") || s.cwd.replace(home(), "~");
    };
    return v_flex().id("wt-restore").track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") this.dismissDialog();
        else if (e.key === "enter") this.go();
        else return;
        cx.stop_propagation();
      })
      .size_full().p(18).gap(12).bg(t.popover).text_size(13)
      .child(v_flex().gap(4)
        .child(div().font_semibold().text_size(14).text_color(t.foreground).child("Restore your agent sessions?"))
        .child(div().text_color(t.muted).child(`Herdr restarted, and ${list.length === 1 ? "this session" : `these ${list.length} sessions`} stopped with it. Each opens again in the same tab. With "continue", one that was working checks how far it got and carries on.`)))
      .child(v_flex().id("wt-restore-list").flex_1().min_h(0).gap(2).overflow_y_scroll()
        .children(list.map((s, i) => {
          const on = this.picked.has(s.address);
          const how = AGENTS[s.agent];
          return h_flex().id(`wr-${i}`).h(44).flex_none().px(10).gap(10).items_center().rounded(7).cursor_pointer()
            .hover((st) => st.bg(t.hover))
            .on_click((_e, cx) => { on ? this.picked.delete(s.address) : this.picked.add(s.address); cx.notify(); })
            .child(this.check(on, t))
            .child(image(how.icon).size(15).flex_none())
            .child(v_flex().flex_1().min_w(0)
              .child(div().truncate().text_color(t.foreground).child(s.title || how.name))
              .child(div().truncate().text_size(11.5).text_color(t.dim).child(`${where(s)}${s.status === "working" ? " · was working" : ""}`)))
            // Resume with CONTINUE as its first message, or just reopen.
            .when(on, (el) => {
              const go = this.goOn.has(s.address);
              return el.child(div().id(`wr-go-${i}`).flex_none().px(8).h(22).flex().items_center().rounded(11).cursor_pointer().text_size(11)
                .border(1).border_color(go ? t.accent : t.border).text_color(go ? t.accent : t.dim)
                .tooltip(go ? "Resumes with a message to check its work and carry on" : "Just reopens it")
                .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
                .on_click((_e, cx) => { cx.stop_propagation(); go ? this.goOn.delete(s.address) : this.goOn.add(s.address); cx.notify(); })
                .child(go ? "continue" : "reopen"));
            });
        })))
      .child(h_flex().gap(10).items_center()
        .child(h_flex().id("wr-auto").gap(8).items_center().cursor_pointer().text_size(12).text_color(t.muted)
          .on_click((_e, cx) => { this.auto = !this.auto; cx.notify(); })
          .child(this.check(this.auto, t)).child("Restore without asking next time"))
        .child(div().flex_1())
        .child(div().id("wr-no").px(12).h(30).flex().items_center().rounded(6).cursor_pointer().text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => this.dismissDialog()).child("Not now"))
        .child(div().id("wr-yes").px(14).h(30).flex().items_center().rounded(6).cursor_pointer().bg(t.solid).text_color(t.solid_foreground)
          .when(this.picked.size === 0, (el) => el.opacity(0.5))
          .on_click(() => this.go()).child(`Restore${this.picked.size ? ` ${this.picked.size}` : ""}`)));
  }

  render(cx) {
    if (props()?.mode === "dialog") return this.renderDialog(theme());
    return renderProgress(shared(RESTORE_PROGRESS), theme(), () => {
      const state = shared(RESTORE_PROGRESS);
      if (state) setShared(RESTORE_PROGRESS, { ...state, hidden: true });
    });
  }
}
