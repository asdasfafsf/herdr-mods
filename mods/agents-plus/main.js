// Agents in grouped or priority views; parents take their most urgent sub-agent's place.
// A viewed done agent stays in Done until left.
//
// agents-plus (herdr-mods): a clone of the shipped `agents` that also lists the coding agents
// running outside Herdr (Orca, iTerm, VS Code…; outside.py finds them), so every agent shows
// here, beside Herdr's own in the section of their state (priority view), or in an "Outside
// Herdr" group at the end (grouped by space), each saying which app it runs in. And by
// priority, an "Active" section on top holds the agents of the tab being looked at. A row
// with news gets a second line: what a working agent is doing, what a waiting one asks to
// run, the first line of a finished one's answer (activity.py); hovering says its repo and
// branch (on the row too when two read the same). Clicking one opens that session in Herdr (spaces-plus's resume: a Herdr
// terminal already running it, else resumed as it was started; the other app's copy keeps
// running, as Claude Code and Codex allow).

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout, exec, appHome } from "herdr";
// How sessions are resumed: lib/resume.js in the repo, copied here by install.sh.
import { resumeArgv, AGENTS, runs } from "./resume.js";
import { TREES, META, LIVE, AGENT_INFO, AGENT_ORDER, ACKED, ackDone, setIfChanged, option, setOption, OPTION_DEFS, OPTIONS, REPO_COLORS } from "./state.js";
import { inside, placeOf } from "./places.js";
import { statusMark, statusPill, statusColor, shownStatus, seenFor, repoTag } from "./ui.js";
import { renderViewSwitch, applyModeTheme, workspaceTheme } from "./agent-mode.js";
import { setThemeContrast } from "./theme-contrast.js";
import { RenderProfile } from "./render-profile.js";
import { openAgentView, initAgentView, renderAgentView } from "./overview.js";

// The agents outside Herdr, read every OUTSIDE_EVERY ms while the window is in front.
const OUTSIDE_EVERY = 10000;
const OUTSIDE_ICON = { claude: "icons/claude.svg", codex: "icons/codex.svg" };

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function lead(tab, all = panes()) {
  const mine = all.filter(p => p.tab === tab.id && p.terminal);
  return mine.find(p => p.program?.agent) ?? mine.find(p => p.focused) ?? mine[0];
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  const telling = live && live !== prog && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const ACTIVITY_EVERY = 3000; // how often working agents' current step is read (see readActivity)
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
const SORTS = [
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Grouped by space", icon: "layers" },
];
const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];
const SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1.5: "Seen", 1: "Idle" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working", 1.5: "seen" };
const SEEN_RANK = 1.5; // Seen (lib/ui.js): between Working and Idle

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// The agent's icon from the app's program table: a one-color glyph or a picture.
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export default class Agents extends View {
  init(_props, cx) {
    if (props()?.mode === "view-switch") {
      applyModeTheme(workspaceTheme());
      cx.spawn(async (cx) => { await setThemeContrast(workspaceTheme() === "chiikawa"); cx.notify(); });
      return;
    }
    if (props()?.sortMenu) return;
    // Themes share the same overview state: default cards or a Chiikawa village.
    if (props()?.mode === "overview") return initAgentView(this, cx);
    this.renderProfile = new RenderProfile();
    // Persist aggregates outside render; never set shared state or notify for telemetry.
    cx.timer.every(60000, (cx) => this.flushRenderProfile(cx));
    this.folded = new Set();
    this.outside = []; // see readOutside
    this.readOutside(cx);
    cx.timer.every(OUTSIDE_EVERY, (cx) => { if (window().active) this.readOutside(cx); });
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    // When each finished agent was looked at (ms), for Seen (lib/ui.js), and the state each
    // had last (Herdr's word: done and idle apart, unlike changed).
    this.seen = JSON.parse(localStorage.getItem("seen") ?? "{}");
    this.raw = new Map();
    this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
    cx.timer.every(30000, (cx) => cx.notify());
    // What working, waiting and finished agents are doing or said (see readActivity).
    this.activity = {};
    this.readActivity(cx);
    // While the window is in front every few seconds; behind it, now and then (the person
    // may glance at it), so it's not stale when they come back.
    cx.timer.every(ACTIVITY_EVERY, (cx) => { if (window().active || ++this.idleTicks % 10 === 0) this.readActivity(cx); });
    this.idleTicks = 0;
  }

  flushRenderProfile(cx) {
    if (this.writingProfile) return;
    this.profileBatch ??= this.renderProfile.take();
    if (!this.profileBatch) return;
    this.writingProfile = true;
    cx.spawn(async () => {
      try {
        const result = await exec("python3", ["-I", `${appHome()}/mods/agents-plus/diagnostics.py`,
          "--app-home", appHome(), "--record-render", JSON.stringify(this.profileBatch)]);
        if (result.code !== 0) throw new Error("render profile writer failed");
        this.profileBatch = null;
      } catch {
        // Retain one bounded batch for retry; new measurements remain aggregated.
        console.error("agents-plus: render profile write failed; retry in 60s");
      } finally { this.writingProfile = false; }
    });
  }

  // For agents with news (working, waiting on the person, done), what they're doing now and
  // the first line of their last answer, from their own session records (activity.py next
  // to this file; it reads only what changed). Drawn again only when it changed.
  readActivity(cx) {
    if (this.readingActivity) return;
    const want = agents().filter((a) => a.status === "working" || a.status === "blocked" || a.status === "done").map((a) => ({ address: a.address }));
    if (!want.length) { if (Object.keys(this.activity).length) { this.activity = {}; cx.notify(); } return; }
    this.readingActivity = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("python3", ["-I", `${appHome()}/mods/agents-plus/activity.py`, JSON.stringify(want)]);
        if (r.code === 0 && r.stdout.trim() !== this.activityText) { this.activityText = r.stdout.trim(); this.activity = JSON.parse(this.activityText); this.share(); cx.notify(); }
      } catch {}
      this.readingActivity = false;
    });
  }

  // For other mods (⌘P's Agents view, picker-plus): shared("ag.info") = { address: { at (when
  // its state last changed, ms), doing, said } }, written only when it changed.
  share(snapshot) {
    const out = {};
    // Async updates/clicks read fresh values; a render passes its own snapshot.
    const now = snapshot?.now ?? Date.now();
    const acked = snapshot?.acked ?? shared(ACKED) ?? {};
    const duration = snapshot?.duration ?? seenFor();
    for (const [k, c] of Object.entries(this.changed ?? {})) out[k] = { at: c.at, ...(now - (this.seen?.[k] ?? 0) < duration ? { seen: this.seen[k] } : {}), ...(acked[k] ? { acked: acked[k] } : {}) };
    for (const [k, x] of Object.entries(this.activity ?? {})) out[k] = { ...(out[k] ?? {}), doing: x.doing ?? null, said: x.said ?? null };
    setIfChanged(AGENT_INFO, out, (this.sharedInfo ??= {}));
  }

  // The second line of a row with news: working, what it's doing; waiting, what it asks to
  // run; done, the first line of its answer. Idle rows have none (one line, as before).
  news(a, t) {
    const x = this.activity?.[a.address];
    if (!x) return null;
    if (a.status === "working" && x.doing) return { text: x.doing, color: t.muted, mark: "\u25b8" };
    if (a.status === "blocked") return x.doing && x.doing !== "Thinking\u2026" ? { text: x.doing, color: t.blocked, mark: "?" } : null;
    if (a.status === "done" && x.said) return { text: x.said, color: t.muted, mark: "\u2713" };
    return null;
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  // Also when a finished one was looked at: done, or working while in view, turning idle
  // starts Seen; working or needing you again ends it.
  track(list, now, snapshot) {
    let dirty = false;
    for (const a of list) {
      const was = this.raw.get(a.address);
      this.raw.set(a.address, a.status);
      if (was && was !== a.status) {
        if (a.status === "idle" && (was === "done" || was === "working")) { this.seen[a.address] = now; dirty = true; }
        else if (a.status !== "idle" && this.seen[a.address]) { delete this.seen[a.address]; dirty = true; }
      }
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    this.share(snapshot);
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
    for (const [k, at] of Object.entries(this.seen)) if (now - at > 24 * 3600000) delete this.seen[k]; // the longest seenMinutes
    localStorage.setItem("seen", JSON.stringify(this.seen));
  }

  // The state drawn: Herdr's, or Seen (lib/ui.js).
  shown(a, snapshot) {
    const acked = snapshot?.acked ?? shared(ACKED) ?? {};
    return shownStatus(a.status, { seen: this.seen?.[a.address], acked: acked[a.address] }, snapshot?.now, snapshot?.duration);
  }

  // Marks seen are kept only while the agent is still done (it worked again, or was looked at).
  dropAcks(list, acked = shared(ACKED) ?? {}) {
    const done = new Set(list.filter((a) => a.status === "done").map((a) => a.address));
    const kept = Object.fromEntries(Object.entries(acked).filter(([k]) => done.has(k)));
    if (Object.keys(kept).length !== Object.keys(acked).length) setShared(ACKED, kept);
    return kept;
  }

  // Keep offline pins until their terminal returns, and keep each pending until
  // core echoes the label so a failed write doesn't erase the old pin.
  migratePins(all) {
    const listed = new Map(all.filter((t) => t.state === "live").map((t) => [t.address, t]));
    const pending = this.pendingPins.filter((address) => {
      const terminal = listed.get(address);
      if (!terminal) return true;
      if (terminal.labels?.["herdr.pinned"]) return false;
      if (!this.migratingPins.has(address)) {
        this.migratingPins.add(address);
        run("terminal.pin", { terminal: address, pinned: true });
      }
      return true;
    });
    if (pending.length === this.pendingPins.length) return;
    this.pendingPins = pending;
    if (pending.length) localStorage.setItem("pins", JSON.stringify(pending));
    else localStorage.removeItem("pins");
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  // Looking at a done agent makes it idle; it stays with Done until you leave
  // it rather than drop away under you. Any other change moves it at once.
  hold(list) {
    const cur = list.find((a) => a.focused);
    const same = cur && cur.address === this.held?.address;
    // Arriving, or any change but done turning idle, sets what it was.
    if (!same || cur.status !== "idle") this.held = cur ? { address: cur.address, rank: RANK[cur.status] ?? 0 } : null;
  }

  rank(a, snapshot) {
    const sawDone = a.address === this.held?.address && this.held.rank === RANK.done && a.status === "idle";
    if (sawDone) return RANK.done;
    return this.shown(a, snapshot) === "seen" ? SEEN_RANK : RANK[a.status] ?? 0;
  }

  sortMenu(t) {
    const on = sortOf().id;
    return v_flex()
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).child("Sort agents"))
      .children(SORTS.map((s) => h_flex()
        .id(`sort-${s.id}`)
        .h(31)
        .px(8)
        .gap(9)
        .rounded(7)
        .items_center()
        .text_color(t.foreground)
        .hover((el) => el.bg(t.hover))
        .on_click(() => {
          setShared("agents.sort", s.id);
          closeOverlay(props().overlay);
        })
        .child(svg(`mods/workspace-chrome/${s.icon}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(s.label))
        .when(s.id === on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))))
      // What rows show (lib/state.js's OPTIONS; hm option does the same).
      .child(div().mx(8).my(4).h(1).bg(t.border))
      .children([["agentsRepoNames", "Show repo names"], ["agentsNews", "Show what each is doing"], ["seen", "Seen (looked at, not answered)"]].map(([name, label]) =>
        h_flex().id(`opt-${name}`).h(31).px(8).gap(9).rounded(7).items_center().text_color(t.foreground)
          .hover((el) => el.bg(t.hover))
          .on_click((_e, cx) => { setOption(name, !option(name)); cx.notify(); })
          .child(div().flex_1().child(label))
          .when(option(name), (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))))
      // How long Seen lasts: a click goes to the next of these.
      .when(option("seen"), (el) => el.child(h_flex().id("opt-seen-minutes").h(31).px(8).gap(9).rounded(7).items_center().text_color(t.foreground)
        .hover((el) => el.bg(t.hover))
        .on_click((_e, cx) => { const steps = OPTION_DEFS.seenMinutes.steps; const i = steps.indexOf(option("seenMinutes")); setOption("seenMinutes", steps[(i + 1) % steps.length]); cx.notify(); })
        .child(div().flex_1().text_color(t.muted).child("Seen for"))
        .child(div().text_color(t.foreground).child(option("seenMinutes") % 60 ? `${option("seenMinutes")}m` : `${option("seenMinutes") / 60}h`))));
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  // Live sub-agents, depth first. The render indexes live terminals by parent once;
  // recursive visits must not scan the entire terminal list again at every depth.
  tree(children, addr, lead = []) {
    const kids = children.get(addr) ?? [];
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(children, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  subRow(t, s, shown, compact) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const pic = icon(k.program, 14, t.foreground);
    const on = k.address === shown;
    return h_flex()
      .id(`sub-${k.address}`)
      .pl(39)
      .pr(8)
      .rounded(8)
      .h(26)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(12.5)
      .when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => this.peek(k.address))
      .children(s.lines.map(l => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), el => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", el => el.border_b(1.5).rounded_bl(6))))
      .when(Boolean(pic), el => el.child(div().mr(8).child(pic)))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
      .child(this.status(t, { status: st }, compact));
  }

  // compact: a ! for blocked where a header already says "Needs you".
  // An agent's state: lib/ui.js's mark (the sidebar's and ⌘P's too); one needing you says so
  // in its pill where the row has room (not compact).
  status(t, a, compact = false, snapshot) {
    if (a.status === "blocked" && !compact) return statusPill(t, a.status);
    return statusMark(t, a.address ? this.shown(a, snapshot) : a.status) ?? div().size(7).mx(3).flex_none();
  }

  // The coding agents outside Herdr (outside.py), drawn again only when they changed.
  readOutside(cx) {
    if (this.readingOutside) return;
    this.readingOutside = true;
    if (props()?.mode === "overview") cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await exec("python3", ["-I", `${appHome()}/mods/agents-plus/outside.py`]);
        if (r.code !== 0) throw new Error("Outside agent lookup failed");
        const text = r.stdout.trim();
        const rows = JSON.parse(text);
        if (!Array.isArray(rows)) throw new Error("Invalid outside agent list");
        if (text !== this.outsideText) { this.outsideText = text; this.outside = rows; cx.notify(); }
        this.outsideError = null;
      } catch (error) { this.outsideError = String(error.message ?? error); }
      finally { this.readingOutside = false; if (props()?.mode === "overview") cx.notify(); }
    });
  }

  // One agent outside Herdr, laid out like Herdr's own rows: its icon (a little faded), its
  // worktree's name (or folder) and session title, the app it runs in, its state. Click:
  // that session in Herdr (see the header).
  outsideRow(x, t, paths, metadata) {
    // Paths are sorted once for this render, not flattened/sorted again for each row.
    const checkout = paths.find((p) => inside(x.cwd, p));
    const meta = checkout ? metadata[JSON.stringify([null, checkout])] ?? {} : {};
    const name = meta.name || (checkout ?? x.cwd).split("/").pop();
    // A Codex daemon owns several sessions in one PID; keep their UI identities apart.
    return h_flex().id(`out-${x.agent}-${x.session ?? x.pid}`).px(8).h(30).flex_none().rounded(8).items_center().gap(9).cursor_pointer()
      .hover((s) => s.bg(t.hover)).tooltip(`${x.title}\n${x.cwd}\nRunning in ${x.app}. Click to continue it in Herdr.`)
      .on_click(() => this.resume(x))
      .child(image(OUTSIDE_ICON[x.agent] ?? "icons/shell.svg").w(16).h(16).flex_none().opacity(0.6))
      .child(h_flex().flex_1().min_w(0).gap(5).items_center()
        .child(div().min_w(0).max_w(120).truncate().text_color(t.muted).child(name))
        .when(Boolean(x.title) && x.title !== name, (el) => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`\u00b7 ${x.title}`))))
      .child(div().flex_none().text_size(10.5).text_color(t.dim).child(x.app))
      .child(this.status(t, { status: x.status }, true));
  }

  // Continue an outside agent's session in Herdr. With the worktrees bundle shown
  // (spaces-plus in the layout), it decides where: a Herdr terminal already on it, else a
  // tab in that worktree's space. Without it, here: a tab in the space whose folder holds
  // the session's, else a new space there. Either way the other app's copy keeps running.
  resume(x) {
    const rec = { agent: x.agent, session: x.session, argv: x.argv, cwd: x.cwd, title: x.title };
    if (runs(layout(), "spaces-plus")) return run(`spaces-plus.resume@${JSON.stringify(rec)}`);
    if (!AGENTS[rec.agent]) return;
    const live = (shared(LIVE) ?? {})[rec.session];
    if (live) return run("pane.focus", { terminal: live });
    const ps = panes();
    const at = (s) => placeOf(s, ps) ?? "";
    const s = spaces().filter((s) => !s.machine && inside(rec.cwd, at(s))).sort((a, b) => at(b).length - at(a).length)[0];
    const name = rec.title ? rec.title.slice(0, 28) : undefined;
    if (s) { run("space.select", { id: s.id }); run("tab.new", { space: s.id, folder: rec.cwd, argv: resumeArgv(rec), ...(name ? { name } : {}) }); }
    else run("space.new", { folder: rec.cwd, argv: resumeArgv(rec) });
  }

  // A section's outside agents, after Herdr's own, the most recently changed first.
  outsideRows(g, t, paths, metadata) {
    return [...(g.outside ?? [])].sort((a, b) => b.updated - a.updated).map((x) => this.outsideRow(x, t, paths, metadata));
  }

  render(cx) {
    if (props()?.mode === "view-switch") return renderViewSwitch();
    if (props()?.sortMenu) return this.sortMenu(theme());
    if (props()?.mode === "overview") return renderAgentView(this);
    const profile = this.renderProfile ??= new RenderProfile();
    profile.begin();
    // No finally: a VM interruption may skip cleanup. A surviving instance records
    // an unfinished phase on its next render/timer, without guessing its duration.
    const result = this.renderAgents(cx, profile);
    profile.finish();
    return result;
  }

  renderAgents(cx, profile) {
    const t = theme();
    const collapsed = narrow();
    const sort = sortOf();
    let list = agents();
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const all = terminals();
    profile.counts({ agents: list.length, terminals: all.length, outside: this.outside.length,
      collapsed, sort: sort.id });
    profile.phase("state");
    const children = new Map();
    for (const terminal of all) {
      if (terminal.state !== "live") continue;
      if (!children.has(terminal.parent)) children.set(terminal.parent, []);
      children.get(terminal.parent).push(terminal);
    }
    // Urgency and visible rows use identical descendants in this render. Rebuild
    // next render so a child starting, finishing or changing parent appears at once.
    const descendants = new Map();
    const subsOf = (a) => {
      if (!descendants.has(a.address)) descendants.set(a.address, this.tree(children, a.address));
      return descendants.get(a.address);
    };
    this.migratePins(all);
    const shown = focused()?.agent;
    const now = Date.now();
    const options = shared(OPTIONS) ?? {};
    const snapshot = { now, acked: shared(ACKED) ?? {}, duration: seenFor(options) };
    const showNews = option("agentsNews", options);
    const showRepos = option("agentsRepoNames", options);
    const colors = !collapsed && showRepos ? { repos: shared(REPO_COLORS) ?? {}, spaces: shared("space.colors") ?? {} } : null;
    this.track(list, now, snapshot);
    // Do not keep pre-cleanup ack values in this render (or across later renders).
    snapshot.acked = this.dropAcks(list, snapshot.acked);
    this.hold(list);
    profile.phase("ordering");
    const byPriority = sort.id === "priority";
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a, snapshot), ...subsOf(a).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
    const rankOf = (a) => urgency.get(a.address);
    if (byPriority) list = [...list].sort((x, y) => rankOf(y) - rankOf(x) || this.since(y) - this.since(x) || y.seq - x.seq);
    const pinned = list.filter((a) => a.pinned);
    const rest = list.filter((a) => !a.pinned);
    list = [...pinned, ...rest];
    setAgentOrder(list.map((a) => a.address));
    profile.phase("labels");

    const withKids = (a, i) => {
      const subs = collapsed ? [] : subsOf(a);
      const r = row(a, i, subs);
      if (this.folded.has(a.address)) return [r];
      return [r, ...subs.map((s) => this.subRow(t, s, shown, byPriority))];
    };

    // The fold chevron; folded, the count too, colored by the most urgent one.
    const fold = (a, subs) => {
      const sts = subs.map((s) => kidStatus(s.t, this.listed));
      const top = sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
      const open = !this.folded.has(a.address);
      return div()
        .id(`fold-${a.address}`)
        .h(18)
        .px(3)
        .gap(3)
        .flex()
        .items_center()
        .rounded(4)
        .text_size(11)
        .text_color(open ? t.dim : (t[top] ?? t.dim))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          open ? this.folded.add(a.address) : this.folded.delete(a.address);
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
        .when(!open, (el) => el.child(String(subs.length)));
    };

    // A row reads "space \u00b7 detail": the detail is a tab someone named or the
    // agent's own title, never an automatic tab number unless two rows would
    // otherwise read the same.
    // Host reads copy their data. Take one snapshot per render, then index it locally.
    // These maps live only for this render; the next render sees changed paths/names/tabs.
    const tabs = new Map(spaces().flatMap(s => s.tabs).map(tab => [tab.id, tab]));
    const paneList = panes();
    const labels = new Map(list.map(a => {
      const tab = tabs.get(a.tab);
      return [a.address, tab ? title(tab, lead(tab, paneList)) : a.title || a.program?.name || ""];
    }));
    const label = (a) => labels.get(a.address);
    const repos = new Map();
    const paths = [];
    for (const [key, r] of Object.entries(shared(TREES) ?? {})) {
      const cs = r.checkouts ?? [];
      const anchor = (cs.find(c => c.main && c.space) ?? cs.find(c => c.space))?.space;
      for (const c of cs) {
        if (typeof c.path === "string") paths.push(c.path);
        if (!repos.has(c.space)) repos.set(c.space, { key, name: r.name, branch: c.branch ?? "detached", anchor: anchor ?? c.space });
      }
    }
    paths.sort((a, b) => b.length - a.length);
    const metadata = !collapsed && this.outside.length ? shared(META) ?? {} : {};
    const detail = new Map(list.map(a => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]));
    const seen = {};
    for (const a of list) { const k = `${a.space_name}\u0000${detail.get(a.address) ?? ""}`; seen[k] = (seen[k] ?? 0) + 1; }
    for (const a of list) {
      if (detail.get(a.address) == null && seen[`${a.space_name}\u0000`] > 1) detail.set(a.address, label(a));
    }

    // Rows that would read the same name get their repo and branch too.
    const named = {};
    for (const a of list) named[a.space_name] = (named[a.space_name] ?? 0) + 1;
    const row = (a, i, subs = []) => {
      const pic = icon(a.program, 16, t.foreground);
      const news = showNews ? this.news(a, t) : null;
      const repo = repos.get(a.space);
      const at = repo ? `${repo.name} \u00b7 ${repo.branch}` : null;
      const more = detail.get(a.address);
      // Its repo as a tag in the repo's sidebar color, so many agents still read at a glance
      // (not when its name already says it: a repo's primary checkout).
      const tag = showRepos && repo && repo.name !== a.space_name ? repo : null;
      // An agent on another machine (`vps/t7`) says which.
      const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
      if (collapsed) {
        return h_flex()
          .id(`ag-${a.address}`)
          .h(26)
          .px(8)
          .flex_none()
          .items_center()
          .gap(4)
          .hover((s) => s.bg(t.hover))
          .on_click(() => run("pane.focus", { pane: a.pane }))
          .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().text_color(t.muted).child(String(i + 1)))
          .child(h_flex().w(14).flex_none().items_center().justify_center().child(this.status(t, a, true, snapshot)));
      }
      const when = this.since(a);
      const idle = a.status === "idle" && !a.focused && this.shown(a, snapshot) !== "seen";
      const isPinned = a.pinned;
      const pin = div()
        .id(`pin-${a.address}`)
        .flex_none()
        .p(2)
        .rounded(4)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(isPinned ? "Unpin" : "Pin to the top")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          run("terminal.pin", { terminal: a.address, pinned: !isPinned });
          // The row moves away from under the pointer, and no hover-out comes.
          this.hovered = null;
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${isPinned ? "pin-off" : "pin"}.svg`).size(13));
      // Under a space header the space goes without saying; an automatic tab number says nothing.
      // Without a space header above (priority, pinned) the row names its space.
      const full = byPriority || isPinned;
      const name = full ? a.space_name || label(a) : more ?? (/^\d+$/.test(label(a)) ? a.program?.name || label(a) : label(a));
      return h_flex()
        .id(`ag-${a.address}`)
        .px(8)
        .h(news ? 42 : 30)
        .when(Boolean(at || news), (el) => el.tooltip([at, news?.text].filter(Boolean).join("\n")))
        .flex_none()
        .rounded(8)
        .items_center()
        .gap(9)
        .when(a.focused, (el) => el.bg(t.selected))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_hover((on, cx) => {
          if (on) this.hovered = a.address;
          else if (this.hovered === a.address) this.hovered = null;
          cx.notify();
        })
        .on_click(() => run("pane.focus", { pane: a.pane }))
        .when(Boolean(pic), el => el.child(div().id(`agent-fold-${a.address}`)
          .when(subs.length > 0, el => el.on_click((_e, cx) => {
            cx.stop_propagation();
            this.folded.has(a.address) ? this.folded.delete(a.address) : this.folded.add(a.address);
            cx.notify();
          })).child(pic)))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(h_flex().min_w(0).gap(5).items_center()
            .when(Boolean(tag), (el) => el.child(repoTag(t, tag, 90, colors)))
            .child(div().min_w(0).max_w(full && more ? 120 : 200).truncate().text_color(idle ? t.muted : t.foreground).child(name))
            .when(full && Boolean(more), el => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`\u00b7 ${more}`)))
            .when(Boolean(at) && named[a.space_name] > 1, el => el.child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(`\u00b7 ${tag ? tag.branch : at}`))))
          .when(Boolean(news), el => el.child(h_flex().min_w(0).gap(5).items_center().text_size(11)
            .child(div().flex_none().text_color(news.color).child(news.mark))
            .child(div().flex_1().min_w(0).truncate().text_color(news.color).child(news.text)))))
        .when(Boolean(machine), el => el.child(div().text_size(10).text_color(t.dim).child(machine)))
        .when(subs.length > 0, el => el.child(fold(a, subs)))
        .when(this.hovered === a.address && this.shown(a, snapshot) === "done", el => el.child(div().id(`ack-${a.address}`).flex_none().p(2).rounded(4).text_color(t.dim).cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Mark as seen, without opening it")
          .on_click((_e, cx) => { cx.stop_propagation(); ackDone([a.address]); this.share(); cx.notify(); })
          .child(svg("mods/workspace-chrome/check.svg").size(13))))
        .when(this.hovered === a.address, el => el.child(pin))
        .when(this.hovered !== a.address && Boolean(when), el => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - when))))
        .child(this.status(t, a, byPriority && !isPinned, snapshot));
    };

    // Groups in list order: spaces (grouped) or priority sections. Agents of a
    // space are next to each other in agents(), so neighbours make a group.
    profile.counts({ panes: paneList.length, checkouts: paths.length });
    profile.phase("groups");
    const groups = pinned.length ? [{ id: "pinned", label: "Pinned", status: null, members: pinned }] : [];
    // By priority, "Active" comes next: the agents in the tab being looked at. They stay
    // there whatever their state (a finished one doesn't drop to Idle at the bottom while
    // it's in view) and go back to their state's section once another tab is shown.
    const viewing = byPriority && !collapsed ? focused()?.tab : null;
    const active = viewing ? rest.filter((a) => a.tab === viewing) : [];
    if (active.length) groups.push({ id: "active", label: "Active", status: null, color: t.accent, members: active });
    for (const a of rest) {
      if (active.includes(a)) continue;
      const r = rankOf(a) || RANK.idle;
      const id = byPriority ? `sec-${r}` : `sp-${a.space}`;
      if (groups.at(-1)?.id === id) groups.at(-1).members.push(a);
      else groups.push({ id, label: byPriority ? SECTION[r] : a.space_name || "", status: byPriority ? SECTION_STATUS[r] : null, members: [a] });
    }

    // The agents outside Herdr join the groups: by priority, the section of their state
    // (made if Herdr has none in it); grouped by space, an "Outside Herdr" group at the end.
    if (!collapsed && this.outside.length) {
      if (byPriority) {
        for (const x of this.outside) {
          const r = RANK[x.status] ?? RANK.idle;
          let g = groups.find((g) => g.id === `sec-${r}`);
          if (!g) {
            g = { id: `sec-${r}`, label: SECTION[r], status: SECTION_STATUS[r], members: [] };
            const at = groups.findIndex((h) => h.id.startsWith("sec-") && Number(h.id.slice(4)) < r);
            at < 0 ? groups.push(g) : groups.splice(at, 0, g);
          }
          (g.outside ??= []).push(x);
        }
      } else groups.push({ id: "outside", label: "Outside Herdr", status: null, members: [], outside: this.outside });
    }

    // A group's header; it folds the group. Folded, it says how many and the most urgent state.
    const header = (g) => {
      const open = !this.folded.has(g.id);
      const top = g.members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      return h_flex()
        .id(g.id)
        .px(8)
        .pt(8)
        .h(30)
        .flex_none()
        .gap(6)
        .items_center()
        .text_size(11)
        .font_medium()
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          open ? this.folded.add(g.id) : this.folded.delete(g.id);
          cx.notify();
        })
        .child(div().truncate().text_color(g.color ?? statusColor(t, g.status) ?? t.dim).child(g.label))
        // Done: all of them seen at once, without opening each (state.js's ackDone).
        .when(g.status === "done" && g.members.length > 0, (el) => el.child(div().id(`ack-all-${g.id}`).ml(6).px(5).rounded(4).text_size(10.5).text_color(t.dim).cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Mark them all seen, without opening them")
          .on_click((_e, cx) => { cx.stop_propagation(); ackDone(g.members.map((m) => m.address)); this.share(); cx.notify(); })
          .child("Mark all seen")))
        .when(byPriority || !open, (el) => el.child(div().text_color(t.dim).child(String(g.members.length + (g.outside?.length ?? 0)))))
        .child(div().flex_1())
        .when(!open, (el) => el
          .when(!byPriority && top && top !== "idle", (el) => el.child(this.status(t, { status: top }, true)))
          .child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
    };
    // The order shown, for ⌘P's Agents view (picker-plus): shared("ag.order") = addresses,
    // written when it changes, so the two lists read alike.
    const order = collapsed ? list.map((a) => a.address) : groups.flatMap((g) => g.members.map((a) => a.address));
    setIfChanged(AGENT_ORDER, order, (this.sharedOrder ??= {}));
    profile.phase("rows");
    const rows = collapsed
      ? list.flatMap(withKids)
      : groups.flatMap((g) => [header(g), ...(this.folded.has(g.id) ? [] : [...g.members.flatMap(withKids), ...this.outsideRows(g, t, paths, metadata)])]);

    profile.counts({ groups: groups.length, rows: rows.length });
    profile.phase("container");
    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      .when(!collapsed, (el) =>
        el.child(
          h_flex()
            .px(16)
            .h(41)
            .pt(14)
            .pb(5)
            .flex_none()
            .items_center()
            .justify_between()
            .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Agents"))
            .child(h_flex().id("ag-view").gap(4).items_center().px(7).py(3).rounded(5).text_size(11).text_color(t.muted).cursor_pointer()
              .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("All agents across every project")
              .on_click(() => openAgentView(this.outside)).child(svg("mods/workspace-chrome/layers.svg").size(12)).child("Agent view"))
            .child(
              div()
                .id("ag-sort")
                .text_size(11)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(() => openOverlay({ mod: "agents-plus", kind: "popup", width: 240, height: 290, props: { sortMenu: true } }))
                .tooltip(`Sort agents: ${sort.label}`)
                .child(svg(`mods/workspace-chrome/${sort.icon}.svg`).size(14)),
            ),
        ),
      )
      .when(list.length === 0 && !this.outside.length && !collapsed, (el) =>
        el.child(div().px(12).text_size(12).text_color(t.dim).child("No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.")),
      )
      .child(v_flex().id("ag-list").flex_1().min_h(0).px(collapsed ? 0 : 8).overflow_y_scrollbar().mode("always").children(rows))
      .when(collapsed, (el) =>
        el.child(
          h_flex()
            .h(28)
            .items_center()
            .justify_center()
            .child(div().id("ag-view-rail").px(5).text_size(13).text_color(t.dim).cursor_pointer()
              .hover((s) => s.text_color(t.foreground)).tooltip("Open Agent view")
              .on_click(() => openAgentView(this.outside)).child(svg("mods/workspace-chrome/layers.svg").size(14)))
            .child(
              div()
                .id("collapse")
                .text_size(13)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(toggleSidebar)
                .child("»"),
            ),
        ),
      );
  }
}
