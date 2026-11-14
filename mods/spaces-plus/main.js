// Workspace spaces: stable colored avatars, worktrees under their checkout,
// grouped by machine when more than one is known. After a space's name, the repo
// its first terminal is in now, only where unusual: branch, ahead/behind. Agent state lives in the agents list, not here. Click to
// switch, right-click for its menu, drag to reorder.
//
// spaces-plus (herdr-mods): a clone of the shipped `spaces`, grouped as Orca's projects:
// a repo's header, its primary checkout, then every worktree of it (`git worktree list`:
// Herdr's, Claude Code's, any tool's; one not open is dimmed and opens on a click), each
// with its terminals under it, all foldable. Badges (PR state and checks from gh, link,
// ports, comment), sort, Sleep, a worktree removed outside Herdr closing its space, the
// header's Add project / New terminal / New worktree buttons, a repo header's Sessions /
// Clean up / + (worktree-plus's New worktree), drag with a preview, and commands for
// agents (hm). Why each and what Herdr does itself: WHY.md beside this file.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, machines, panes, focused, run, openOverlay, exec, hc, theme, shared, setShared, watchFolder, window, layout, nextCommand, agents, appHome, readTextFile, notify, home, settings } from "herdr";
// How sessions are found and resumed: lib/resume.js in the repo, copied here by install.sh.
import { AGENTS, agentKind, resumeArgv, sessionOf } from "./resume.js";
import { createWorktree, removeWorktree, cleanupCandidates, repoOf as repoAt, git as gitIn } from "./worktree.js";
import { META, TREES, SLEEP, SORT, LIVE, SEEN, LINK_TEMPLATE, AGENT_INFO, REPO_COLORS, OPTION_DEFS, option, setOption, setRepoColor, resetRepoColors, ackDone, metaKey, metaOf, dropMeta, answer } from "./state.js";
import { statusMark, shownStatus, spaceFill, REPO_PALETTE, ago } from "./ui.js";
import { cloneRepo, createProject } from "./project.js";
import { openDoc, noteOpened } from "./docs.js";

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

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const rowHeight = ({ tree }) => (tree ? 28 : 30);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;
const LOC_EVERY = 10 * 60000; // how long a folder's checkout and repo (rev-parse) are taken as known
const TREES_FRESH = 3000; // a repo's worktree list read this recently is still the one

// A repo's checkouts from `git worktree list --porcelain`: { path, branch, main },
// the main checkout first. Bare and prunable (folder gone) ones are left out.
function worktrees(stdout) {
  const out = [];
  for (const [n, block] of stdout.split(/\n\n+/).entries()) {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
    if (!path || lines.some((l) => l === "bare" || l.startsWith("prunable"))) continue;
    const branch = lines.find((l) => l.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? null;
    out.push({ path, branch, main: n === 0 });
  }
  return out;
}

// What's known about each checkout, keyed by metaKey(machine, path): { name, branch,
// base, link, pr: { number, url, title, state }, comment, status, pinned, unread,
// archived, ... }. worktree-plus writes it when it makes one; wt-menu edits it.
const PR_EVERY = 5 * 60000; // how often a repo's pull requests are asked of gh
const PR_WORD = { OPEN: "open", MERGED: "merged", CLOSED: "closed without merging" };
function clearUnread(on, path) {
  const all = shared(META) ?? {};
  const k = metaKey(on, path);
  if (all[k]?.unread) setShared(META, { ...all, [k]: { ...all[k], unread: false } });
}
// A link as short text: a URL's last part (…/browse/TAXTEAM-1446, …/issues/12 → #12).
function shortLink(link) {
  const m = String(link).match(/^https?:\/\/[^/]+\/(.*?)\/?(?:[?#].*)?$/);
  if (!m) return link;
  const parts = m[1].split("/");
  const last = parts.pop() || "";
  return /^\d+$/.test(last) ? `#${last}` : last;
}
// How far each level of the tree (repo, worktree, terminal) sits in from the one above.
const INDENT = 16;
// Where the indent guides run, from a row's left edge: under a header's avatar (8 + 16/2)
// and under a nested row's icon (8 + 22 + 13/2).
const GUIDE = [16, 36];
// Where a worktree's link points, for the browser: the link itself when it's a URL (any
// tracker: no service is assumed), else what the person's own template makes of a bare
// key (shared "wt.linkTemplate", e.g. "https://tracker.example/browse/{key}"; unset by
// default), else nothing (the badge stays text).
function linkUrl(link) {
  if (!link) return null;
  if (/^https?:\/\//i.test(link)) return link;
  const tpl = shared(LINK_TEMPLATE);
  return typeof tpl === "string" && tpl.includes("{key}") ? tpl.replace("{key}", encodeURIComponent(link.trim())) : null;
}

// Worktrees put to sleep (wt-menu's Sleep, as Orca's): their terminals closed to free memory,
// their agents' sessions kept to resume on waking. shared "wt.sleep" = { metaKey(machine,
// path): { at, sessions: [{ agent, session, argv, cwd, title }] } }.
// How a repo's worktrees are ordered under it (shared "wt.sort", picked from the Spaces
// title's button), pinned ones first whatever the order:
// - activity (default, Orca's "Agent activity"): what needs you first: blocked, then done
//   while you weren't looking, then working, idle, open with no agent, not open; within a
//   step the most recently changed first;
// - recent: most recently changed first; name: by name; created: the order they were made.
export const SORTS = [["activity", "Agent activity"], ["recent", "Recent"], ["name", "Name"], ["created", "Created"]];
const RANK = { blocked: 1, done: 2, working: 3, idle: 4 };
const rankOf = (k) => (k.ghost ? 6 : RANK[k.w.status] ?? 5);
// When something in it last changed: its tabs' latest change, else when it was made.
const changedAt = (k) => (k.ghost ? 0 : Math.max(0, ...(k.w.tabs ?? []).map((tab) => tab.changed_at ?? tab.working_since ?? 0))) || k.meta?.created || 0;
const nameOf = (k) => (k.meta?.name || (k.ghost ? base(k.ghost.path) : k.w.name)).toLowerCase();
function order(list, by) {
  const cmp = {
    activity: (a, b) => rankOf(a) - rankOf(b) || changedAt(b) - changedAt(a),
    recent: (a, b) => changedAt(b) - changedAt(a) || rankOf(a) - rankOf(b),
    name: (a, b) => nameOf(a).localeCompare(nameOf(b)),
    created: () => 0,
  }[by] ?? (() => 0);
  return list.map((k, i) => [k, i]).sort(([a, i], [b, j]) => Number(Boolean(b.meta.pinned)) - Number(Boolean(a.meta.pinned)) || cmp(a, b) || i - j).map(([k]) => k);
}

// Orca's board statuses as a word on the row; in progress (the usual) says nothing.
const STATUS_TAG = { todo: "todo", "in-review": "review", completed: "done" };

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

export default class Spaces extends View {
  init(_props, cx) {
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked, top }, null: not a repo
    this.trees = {}; // repo (git[].repo) -> its checkouts, see worktrees()
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.locs = {}; // where() -> { top, repo, at }: where that folder's checkout and repo are (see check)
    this.treesAt = {}; // repo -> when its worktree list was read
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Set(); // local repos' git folders
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null; // the space index pressed on (a drag's source), see draggable
    this.over = null; // the top-level item the pointer is over while dragging
    this.dragging = false;
    this.dragAt = null; // the pointer in the sidebar while dragging
    this.hovered = null; // space whose row the pointer is on: it shows the New worktree +
    this.showArchived = new Set(JSON.parse(localStorage.getItem("wt.showArchived") ?? "[]")); // repos whose archived worktrees show
    this.foldedRepos = new Set(JSON.parse(localStorage.getItem("wt.folded") ?? "[]")); // repos folded away: their terminals and worktrees
    // A space's terminals show while it's the shown one and fold when it's left. A press of
    // its fold button overrides that ("open" | "closed") until the space is entered or left.
    this.spaceFolds = JSON.parse(localStorage.getItem("wt.spaceFolds") ?? "{}");
    this.autoOpened = new Set(); // folded repos unfolded only because a space in them was entered
    this.defaults = {}; // repo -> its default branch (origin/HEAD without the remote), null: none
    this.lastActive = spaces().find((s) => s.active)?.id ?? null; // see reveal()
    this.waking = {}; // path -> { machine, rest, since }: sessions to resume in tabs once its space shows
    this.ports = {}; // checkout path -> [{ port, cmd }]: what's listening from inside it (see readPorts)
    this.readPorts(cx);
    cx.timer.every(10000, (cx) => { if (window().active) this.readPorts(cx); });
    // Pull requests per repo, from gh (see refreshPrs); the last answer kept for a start.
    try { this.prs = JSON.parse(localStorage.getItem("wt.prCache") ?? "{}") ?? {}; } catch { this.prs = {}; }
    cx.timer.after(4000, (cx) => this.refreshPrs(cx));
    cx.timer.every(60000, (cx) => { if (window().active) this.refreshPrs(cx); });
    // What git said last time (saved after every look): the list draws its groups at once
    // on a reload or a start, instead of a flat list for the seconds git takes, then
    // looks again (nothing is marked checked, so every place is due at the first tick).
    try {
      const cache = JSON.parse(localStorage.getItem("wt.gitCache") ?? "null");
      if (cache) Object.assign(this, { git: cache.git ?? {}, trees: cache.trees ?? {}, defaults: cache.defaults ?? {} });
    } catch {}
    this.machines = [];
    this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
    for (const state of Object.values(this.reconnecting)) state.busy = false;
    this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    this.refreshMachines(cx);
    this.listen(cx);
    this.checkUpstream(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // `git status` walks the whole tree, on another machine a process there:
    // only when its answer could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
  }

  checkNew(cx) {
    const now = Date.now();
    for (const [path, wk] of Object.entries(this.waking)) {
      const s = spaces().find((x) => (x.machine ?? null) === (wk.machine ?? null) && (place(x, panes()) === path || place(x, panes())?.startsWith(`${path}/`)));
      if (s) for (const rec of wk.rest) run("tab.new", { space: s.id, folder: rec.cwd, argv: resumeArgv(rec), ...(rec.title ? { name: rec.title.slice(0, 28) } : {}) });
      if (s || now - wk.since > 20000) delete this.waking[path];
    }
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id))) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  reconnect(machine, cx) {
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
    cx.notify();
    cx.spawn(async cx => {
      try {
        const ask = async args => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) {
            let error;
            try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch {}
            throw new Error(error || r.stderr || r.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        this.folded.delete(name);
        localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
      this.refreshMachines(cx);
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        for (const key of keys) await this.check(key, cx);
      }
      try { localStorage.setItem("wt.gitCache", JSON.stringify({ git: this.git, trees: this.trees, defaults: this.defaults })); } catch {}
      this.publish();
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo, and the repo's checkouts.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // No optional locks: a status that touched the index would wake the watch again.
      // Writes nothing under .git (index lock, fsmonitor cookie): watch() would wake on it.
      const r = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v2", "--branch"], { cwd, on });
      if (r.code !== 0) {
        delete this.locs[key];
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it. Where a folder
      // sits doesn't change, so it's asked once (again after LOC_EVERY, or once its status
      // failed) instead of on every look: two git runs fewer per place.
      let loc = this.locs[key];
      if (!loc || Date.now() - loc.at > LOC_EVERY) {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on });
        loc = this.locs[key] = { top: top.stdout.trim(), repo: common.stdout.trim(), at: Date.now() };
      }
      const repo = loc.repo;
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const info = { name, branch: null, ahead: 0, behind: 0, repo: JSON.stringify([on, repo]), linked: repo !== `${loc.top}/.git`, top: loc.top };
      // The repo's checkouts. `git worktree add`/`remove` change the watched git
      // folder (its worktrees/), so a new one is seen without waiting for the fallback.
      if (!(info.repo in this.defaults)) {
        // The full ref, not --short (see lib/worktree.js's refName), without refs/remotes/<remote>/.
        const d = await exec("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], { cwd, on });
        this.defaults[info.repo] = d.code === 0 ? d.stdout.trim().replace(/^refs\/remotes\/[^/]+\//, "") : null;
      }
      // Once per repo in a round of looks (its places are looked at one after another).
      if (Date.now() - (this.treesAt[info.repo] ?? 0) > TREES_FRESH) {
        const list = await exec("git", ["worktree", "list", "--porcelain"], { cwd, on });
        if (list.code === 0) { this.trees[info.repo] = worktrees(list.stdout); this.treesAt[info.repo] = Date.now(); }
      }
      for (const line of r.stdout.split("\n")) {
        if (line.startsWith("# branch.head ")) info.branch = line.slice(14);
        else if (line.startsWith("# branch.ab ")) {
          const [a, b] = line.slice(12).split(" ");
          info.ahead = Math.abs(parseInt(a, 10)) || 0;
          info.behind = Math.abs(parseInt(b, 10)) || 0;
        }
      }
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // A worktree whose folder is gone was removed outside Herdr (git, an agent, Claude
      // Code's own worktree cleanup): not a machine away. See vanished.
      if (!on && this.git[key]?.linked && !(await exec("test", ["-d", cwd]).then((r) => r.code === 0, () => false))) return this.vanished(key);
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  // A worktree removed outside Herdr: its spaces close, as Remove closes them, without a
  // toast (whoever removed it, an agent as a rule, says so), and its sidebar entry (META) goes. A space where an agent is still working or
  // waiting on the person stays until it's done (its row says "removed"; the pane's going
  // idle or the fallback look brings this back).
  vanished(key) {
    const g = { ...this.git[key], gone: true };
    this.git[key] = g;
    this.unsure.add(key);
    const ps = panes();
    for (const s of spaces().filter((x) => !x.machine && where(x, ps) === key)) {
      const tabs = new Set((s.tabs ?? []).map((tab) => tab.id));
      if (ps.some((p) => tabs.has(p.tab) && (p.status === "working" || p.status === "blocked"))) continue;
      // Quietly: whoever removed it (an agent, as a rule) says so; the row just goes.
      run("space.close", { id: s.id, confirmed: true });
    }
    dropMeta(metaKey(null, g.top));
  }

  // Herdr rewrites its shipped mods on every start. When the ones the herdr-mods clones
  // come from (spaces, worktree, picker) differ from what the clones were last merged with
  // (upstream/versions.json in the repo this was installed from, named by .herdr-mods), say
  // so once per change, with a Claude tab there that runs scripts/sync-upstream.sh, settles
  // any conflicts and checks whether Herdr now does natively what a clone adds.
  checkUpstream(cx) {
    cx.spawn(async () => {
      try {
        const repo = (await readTextFile(`${appHome()}/mods/spaces-plus/.herdr-mods`))?.trim();
        const shipped = JSON.parse((await readTextFile(`${appHome()}/installed.json`)) ?? "{}");
        const merged = JSON.parse((await readTextFile(`${repo}/upstream/versions.json`)) ?? "null")?.mods;
        if (!repo || !merged) return;
        const changed = Object.keys(merged).filter((b) => JSON.stringify(shipped[b]) !== JSON.stringify(merged[b]));
        const seen = changed.map((b) => `${b}:${JSON.stringify(shipped[b])}`).join("|");
        if (!changed.length || localStorage.getItem("upstream.seen") === seen) return;
        localStorage.setItem("upstream.seen", seen);
        notify({
          title: `Herdr updated ${changed.join(", ")}`,
          body: "Your clones don't have those changes yet. Click to have Claude merge them in.",
          level: "info",
          action: { name: "tab.new", args: { folder: repo, name: "upstream sync", argv: ["claude", `Herdr 기본 mod(${changed.join(", ")})가 업데이트됐어. scripts/sync-upstream.sh 를 실행해서 우리 복제본에 합치고, 충돌이 있으면 해결해줘. 그리고 upstream-changes/*.diff 를 보고 Herdr가 이제 우리 복제본이 더한 기능을 기본으로 지원하는지 검토해서, 그렇다면 우리 쪽을 걷어낼지 알려줘.`] } },
        });
      } catch {}
    });
  }

  // Live ports, as Orca shows them: the TCP ports programs listen on (ports.py, lsof), each
  // on the checkout its program runs in (the deepest one holding its folder; this computer's
  // checkouts only). Draws again only when that changed.
  readPorts(cx) {
    cx.spawn(async (cx) => {
      try {
        const r = await exec("python3", ["-I", `${appHome()}/mods/spaces-plus/ports.py`]);
        if (r.code !== 0) return;
        const paths = Object.entries(this.trees).filter(([repo]) => JSON.parse(repo)[0] === null).flatMap(([, cs]) => cs.map((c) => c.path));
        const out = {};
        for (const x of JSON.parse(r.stdout)) {
          const at = paths.filter((p) => x.cwd === p || x.cwd.startsWith(`${p}/`)).sort((a, b) => b.length - a.length)[0];
          if (at && !(out[at] ??= []).some((y) => y.port === x.port)) out[at].push({ port: x.port, cmd: x.cmd });
        }
        const text = JSON.stringify(out);
        if (text !== this.portsText) { this.portsText = text; this.ports = out; cx.notify(); }
      } catch {}
    });
  }

  // My pull requests in each repo a space is in (this computer's), from `gh pr list`, at most
  // every PR_EVERY and one repo at a time: { [repo]: { at, byBranch: { [branch]: { number,
  // state: OPEN | MERGED | CLOSED, draft, url, title, checks: pass | fail | pending | null } } } }.
  // Without gh, or a repo gh doesn't know, there's nothing and the badges keep what wt.meta says.
  refreshPrs(cx) {
    if (this.prBusy) return;
    const due = Object.entries(this.trees)
      .filter(([repo]) => !JSON.parse(repo)[0] && Object.values(this.git).some((g) => g?.repo === repo))
      .filter(([repo]) => Date.now() - (this.prs[repo]?.at ?? 0) > PR_EVERY);
    if (!due.length) return;
    this.prBusy = true;
    cx.spawn(async (cx) => {
      for (const [repo, checkouts] of due) {
        const main = checkouts.find((c) => c.main)?.path;
        if (!main) continue;
        const r = await exec("gh", ["pr", "list", "--state", "all", "--author", "@me", "--limit", "60", "--json", "number,headRefName,state,isDraft,url,title,statusCheckRollup"], { cwd: main }).catch(() => null);
        if (r?.code !== 0) { this.prs[repo] = { at: Date.now(), byBranch: this.prs[repo]?.byBranch ?? {} }; continue; }
        const byBranch = {};
        let list = [];
        try { list = JSON.parse(r.stdout); } catch {}
        // Per branch: the open one, else the newest.
        for (const p of list.sort((a, b) => a.number - b.number)) {
          const old = byBranch[p.headRefName];
          if (old?.state === "OPEN" && p.state !== "OPEN") continue;
          const runs = p.statusCheckRollup ?? [];
          const checks = !runs.length ? null
            : runs.some((c) => /FAILURE|ERROR|CANCELLED|TIMED_OUT|ACTION_REQUIRED/.test(`${c.conclusion ?? ""}${c.state ?? ""}`)) ? "fail"
            : runs.some((c) => !c.conclusion && /PENDING|QUEUED|IN_PROGRESS|EXPECTED|WAITING/.test(`${c.status ?? ""}${c.state ?? ""}`)) ? "pending" : "pass";
          byBranch[p.headRefName] = { number: p.number, state: p.state, draft: Boolean(p.isDraft), url: p.url, title: p.title, checks };
        }
        this.prs[repo] = { at: Date.now(), byBranch };
        cx.notify();
      }
      try { localStorage.setItem("wt.prCache", JSON.stringify(this.prs)); } catch {}
      this.prBusy = false;
      cx.notify();
    });
  }

  // A checkout's pull request: what gh says for its branch, else what wt.meta keeps.
  prFor(repo, branch, meta) {
    return (branch && this.prs[repo]?.byBranch?.[branch]) || meta?.pr || null;
  }

  // When each space was last shown, for ⌘P's Recent order (picker-plus): shared("wt.seen")
  // = { space id: ms }, written when the shown space changes, gone spaces dropped.
  markSeen() {
    const id = focused()?.space;
    if (!id || id === this.seenSpace) return;
    this.seenSpace = id;
    const ids = new Set(spaces().map((s) => s.id));
    const kept = Object.fromEntries(Object.entries(shared(SEEN) ?? {}).filter(([k]) => ids.has(k)));
    setShared(SEEN, { ...kept, [id]: Date.now() });
  }

  // The checkouts of every repo a space is in (as the list shows them), for other mods and
  // agents (picker-plus searches them; `hm ls` lists them): shared("wt.trees") = { repo:
  // { name, machine, checkouts: [{ path, branch, main, space (the id showing it, or null),
  // sleeping }] } }. Set only when it changed, since a shared value makes every mod draw
  // again; render calls it, so spaces opening and closing show up too.
  publish() {
    const out = {};
    const ps = panes();
    const at = new Map(spaces().map((s) => [s, this.git[where(s, ps)]]));
    const asleep = shared(SLEEP) ?? {};
    for (const g of at.values()) {
      if (!g || out[g.repo] || !this.trees[g.repo]) continue;
      const [machine] = JSON.parse(g.repo);
      const showing = (path) => [...at].find(([s, x]) => (s.machine ?? null) === machine && x?.top === path)?.[0].id ?? null;
      out[g.repo] = { name: g.name, machine, checkouts: this.trees[g.repo].map((c) => ({ ...c, space: showing(c.path), sleeping: Boolean(asleep[metaKey(machine, c.path)]), pr: this.prs[g.repo]?.byBranch?.[c.branch] ?? null })) };
    }
    const text = JSON.stringify(out);
    if (text !== this.published) { this.published = text; setShared(TREES, out); }
    this.colorRepos(out);
  }

  // Each open repo's color (REPO_COLORS), given once and kept (a repo opened again gets its
  // old one): the palette color fewest open repos have, or the color its space already had
  // when that's in the palette and free, so a familiar color stays.
  colorRepos(out) {
    const colors = { ...(shared(REPO_COLORS) ?? {}) };
    const open = Object.keys(out);
    const was = shared("space.colors") ?? {};
    let changed = false;
    for (const k of open) {
      if (colors[k]) continue;
      const uses = (c) => open.filter((o) => colors[o] === c).length;
      const cs = out[k].checkouts ?? [];
      const anchor = (cs.find((c) => c.main && c.space) ?? cs.find((c) => c.space))?.space;
      const old = anchor && was[anchor] ? spaceFill({}, was[anchor]) : null;
      colors[k] = old && REPO_PALETTE.includes(old) && !uses(old) ? old : REPO_PALETTE.reduce((best, c) => (uses(c) < uses(best) ? c : best));
      changed = true;
    }
    if (changed) setShared(REPO_COLORS, colors);
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          // Its git folder changed (a worktree added or removed, a commit): read its list again.
          delete this.treesAt[mine];
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine), cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } });
  }

  // The New worktree form (mods/worktree-plus), for the repo where this space is now.
  newWorktree(w) {
    openOverlay({ mod: "worktree-plus", kind: "dialog", width: 600, height: 640, props: { space: w.id, folder: place(w, panes()), action: "new" } });
  }

  // The repo's own sessions (mods/wt-sessions): those in its main checkout, not in the
  // worktrees inside it (a repo's .claude/worktrees/*).
  sessions(w, g) {
    const main = (this.trees[g.repo] ?? []).find((c) => c.main)?.path ?? g.top;
    const exclude = (this.trees[g.repo] ?? []).filter((c) => !c.main).map((c) => c.path);
    openOverlay({ mod: "wt-sessions", kind: "dialog", width: 620, height: 520, props: { name: w.name, path: main, machine: w.machine ?? null, space: w.id, exclude } });
  }

  // A worktree space's sessions, as its menu's Sessions… opens them.
  wtSessions(w, g) {
    openOverlay({ mod: "wt-sessions", kind: "dialog", width: 620, height: 520, props: { name: w.name, path: g.top, machine: w.machine ?? null, space: w.id } });
  }

  // Key commands ("<key>": "spaces-plus:new_worktree" in keys.json, or
  // `herdr-app do spaces-plus.new_worktree`): New worktree for the shown space's repo.
  // `sessions`: that space's sessions (its repo's, or its worktree's).
  // `next` / `prev`: the next or previous space in the list's order (see step).
  // `new_terminal`: a terminal or an agent in that space's worktree (as Orca's New agent tab).
  // `new_worktree@<space id or name>` (any command) targets another space without showing it.
  // `sleep@<space id>`: put that worktree to sleep (see sleep). `open@<path>`: open the
  // checkout at path as a space, waking it if it sleeps (wt-menu and picker-plus use it).
  // `resume@<json { agent, session, argv, cwd, title }>`: that agent session in Herdr (see resumeHere).
  // By checkout path, for agents (the `hm` command, bin/hm): `go@<path>` shows its space, or
  // opens it; `sleep@<json { path, request }>` replies after saving or reports failure;
  // legacy `sleep@<path>` shows a toast; `meta@<json { path, patch }>` changes what wt-menu edits
  // (name, comment, link, pr, status, pinned, archived; null clears); `create@<json>` makes
  // a worktree, as the New worktree form does (see fromAgent), `clone@` / `project@` add a
  // project as the Add project dialog does; `remove@<path>` asks the person to remove one
  // (`remove@<json>`, `clean@<json>`: an agent's, removed with no window; see removeFromAgent);
  // `sessions@<path>` shows its sessions; `sort@<activity|recent|name|created>`;
  // `doc@<json { file, terminal, request }>` shows a Markdown file rendered beside that
  // terminal's pane, as ⌘P's Docs view does (lib/docs.js's openDoc).
  listen(cx) {
    cx.spawn(async (cx) => {
      for (;;) {
        const raw = String(await nextCommand());
        const cut = raw.indexOf("@");
        const [c, target] = cut < 0 ? [raw, null] : [raw.slice(0, cut), raw.slice(cut + 1)];
        // First: after a reload the old build stops here, instead of acting on it too.
        cx.notify();
        if (c === "open" && target) { this.openPath(target); continue; }
        if (c === "resume" && target) { try { this.resumeHere(JSON.parse(target)); } catch {} continue; }
        if (c === "go" && target) { const s = this.spaceAt(target); s ? run("space.select", { id: s.id }) : this.openPath(target); continue; }
        if (c === "meta" && target) { try { this.editMeta(JSON.parse(target)); } catch {} continue; }
        if (c === "sleep" && target?.startsWith("{")) {
          let spec;
          try {
            spec = JSON.parse(target);
            const s = this.spaceAt(spec.path), g = s && this.git[where(s, panes())];
            if (!s || !g?.linked) throw new Error("Worktree is not open or is a primary checkout.");
            await this.sleep(s, g, true);
            answer(spec.request, { ok: true });
          } catch (error) { if (spec?.request) answer(spec.request, { ok: false, error: String(error.message ?? error) }); }
          continue;
        }
        if ((c === "create" || c === "clone" || c === "project") && target) { let spec = null; try { spec = JSON.parse(target); } catch {} if (spec) cx.spawn(async () => this.fromAgent(c, spec)); continue; }
        // A path: the person's Remove dialog. JSON (hm rm, hm clean): an agent's, with no window.
        if (c === "remove" && target) {
          if (target.startsWith("/")) { this.askRemove(target); continue; }
          let spec = null; try { spec = JSON.parse(target); } catch {}
          if (spec?.path) cx.spawn(async () => answer(spec.request, await this.removeFromAgent(spec)));
          continue;
        }
        if (c === "clean" && target) {
          let spec = null; try { spec = JSON.parse(target); } catch {}
          if (spec?.repo && spec.review) this.askClean({ top: spec.repo }, spec.request);
          else if (spec?.repo) cx.spawn(async () => answer(spec.request, await this.cleanFromAgent(spec)));
          continue;
        }
        if (c === "sort" && target) { if (SORTS.some(([id]) => id === target)) setShared(SORT, target); continue; }
        // option@<json { name?, value?, request }>: the look choices (lib/state.js's OPTIONS) for
        // hm option, as the settings window sets them: with a name, set it (null: its default);
        // without, list them all with their values. color@<json { repo, color, request }>: a
        // repo's color (a name or path of a repo the sidebar lists; a color name, #rrggbb or "auto").
        if ((c === "option" || c === "color") && target) {
          let spec = null; try { spec = JSON.parse(target); } catch {}
          if (!spec) continue;
          if (c === "option" && !spec.name) {
            answer(spec.request, { ok: true, options: Object.entries(OPTION_DEFS).map(([name, d]) => ({ name, value: option(name), default: d.default, group: d.group, about: d.about })) });
            continue;
          }
          let error = null;
          if (c === "option") error = setOption(spec.name, spec.value);
          else if (spec.repo === "all" && spec.color === "auto") resetRepoColors();
          else {
            const hit = Object.entries(shared(TREES) ?? {}).find(([, r]) => r.name === spec.repo || (r.checkouts ?? []).some((x) => x.main && x.path === spec.repo));
            error = hit ? setRepoColor(hit[0], spec.color === "auto" ? null : spec.color) : `No repo ${spec.repo} in the sidebar`;
          }
          answer(spec.request, error ? { ok: false, error } : { ok: true });
          continue;
        }
        // seen@<json { terminals?: [address], request }>: done agents marked seen without opening
        // them (lib/state.js's ackDone), as the Agents list's check does; no terminals: all done ones.
        if (c === "seen" && target) {
          let spec = null; try { spec = JSON.parse(target); } catch {}
          if (!spec) continue;
          const done = agents().filter((a) => a.status === "done" && (!spec.terminals?.length || spec.terminals.includes(a.address)));
          ackDone(done.map((a) => a.address));
          answer(spec.request, { ok: true, count: done.length, names: done.map((a) => a.space_name || a.address) });
          continue;
        }
        if (c === "doc" && target) {
          let spec = null; try { spec = JSON.parse(target); } catch {}
          if (!spec?.file) continue;
          const pane = panes().find((p) => p.terminal === spec.terminal)?.pane ?? null;
          const r = openDoc({ file: spec.file, on: null, pane, focus: false });
          if (r.how !== "opened") { answer(spec.request, { ok: true, file: spec.file, how: r.how, pane: r.pane }); continue; }
          // Answered once the new pane is there and noted (see noteOpened), at most 3 s on.
          let tries = 0;
          const wait = cx.timer.every(150, () => {
            const made = noteOpened(r, spec.file);
            if (!made && ++tries < 20) return;
            wait.cancel();
            answer(spec.request, { ok: true, file: spec.file, how: "opened", pane: made });
          });
          continue;
        }
        if (target?.startsWith("/") && (c === "sleep" || c === "sessions")) {
          const s = this.spaceAt(target), g = s && this.git[where(s, panes())];
          if (c === "sleep" && s && g?.linked) await this.sleep(s, g);
          if (c === "sessions") openOverlay({ mod: "wt-sessions", kind: "dialog", width: 620, height: 520, props: { name: metaOf(null, target).name ?? base(target), path: target, machine: null, ...(s ? { space: s.id } : {}) } });
          continue;
        }
        const w = target ? spaces().find((s) => s.id === target || s.name === target) : spaces().find((s) => s.active);
        if (c === "new_worktree" && w) this.newWorktree(w);
        const g = w && this.git[where(w, panes())];
        if (c === "sessions" && g) g.linked ? this.wtSessions(w, g) : this.sessions(w, g);
        if (c === "next" || c === "prev") this.step(c === "next" ? 1 : -1);
        if (c === "new_terminal" && w) this.newTerminal(w, g?.top ?? place(w, panes()), w.id);
        if (c === "sleep" && w && g?.linked) await this.sleep(w, g);
      }
    });
  }

  // A checkout listed under its repo but not open: open it as a space there (as the
  // worktree mod's Open worktree does), named after its display name if it has one. It
  // nests under the repo by git and replaces this row once its git is read.
  openWorktree(w, c) {
    this.openCheckout(c.path, w.machine ?? null);
  }

  // The space showing the checkout at path (on this computer), if one does.
  spaceAt(path) {
    const ps = panes();
    return spaces().find((s) => !s.machine && this.git[where(s, ps)]?.top === path) ?? null;
  }

  // meta@: { path, patch } into the checkout's entry, as wt-menu's edits; a new name also
  // renames its space ("" gives it Herdr's automatic name back).
  editMeta({ path, patch }) {
    if (!path || !patch || typeof patch !== "object") return;
    const key = metaKey(null, path);
    const all = shared(META) ?? {};
    setShared(META, { ...all, [key]: { ...(all[key] ?? {}), ...patch } });
    const s = "name" in patch ? this.spaceAt(path) : null;
    if (s) run("space.rename", { id: s.id, name: patch.name ?? "" });
  }

  // From an agent (hm), with no window in between, by the same code the buttons run:
  // create@ { repo (any folder in it), name, branch, base, link, agent, prompt, setup,
  //   include }: a worktree, as the New worktree form's Create (lib/worktree.js);
  // clone@ { url, parent, host }, project@ { name, parent, host }: as the Add project dialog
  //   (lib/project.js).
  // With `request`, how it went goes to shared("wt.results")[request] = { ok, path, note,
  // error, at } (the last 20 kept), which hm reads.
  async fromAgent(kind, { repo, request, host, ...o }) {
    let result;
    try {
      // quiet: no toast for what an agent did; it tells the person itself.
      const made = kind === "create" ? await createWorktree({ ...o, folder: repo, quiet: true })
        : kind === "clone" ? await cloneRepo({ ...o, on: host ?? null })
        : await createProject({ ...o, on: host ?? null });
      result = { ok: true, path: made.path, note: made.note ?? null, error: null };
    } catch (error) { result = { ok: false, path: null, error: String(error?.message ?? error) }; }
    answer(request, result);
  }

  // Checkouts (this computer's) where an agent is working or waiting on the person.
  busyPaths() {
    const ps = panes(), out = new Set();
    for (const s of spaces().filter((x) => !x.machine)) {
      const top = this.git[where(s, ps)]?.top;
      const tabs = new Set((s.tabs ?? []).map((tab) => tab.id));
      if (top && ps.some((p) => tabs.has(p.tab) && (p.status === "working" || p.status === "blocked"))) top && out.add(top);
    }
    return out;
  }

  // remove@ { path, force } from an agent (hm rm): no window; the person already asked for
  // it. Removed as Remove removes it (the branch goes only when merged, so no commit is
  // lost), unless something would be: uncommitted changes, or an agent at work there. Then
  // it isn't, and the answer says why, for the agent to ask the person (force: they said so).
  async removeFromAgent({ path, force }) {
    const repo = await repoAt(path, null);
    if (!repo) return { ok: false, error: `${path} isn't a git checkout.` };
    if (!repo.linked) return { ok: false, error: "That's the repo's primary checkout: only worktrees are removed." };
    if (!force) {
      const st = await gitIn(path, ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"], null);
      const changed = st.ok ? st.out.split("\n").filter(Boolean).length : 0;
      const why = changed ? `it has ${changed} uncommitted change${changed === 1 ? "" : "s"}` : this.busyPaths().has(path) ? "an agent is working there" : null;
      if (why) return { ok: false, held: true, error: `Not removed: ${why}. If the person still wants it gone, run again with --force.` };
    }
    try {
      const r = await removeWorktree({ repo, on: null, space: this.spaceAt(path)?.id, force: true, quiet: true });
      return { ok: true, path, branch: r.branch };
    } catch (error) { return { ok: false, error: String(error?.message ?? error) }; }
  }

  // clean@ { repo } from an agent (hm clean): no window. The done worktrees picked by the
  // rule (cleanupCandidates: merged, nothing uncommitted, no agent, not pinned) are removed;
  // the others are listed with why, for the agent to tell the person.
  async cleanFromAgent({ repo: folder }) {
    const repo = Object.keys(this.trees).find((r) => this.trees[r].some((c) => c.path === folder || folder.startsWith(`${c.path}/`)));
    const checkouts = (this.trees[repo] ?? []).map((c) => ({ ...c, pr: this.prs[repo]?.byBranch?.[c.branch] ?? null }));
    const main = checkouts.find((c) => c.main)?.path ?? folder;
    try {
      const found = await cleanupCandidates({ main, on: null, checkouts, busy: this.busyPaths() });
      const removed = [], left = [];
      for (const f of found) {
        if (!f.ok) { left.push({ name: f.name, why: f.why, stop: f.stop }); continue; }
        try {
          const r = await removeWorktree({ repo: await repoAt(f.path, null), on: null, space: this.spaceAt(f.path)?.id, prMerged: f.prMerged, force: true, quiet: true });
          removed.push({ name: f.name, why: f.why, branch: r.branch });
        } catch (error) { left.push({ name: f.name, why: f.why, stop: String(error?.message ?? error) }); }
      }
      return { ok: true, removed, left };
    } catch (error) { return { ok: false, error: String(error?.message ?? error) }; }
  }

  // remove@: the Remove worktree dialog for the checkout at path; the person confirms.
  askRemove(path) {
    const s = this.spaceAt(path);
    openOverlay({ mod: "worktree-plus", kind: "dialog", width: 460, height: 280, props: { ...(s ? { space: s.id } : {}), folder: path, machine: null, action: "remove" } });
  }

  // Clean up: the dialog listing a repo's worktrees whose work is done (worktree-plus, clean;
  // see cleanupCandidates), any folder of the repo given. `request` (hm clean): the dialog
  // writes what it found to shared("wt.results")[request].
  askClean(g, request = null) {
    const repo = Object.keys(this.trees).find((r) => this.trees[r].some((c) => c.path === g.top || g.top?.startsWith(`${c.path}/`))) ?? g.repo;
    const main = (this.trees[repo] ?? []).find((c) => c.main)?.path ?? g.top;
    openOverlay({ mod: "worktree-plus", kind: "dialog", width: 560, height: 460, props: { folder: main, machine: null, action: "clean", ...(request ? { request } : {}) } });
  }

  // A checkout's path, from another mod: its machine from the repo lists.
  openPath(path) {
    const repo = Object.keys(this.trees).find((r) => this.trees[r].some((c) => c.path === path));
    this.openCheckout(path, repo ? JSON.parse(repo)[0] : null);
  }

  // Open a checkout as a space. If it sleeps, its first session resumes in that space and
  // the others get a tab each once the space is there (see checkNew); then it's awake.
  openCheckout(path, machine) {
    const m = metaOf(machine, path);
    clearUnread(machine, path);
    const key = metaKey(machine, path);
    const z = (shared(SLEEP) ?? {})[key];
    const [first, ...rest] = z?.sessions ?? [];
    run("space.new", { ...(m.name ? { name: m.name } : {}), folder: first?.cwd ?? path, machine: machine ?? "", ...(first ? { argv: resumeArgv(first) } : {}) });
    if (rest.length) this.waking[path] = { machine, rest, since: Date.now() };
    if (z) { const { [key]: _gone, ...others } = shared(SLEEP) ?? {}; setShared(SLEEP, others); }
  }

  // An agent session in Herdr (agents-plus, for one running elsewhere): if a Herdr terminal
  // runs it already (shared "wt.live", kept by wt-restore), go there; else resume it as it
  // was started, as Claude Code and Codex allow even while it runs elsewhere: a new tab in
  // the space showing its folder, or a new space there (it nests under its repo).
  resumeHere(rec) {
    const live = (shared(LIVE) ?? {})[rec.session];
    if (live) return run("pane.focus", { terminal: live });
    if (!AGENTS[rec.agent]) return;
    const ps = panes();
    const inside = (p, dir) => Boolean(p) && (p === dir || p.startsWith(`${dir}/`));
    // Its checkout (the deepest holding its folder), and the space showing that checkout; a
    // folder in no known checkout goes to the space whose folder holds it.
    const checkout = Object.values(this.trees).flat().map((c) => c.path).filter((p) => inside(rec.cwd, p)).sort((a, b) => b.length - a.length)[0];
    const s = checkout
      ? spaces().find((x) => !x.machine && this.git[where(x, ps)]?.top === checkout)
      : spaces().filter((x) => !x.machine && inside(rec.cwd, place(x, ps))).sort((a, b) => place(b, ps).length - place(a, ps).length)[0];
    const name = rec.title ? rec.title.slice(0, 28) : undefined;
    if (s) {
      run("space.select", { id: s.id });
      run("tab.new", { space: s.id, folder: rec.cwd, argv: resumeArgv(rec), ...(name ? { name } : {}) });
    } else run("space.new", { folder: rec.cwd, argv: resumeArgv(rec) });
  }

  // Sleep, as Orca's: note which agent session each terminal of this worktree's space runs
  // (Claude Code's or Codex's), then close the space, which ends its terminals. Its row
  // stays, dimmed and "sleeping"; opening it resumes those sessions (see openCheckout).
  // quiet: an agent's (hm sleep): no toast, it says so itself.
  async sleep(w, g, quiet = false) {
    const tabs = new Set((w.tabs ?? []).map((tab) => tab.id));
    const sessions = [];
    for (const p of panes().filter((p) => tabs.has(p.tab) && p.terminal)) {
      try {
        const result = await hc(["get", p.terminal, "--json"]);
        if (result.code !== 0) throw new Error(`Cannot read ${p.terminal}; kept open.`);
        const term = JSON.parse(result.stdout);
        const fg = term.foreground, kind = agentKind(fg?.argv);
        const session = kind && fg.pid ? await sessionOf(kind, fg.pid, term, "spaces-plus") : null;
        // Never close an agent whose conversation could not be identified for wake-up.
        if (kind && !session) throw new Error(`Cannot identify ${kind} session in ${p.terminal}; kept open.`);
        if (session) sessions.push({ agent: kind, session, argv: fg.argv, cwd: fg.cwd || term.cwd, title: String(term.title ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim() });
      } catch (error) {
        if (quiet) throw error;
        notify({ title: "Worktree kept open", body: String(error.message ?? error), level: "warning" });
        return;
      }
    }
    setShared(SLEEP, { ...(shared(SLEEP) ?? {}), [metaKey(w.machine, g.top)]: { at: Date.now(), sessions } });
    run("space.close", { id: w.id, confirmed: true });
    if (!quiet) notify({ title: `${w.name} is asleep`, body: sessions.length ? `${sessions.length} session${sessions.length === 1 ? "" : "s"} will resume when you open it.` : "Its terminals are closed.", level: "info", timeout: 4000 });
  }

  // The next (+1) or previous (-1) space in the order the list shows: a repo, then its
  // worktrees, then the next repo. Skips checkouts that aren't open and folded worktrees
  // (landing on one would open it). Wraps around.
  step(by) {
    const shown = this.ordered().filter((r) => !r.ghost && !r.archived && !r.term && !r.header).map((r) => r.w);
    if (!shown.length) return;
    const at = shown.findIndex((w) => w.active);
    const to = shown[((at < 0 ? (by > 0 ? -1 : 0) : at) + by + shown.length) % shown.length];
    const g = this.git[where(to, panes())];
    if (g?.linked) clearUnread(to.machine, g.top);
    run("space.select", { id: to.id });
  }

  // When another space is shown (a click here, a key, the agents list, a terminal row):
  // - its terminals unfold, and the one left folds its own again (any press of their fold
  //   buttons is forgotten: see spaceFolds);
  // - its repo unfolds if it was folded, and folds again once a space outside it is shown;
  //   a repo someone unfolded by hand stays open.
  // Runs from render, which follows every change of the shown space.
  reveal() {
    const w = spaces().find((s) => s.active);
    if (!w || w.id === this.lastActive) return;
    const ps = panes();
    const left = spaces().find((s) => s.id === this.lastActive);
    this.lastActive = w.id;
    const repoOf = (s) => (s ? this.git[where(s, ps)]?.repo ?? null : null);
    const from = repoOf(left), to = repoOf(w);
    if (from && from !== to && this.autoOpened.delete(from)) this.foldedRepos.add(from);
    if (to && this.foldedRepos.delete(to)) this.autoOpened.add(to);
    localStorage.setItem("wt.folded", JSON.stringify([...this.foldedRepos]));
    if (left) delete this.spaceFolds[left.id];
    delete this.spaceFolds[w.id];
    // Bring its row into view (see scroller): twice, since its repo may unfold this frame.
    this.wantReveal = 2;
    localStorage.setItem("wt.spaceFolds", JSON.stringify(this.spaceFolds));
  }

  // The list, scrolled by this view rather than by a scroll area, so it can follow the shown
  // space: when another space is shown (an agent clicked in the Agents list, ⌘P, a key) and
  // its row is out of view, the list moves to it. A scroll area can't be moved from code, so
  // the rows sit in a strip moved by scrollY, each measured (on_size_change) to know where
  // the shown one is. The wheel scrolls it; the thin bar on the right says where you are.
  scroller(t, collapsed) {
    this.activeEl = null;
    const items = this.grouped(t, collapsed);
    const at = this.activeEl ? items.indexOf(this.activeEl) : -1;
    const zoom = settings().zoom || 1;
    this.itemH ??= [];
    this.itemH.length = items.length;
    const view = this.viewH ?? 0, content = this.contentH ?? 0;
    if (this.wantReveal > 0 && at >= 0 && view > 0) {
      const top = this.itemH.slice(0, at).reduce((a, b) => a + (b ?? 0), 0), h = this.itemH[at] ?? 28;
      if (top < (this.scrollY ?? 0) || top + h > (this.scrollY ?? 0) + view) this.scrollY = top - Math.max(0, (view - h) / 3);
      this.wantReveal--;
    }
    const max = Math.max(0, content - view);
    this.scrollY = Math.min(Math.max(0, this.scrollY ?? 0), max);
    const measure = (key) => (size, cx) => {
      const h = size.height / zoom;
      if (Math.abs((this[key] ?? 0) - h) > 0.5) { this[key] = h; cx.notify(); }
    };
    return v_flex().id("sp-list").flex_1().min_h(0).relative().overflow_hidden()
      .on_size_change(measure("viewH"))
      .on_scroll_wheel((e, cx) => {
        this.wantReveal = 0;
        this.scrollY = Math.min(Math.max(0, (this.scrollY ?? 0) - e.delta.y), max);
        cx.notify();
      })
      .child(v_flex().absolute().left(0).right(0).top(-this.scrollY).px(8).pb(14)
        .on_size_change(measure("contentH"))
        .children(items.map((el, i) => div().w_full().flex_none()
          .on_size_change((size, cx) => {
            const h = size.height / zoom;
            if (Math.abs((this.itemH[i] ?? 0) - h) > 0.5) { this.itemH[i] = h; cx.notify(); }
          })
          .child(el))))
      .when(max > 0, (el) => el.child(div().absolute().right(1).w(4).rounded(2).bg(t.border)
        .top(view * (this.scrollY / content)).h(Math.max(24, view * (view / content)))));
  }

  // A worktree row's own menu (mods/wt-menu): name, links, status, pin, archive, remove.
  // `space`: the space showing it, null for a checkout that isn't open.
  wtMenu(w, path, branch, space, primary = false) {
    openOverlay({ mod: "wt-menu", kind: "popup", width: 230, height: 640, props: { mode: "menu", key: metaKey(w.machine, path), path, machine: w.machine ?? null, space, branch, primary } });
  }

  // After a worktree row's name: its link, PR, status and a dot when marked unread.
  // (An agent's state shows at its end, see glyph.) A link or PR with an address opens in
  // the browser when clicked (see linkUrl), and so does a live port (`ports`, first of them);
  // mouse down stops there, so the row isn't selected or dragged.
  badges(m, t, id = "", ports = []) {
    // The look choices (lib/state.js's OPTIONS) can leave PRs and ports out.
    if (!option("prBadges")) m = { ...m, pr: null };
    if (!option("portBadges")) ports = [];
    if (!option("linkBadges")) m = { ...m, link: null };
    if (!option("noteBadges")) m = { ...m, comment: null };
    const tag = STATUS_TAG[m.status];
    const dot = m.unread ? t.accent : null;
    const link = linkUrl(m.link);
    const opener = (key, url, tip) => (el) => el.id(`${key}-${id}`).tooltip(tip)
      .when(Boolean(url), (el) => el.cursor_pointer().hover((s) => s.text_color(t.foreground))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); exec("open", [url]); }));
    // A live port (see readPorts): the first, "+N" for more; click opens it on localhost.
    const first = ports[0];
    return h_flex().flex_none().gap(5).items_center().text_size(11)
      .when(Boolean(first), (el) => el.child(opener("port", first && `http://localhost:${first.port}`, ports.map((x) => `:${x.port}  ${x.cmd}`).join("\n"))(div().text_color(t.ansi2).child(`:${first?.port}${ports.length > 1 ? ` +${ports.length - 1}` : ""}`))))
      .when(Boolean(m.link), (el) => el.child(opener("link", link, link ? `Open ${link}` : `${m.link}\nA link that's a URL opens from here (or set "wt.linkTemplate").`)(div().max_w(84).truncate().text_color(t.dim).child(shortLink(m.link)))))
      // The PR: its number in its state's color (open, merged, closed, draft), and while it's
      // open its checks: ✓ passed, ✗ failed, … running.
      .when(Boolean(m.pr?.number), (el) => el.child(opener("pr", m.pr.url, `${m.pr.title ? `“${m.pr.title}”` : `PR #${m.pr.number}`}\n${PR_WORD[m.pr.state] ?? "open"}${m.pr.draft ? " (draft)" : ""}${m.pr.checks ? ` · checks ${m.pr.checks === "pass" ? "passed" : m.pr.checks === "fail" ? "failed" : "running"}` : ""}${m.pr.url ? "\nClick to open" : ""}`)(h_flex().gap(2).items_center()
        .child(div().text_color(m.pr.state === "MERGED" ? t.ansi5 : m.pr.state === "CLOSED" || m.pr.draft ? t.dim : t.accent).child(`#${m.pr.number}`))
        .when(m.pr.state === "OPEN" && Boolean(m.pr.checks), (el) => el.child(div().text_color(m.pr.checks === "pass" ? t.ansi2 : m.pr.checks === "fail" ? t.blocked : t.working).child(m.pr.checks === "pass" ? "✓" : m.pr.checks === "fail" ? "✗" : "…"))))))
      .when(Boolean(tag), (el) => el.child(div().text_color(m.status === "completed" ? t.ansi2 : m.status === "in-review" ? t.accent : t.dim).child(tag)))
      .when(Boolean(dot), (el) => el.child(div().size(6).rounded(3).flex_none().bg(dot)));
  }

  // "N archived" under a repo's worktrees: shows or hides them.
  archivedRow({ archived }, t) {
    return this.guides(h_flex().relative(), 1, t).id(`archived-${archived.repo}`).h(24).flex_none().pl(8 + 22).gap(7).items_center().rounded(7)
      .text_size(11.5).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.muted))
      .on_click((_e, cx) => {
        this.showArchived.has(archived.repo) ? this.showArchived.delete(archived.repo) : this.showArchived.add(archived.repo);
        localStorage.setItem("wt.showArchived", JSON.stringify([...this.showArchived]));
        cx.notify();
      })
      .child(svg("mods/workspace-chrome/archive.svg").size(12))
      .child(`${archived.count} archived${archived.showing ? " · hide" : ""}`);
  }

  // A small button at the end of a hovered repo row. Mouse down stops here, so the row
  // neither starts a drag nor gets selected (as the tab bar's close button does).
  rowButton(id, icon, tip, action, on, t) {
    return div().id(id).size(20).flex_none().flex().items_center().justify_center().rounded(5)
      .cursor_pointer()
      .text_color(t.muted)
      .hover((s) => s.bg(on ? t.hover : t.selected).text_color(t.foreground))
      .tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); action(); })
      .child(svg(icon.includes("/") ? icon : `mods/workspace-chrome/${icon}.svg`).size(12));
  }

  // A terminal or an agent started in a worktree's folder (mods/wt-menu, new mode): a new
  // tab in its space, or for a checkout that isn't open, a new space there.
  newTerminal(w, path, space, name) {
    openOverlay({ mod: "wt-menu", kind: "popup", width: 220, height: 380, props: { mode: "new", path, machine: w.machine ?? null, space, name } });
  }

  // The + at the end of a hovered repo row: New worktree there.
  worktreeButton(w, on, t) {
    return this.rowButton(`space-worktree-${w.id}`, "plus", "New worktree…", () => this.newWorktree(w), on, t);
  }

  // The tree, in order: each top space (a repo's main checkout, or any other space), its
  // terminals, then (for a repo) its worktrees: open ones (each with its terminals) and
  // checkouts no space is in (rows with `ghost`), pinned first, archived ones behind an
  // "N archived" row. Terminal rows carry `term` (a pane), `tab` and `depth`. A row with
  // something under it carries `fold`: { folded, count, toggle } for its fold button.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null })).filter((r) => this.shown.has(r.w.id));
    // Each repo's group hangs from a space at its main checkout, or, while none is open, from
    // its first open worktree's: a new worktree goes under its repo either way (as Orca's
    // projects), the main checkout then a row to open (see ghostRow, `primary`).
    const anchors = new Map();
    for (const r of list) if (r.g && !r.g.linked && !anchors.has(r.g.repo)) anchors.set(r.g.repo, r);
    for (const r of list) if (r.g?.linked && !anchors.has(r.g.repo)) anchors.set(r.g.repo, r);
    const nested = (r) => Boolean(r.g?.linked) && anchors.has(r.g.repo);
    // A space's terminals: the panes of its tabs (not put-away ones), in tab order. Only
    // when there's something to tell apart: several, or one running an agent or a program.
    // A lone idle shell says nothing its space's row doesn't.
    const termsOf = (w, depth) => {
      const all = (w.tabs ?? []).filter((tab) => !tab.settled)
        .flatMap((tab) => ps.filter((p) => p.tab === tab.id && p.terminal).map((p) => ({ w, term: p, tab, depth })));
      return all.length > 1 || all.some(({ term }) => term.status || !term.program?.shell) ? all : [];
    };
    const flipRepo = (repo) => () => {
      this.foldedRepos.has(repo) ? this.foldedRepos.delete(repo) : this.foldedRepos.add(repo);
      this.autoOpened.delete(repo); // by hand: it stays as set
      localStorage.setItem("wt.folded", JSON.stringify([...this.foldedRepos]));
    };
    // Open while shown, folded otherwise, unless its button was pressed since (see reveal).
    const spaceFold = (w, count) => {
      if (!count) return null;
      const set = this.spaceFolds[w.id];
      const folded = set ? set === "closed" : !w.active;
      return { folded, count, toggle: () => { this.spaceFolds[w.id] = folded ? "open" : "closed"; localStorage.setItem("wt.spaceFolds", JSON.stringify(this.spaceFolds)); } };
    };
    const out = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      const repo = r.g && anchors.get(r.g.repo) === r && !placed.has(r.g.repo) ? r.g.repo : null;
      if (!repo && nested(r)) continue;
      if (!repo) {
        const terms = termsOf(r.w, 1);
        const fold = spaceFold(r.w, terms.length);
        out.push({ ...r, tree: null, fold });
        if (!fold?.folded) out.push(...terms);
        continue;
      }
      placed.add(repo);
      // own: the group hangs from a space at the main checkout (else from a worktree's, a kid too).
      const own = !r.g.linked;
      const kids = list.filter((k) => nested(k) && k.g.repo === repo);
      const open = new Set(list.filter((k) => k.g?.repo === repo).map((k) => k.g.top));
      const ghosts = (this.trees[repo] ?? []).filter((c) => !c.main && !open.has(c.path)).map((c) => ({ w: r.w, g: r.g, ghost: c }));
      const withMeta = [...kids, ...ghosts].map((k) => ({ ...k, meta: metaOf(r.w.machine, k.ghost ? k.ghost.path : k.g.top) }));
      const showing = this.showArchived.has(repo);
      const hidden = withMeta.filter((k) => k.meta.archived).length;
      // In the picked order (see order), pinned first.
      const all = order(withMeta.filter((k) => showing || !k.meta.archived), shared(SORT) ?? "activity");
      // As Orca groups a project: a header, then the main checkout as a row of its own (its
      // terminals under it), then the worktrees. The header's fold button folds all of it;
      // the shown space stays.
      const folded = this.foldedRepos.has(repo);
      // Folded, the header shows the most urgent agent state in the repo (see headerRow).
      const group = [r.w, ...kids.map((k) => k.w)];
      const status = ["blocked", "done", "working"].find((st) => group.some((x) => x.status === st)) ?? null;
      out.push({ ...r, header: true, status, fold: { folded, count: withMeta.length + 1, toggle: flipRepo(repo) } });
      if (own && (!folded || r.w.active)) {
        const mainTerms = termsOf(r.w, 2);
        const fold = spaceFold(r.w, mainTerms.length);
        out.push({ ...r, tree: true, primary: true, fold });
        if (!folded && !fold?.folded) out.push(...mainTerms);
      }
      const mainCheckout = own ? null : (this.trees[repo] ?? []).find((c) => c.main);
      if (mainCheckout && !folded) out.push({ w: r.w, g: r.g, ghost: mainCheckout, primary: true, tree: true, meta: metaOf(r.w.machine, mainCheckout.path) });
      for (const k of folded ? all.filter((k) => k.w.active && !k.ghost) : all) {
        if (k.ghost) { out.push({ ...k, tree: true }); continue; }
        const kt = termsOf(k.w, 2);
        const fold = spaceFold(k.w, kt.length);
        out.push({ ...k, tree: true, fold });
        if (!fold?.folded) out.push(...kt);
      }
      if (hidden && !folded) out.push({ w: r.w, g: r.g, archived: { repo, count: hidden, showing } });
    }
    return out;
  }

  // The rows, under a header per machine once one isn't this computer.
  grouped(t, collapsed) {
    // The narrow rail numbers spaces only: checkouts not open aren't spaces.
    // The narrow rail numbers spaces only: terminals, checkouts not open and "N archived" aren't spaces.
    const rows = this.ordered().filter((r) => !collapsed || (!r.ghost && !r.archived && !r.term && !r.header));
    // Each row's top-level item (see draggable): a header's, or a space's outside any repo.
    let top = null;
    for (const r of rows) {
      if (r.header || (!r.tree && !r.term && !r.ghost && !r.archived)) top = r.i;
      r.top = top;
    }
    // Where a drag lands: below the target's last row moving down, above it moving up.
    if (this.dragging && this.over !== null && this.over !== this.pressed) {
      const group = rows.filter((r) => r.top === this.over);
      const down = this.pressed < this.over;
      const edge = down ? group[group.length - 1] : group[0];
      if (edge) edge.drop = down ? "bottom" : "top";
    }
    const plain = (r) => (collapsed ? this.compact(r, t) : r.header ? this.headerRow(r, t) : r.term ? this.termRow(r, t) : r.archived ? this.archivedRow(r, t) : r.ghost ? this.ghostRow(r, t) : this.row(r, t));
    const draw = (r) => (collapsed ? plain(r) : this.dropZone(plain(r), r.top, r.drop, t));
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name), ...Object.keys(this.reconnecting)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => div().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(8).text_size(12).text_color(t.dim).child(collapsed ? "…" : "Loading…");
    // The shown space and its terminals as one card (one rounded background), the rest
    // row by row.
    const drawAll = (list) => {
      const out = [];
      for (let k = 0; k < list.length; k++) {
        const r = list[k];
        const lead = !collapsed && r.w?.active && !r.header && !r.term && !r.ghost && !r.archived;
        if (!lead || !(list[k + 1]?.term && list[k + 1].w.id === r.w.id)) { const el = draw(r); if (lead) this.activeEl = el; out.push(el); continue; }
        const inner = [this.row({ ...r, card: true }, t)];
        let drop = r.drop;
        while (list[k + 1]?.term && list[k + 1].w.id === r.w.id) { const x = list[++k]; drop ??= x.drop; inner.push(this.termRow({ ...x, card: true }, t)); }
        this.activeEl = this.dropZone(v_flex().id(`card-${r.w.id}`).flex_none().rounded(7).bg(t.selected).mt(r.tree ? 0 : 12).children(inner), r.top, drop, t);
        out.push(this.activeEl);
      }
      return out;
    };
    if (!remote.length) return loading(null) && !rows.length ? [loadingRow(null)] : drawAll(rows);
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const repair = this.reconnecting[m];
      const machine = this.machines.find(k => k.name === m) ?? repair?.machine;
      const connected = !m || machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const folded = this.folded.has(m);
      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().px(collapsed ? 2 : 8).gap(7).items_center().text_size(11).text_color(t.dim)
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => {
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(13).flex_none())
        .when(!collapsed, el => el.child(div().flex_1().truncate().child(m ?? "This computer"))
          .when(!connected && !rebuilt, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(rebuilt, el => el.child(h_flex().flex_none().gap(3).items_center()
            .child(div().max_w(140).truncate().child(repair?.error || "rebuilt ·"))
            .child(div().id(`machine-connect-${m}`).text_color(repair?.error ? t.blocked : t.muted)
              .hover(s => s.text_color(t.foreground))
              .tooltip(repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.")
              .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
              .child(repair?.busy ? "Connecting…" : "Connect"))))
          .when(connected, el => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).rounded(4).cursor_pointer().hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); }).child("+")))
          .child(div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.dim))
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none()));
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(8).gap(7).items_center().rounded(7).cursor_pointer()
        .text_size(12).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", { machine: m ?? "" }))
        .child(svg("mods/workspace-chrome/plus.svg").size(12)).when(!collapsed, el => el.child("New space there"));
      if (!collapsed && rebuilt) return [head];
      return [head, ...(folded ? [] : mine.length ? drawAll(mine) : [loading(m) ? loadingRow(m) : empty])];
    });
  }

  // Only what's unusual, after the name: "herdr · spike ↑2 ↓1". The repo goes when the
  // name says it or the row is nested under it; the branch goes when the name already
  // says it (TAXTEAM-773 on feature/TAXTEAM-773: a worktree is named after its branch)
  // or it's the repo's usual one: its default (origin/HEAD), main or master. A quiet row
  // (nested, neither shown nor hovered) leaves its branch out too: the list stays a list
  // of names, and the branch shows on the row in focus.
  gitTail(g, tree, name, t, quiet = false) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase() || a.split("/").pop().toLowerCase() === name.toLowerCase();
    const usual = raw === "master" || raw === "main" || raw === this.defaults[g.repo];
    // quiet: a nested row that isn't shown or hovered keeps to its name (see row).
    const branch = same(raw) || usual || quiet ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" · ");
    return h_flex()
      .flex_1()
      .min_w(0)
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(11)
      .text_color(t.dim)
      .when(Boolean(where), (el) => el.child(div().min_w(0).truncate().child(where)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`↑${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`↓${g.behind}`)));
  }

  // The fold button at the end of a row with something under it (as the machine headers
  // do): a repo folds its terminals and worktrees, a worktree its terminals. While folded
  // it says how many: always on a header (`count`), on a row while the pointer is on it
  // (most rows are folded, and a number on each is noise). Mouse down stops here.
  foldButton(id, fold, on, t, count = false) {
    return h_flex().id(id).h(20).px(3).gap(3).flex_none().items_center().rounded(5).cursor_pointer().text_size(11).text_color(t.dim)
      .when(fold.folded && !count, (el) => el.opacity(0.6))
      .hover((s) => s.bg(on ? t.hover : t.selected).text_color(t.foreground))
      .tooltip(fold.folded ? `Show ${fold.count}` : "Fold")
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); fold.toggle(); cx.notify(); })
      .when(fold.folded && (count || this.hovered === id.replace(/^fold-(main-)?/, "")), (el) => el.child(String(fold.count)))
      .child(svg(`mods/workspace-chrome/chevron-${fold.folded ? "right" : "down"}.svg`).size(11));
  }

  // An agent's state as the agents list draws it: a spinner while working, "!" when it
  // needs you, a dot when it finished unseen, a ring when idle. null: no agent.
  // An agent's state: lib/ui.js's mark, as the Agents list and ⌘P draw it.
  glyph(status, t) {
    return statusMark(t, status);
  }

  // Press, drag and drop onto another row to reorder spaces (as the shipped list does); a
  // press and release on the same row without moving runs `click`. A pointer over it; a
  // closed hand while a row is being dragged.
  // Moving a top-level item (a repo's group by its header, or a space outside any repo):
  // pressing marks it; moving the pointer 4 px makes it a drag (a click stays a click).
  // While dragging, a copy of the row follows the pointer (dragPreview), the item's rows
  // dim, and a line shows where it lands (dropZone); letting go anywhere in the sidebar
  // moves it there (endDrag). Worktree rows don't move: their order is the sort's.
  draggable(el, w, i, click, t, label = w.name) {
    return el
      .when(!this.dragging, (el) => el.cursor_pointer())
      .when(this.dragging, (el) => el.cursor_grabbing())
      .on_mouse_down("left", (e) => {
        this.pressed = i;
        this.over = i;
        this.dragging = false;
        this.downAt = e.position;
        this.grab = { x: e.local_position?.x ?? 12, y: e.local_position?.y ?? 13, width: e.bounds?.size?.width ?? null };
        this.dragLabel = { w, label };
      })
      .on_mouse_up("left", (_e, cx) => {
        if (this.dragging || this.pressed !== i) return;
        this.pressed = null;
        this.over = null;
        click();
        cx.notify();
      });
  }

  // The sidebar's pointer moves: past 4 px from the press it's a drag; the preview follows.
  dragMove(e, cx) {
    if (this.pressed === null) return;
    if (!this.dragging) {
      const d = Math.abs(e.position.x - (this.downAt?.x ?? 0)) + Math.abs(e.position.y - (this.downAt?.y ?? 0));
      if (d < 4) return;
      this.dragging = true;
    }
    this.dragAt = e.local_position;
    cx.notify();
  }

  // Letting go: a drag moves its item to where the line shows (spaces stay on their machine).
  endDrag(cx) {
    const from = this.pressed, over = this.over, dragged = this.dragging;
    this.pressed = null;
    this.over = null;
    this.dragging = false;
    this.dragAt = null;
    if (dragged && from !== null && over !== null && over !== from) {
      const source = spaces()[from], target = spaces()[over];
      if (source && target && (source.machine ?? null) === (target.machine ?? null)) run("space.move", { id: source.id, index: over + 1 });
    }
    cx.notify();
  }

  // A row (or the shown space's card) as part of its top-level item `top`: the pointer over
  // it makes that item the drop target; the dragged item's rows dim; `drop` ("top" or
  // "bottom") draws the landing line at that edge: above the item when moving up, below
  // its last row when moving down.
  dropZone(el, top, drop, t) {
    const line = drop && h_flex().absolute().left(-2).right(0).h(6).items_center().when(drop === "top", (l) => l.top(-3)).when(drop === "bottom", (l) => l.bottom(-3))
      .child(div().size(6).flex_none().rounded(3).border(2).border_color(t.accent).bg(t.chrome))
      .child(div().flex_1().h(2).rounded(1).bg(t.accent));
    return v_flex().relative().flex_none()
      .on_mouse_move((_e, cx) => {
        if (this.pressed === null || !this.dragging || this.over === top) return;
        this.over = top;
        cx.notify();
      })
      .when(this.dragging && top === this.pressed, (el) => el.opacity(0.35))
      .child(el)
      .when(Boolean(line), (el) => el.child(line));
  }

  // The header's three: Add project (mods/project-add: browse to a folder, clone a URL, or
  // start a new one; a repo shows under its repo), New terminal (in the home folder), New
  // worktree (of the shown space's repo; dim when it isn't in one).
  addButtons(t) {
    const w = spaces().find((x) => x.active);
    const g = w && this.git[where(w, panes())];
    const repo = Boolean(g && !g.gone);
    const icon = (id, name, tip, action, on = true) => div().id(id).size(24).flex_none().flex().items_center().justify_center().rounded(6)
      .tooltip(tip)
      .when(on, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(action))
      .when(!on, (el) => el.opacity(0.35))
      .child(svg(`mods/workspace-chrome/${name}.svg`).size(13));
    return h_flex().gap(1).items_center()
      .child(icon("space-add-project", "folder-plus", "Add project: a folder, a clone, or a new one", () => openOverlay({ mod: "project-add", kind: "dialog", width: 520, height: 330, props: {} })))
      .child(icon("space-new-terminal", "terminal", "New terminal", () => run("space.new", { folder: home(), machine: "" })))
      .child(icon("space-new-worktree", "git-branch", repo ? `New worktree of ${g.name}…` : "New worktree… (show a space in a repo first)", () => this.newWorktree(w), repo))
      // Settings last, at the far right, apart from what makes things.
      .child(icon("space-settings", "settings", "Settings: what the sidebar and the Agents list show, repo colors", () => openOverlay({ mod: "hm-settings", kind: "dialog", width: 560, height: 600, props: {} })));
  }

  // The dragged item, following the pointer where it was grabbed.
  dragPreview(t) {
    const { w, label } = this.dragLabel ?? {};
    if (!w || !this.dragAt) return null;
    const g = this.grab ?? { x: 12, y: 13 };
    return h_flex().absolute().left(Math.max(4, this.dragAt.x - g.x)).top(this.dragAt.y - g.y).w(g.width ?? 220).h(26).px(8).gap(10).items_center()
      .rounded(7).bg(t.popover).border(1).border_color(t.accent).shadow_lg().opacity(0.95)
      .child(this.avatar(w, t, 16, label))
      .child(div().flex_1().min_w(0).truncate().text_size(12).font_semibold().text_color(t.foreground).child(label));
  }

  hover(key) {
    return (over, cx) => {
      if (over) this.hovered = key;
      else if (this.hovered === key) this.hovered = null;
      cx.notify();
    };
  }

  // A space's avatar: its color, and the first letter of `label` (default its name).
  // `repo`: a repo's TREES key, for its color (REPO_COLORS) rather than the space's.
  avatar(w, t, size = 18, label = w.name, repo = null) {
    const colors = shared("space.colors") ?? {};
    const color = colors[w.id] ?? "ansi6";
    const fill = (repo && (shared(REPO_COLORS) ?? {})[repo]) || (color.startsWith("#") ? color : (MARK[color] ?? t[color]));
    return h_flex().size(size).flex_none().rounded(size > 16 ? 5 : 4).bg(fill).items_center().justify_center().text_size(size > 16 ? 10.5 : 9.5).font_bold().text_color("#ffffff").child([...(label ?? "")][0]?.toUpperCase() ?? "?");
  }

  // Indent guides, as a file tree draws them: a hairline down from the repo's avatar
  // through everything in its group, and one down from a worktree's icon through its
  // terminals. `levels`: which of the two this row is under; `shift`: how far the row sits
  // in from the list's edge (a card's inset), so the lines stay straight. Rows touch, so
  // they join up.
  guides(el, levels, t, shift = 0) {
    // The muted text color, faint (the theme's border is too close to the sidebar to show).
    const line = (left) => div().absolute().left(left).top(0).h_full().w(1).bg(t.muted).opacity(0.35);
    return el.when(levels >= 1, (el) => el.child(line(GUIDE[0] - shift))).when(levels >= 2, (el) => el.child(line(GUIDE[1] - shift)));
  }

  // A repo's header, as Orca groups a project: its avatar and name, and on hover its
  // sessions and New worktree; the fold button at the end. Clicking it folds or unfolds the
  // repo; dragging it moves the repo; right-click is its main checkout's space menu. The
  // main checkout itself is the first row under it (see row, `primary`).
  headerRow({ w, i, g, fold, status }, t) {
    const key = `h:${w.id}`;
    const toggle = () => fold?.toggle();
    return this.draggable(v_flex().relative().id(`repo-${w.id}`).px(8).h(26).mt(12).flex_none().justify_center().rounded(7)
      .hover((s) => s.bg(t.hover)), w, i, toggle, t, g.name || w.name)
      .on_mouse_down("right", () => this.menu(w))
      .on_hover(this.hover(key))
      .child(h_flex().gap(10).items_center()
        // The letter of what it says (the repo), also when it hangs from a worktree's space.
        .child(this.avatar(w, t, 16, g.name || w.name, g.repo))
        .child(div().flex_1().min_w(0).truncate().text_size(12).font_semibold().text_color(this.hovered === key ? t.foreground : t.muted).child(g.name || w.name))
        // Folded away, an agent in it that needs you or finished still shows here.
        .when(Boolean(fold?.folded && status), (el) => el.child(this.glyph(status, t)))
        .when(this.hovered === key, (el) => el.child(this.rowButton(`space-sessions-${w.id}`, "clock", "Sessions…", () => this.sessions(w, g), false, t)))
        .when(this.hovered === key, (el) => el.child(this.rowButton(`repo-clean-${w.id}`, "mods/spaces-plus/clean.svg", "Clean up merged worktrees…", () => this.askClean(g), false, t)))
        .when(this.hovered === key, (el) => el.child(this.worktreeButton(w, false, t)))
        .when(Boolean(fold), (el) => el.child(this.foldButton(`fold-repo-${w.id}`, fold, false, t, true))));
  }

  // A space's row. Top (tree null): a space outside any repo group (not git, or a worktree
  // whose repo isn't open), with its avatar. Nested (tree): a worktree under its repo's
  // header, or with `primary` the repo's main checkout, named after its branch and marked
  // "primary". Nested rows show their agent's state at the end.
  row({ w, i, g, tree, fold, primary, card }, t) {
    const on = w.active;
    // A worktree's row (nested, or one whose repo isn't open): its own menu and badges.
    const wt = g?.linked ? { path: g.top, meta: metaOf(w.machine, g.top) } : primary ? { path: g.top, meta: metaOf(w.machine, g.top), primary: true } : null;
    const name = primary ? (g.branch ?? "detached") : w.name;
    // Nested: a worktree's branch icon (the main checkout's folder); its agent's state goes
    // at the row's end. Top: the avatar, as small as a header's.
    const lead = tree
      ? h_flex().pl(22).flex_none().items_center()
        .child(div().w(13).flex_none().flex().items_center().justify_center()
          .child(svg(`mods/workspace-chrome/${primary ? "folder" : "branch"}.svg`).size(13).text_color(on ? t.muted : t.dim)))
      : this.avatar(w, t, 16);
    // Brightest for the shown space; the others step back so the list reads as names. A top
    // row (a space outside any repo) reads like a header beside them.
    const ink = on || (!tree && this.hovered === w.id) ? t.foreground : t.muted;
    const focus = on || this.hovered === w.id;
    const select = () => {
      if (wt) clearUnread(w.machine, wt.path);
      run("space.select", { id: w.id });
    };
    // Detailed cards (the sidebarCards option, as Orca's): a worktree's branch, ahead/behind and
    // badges go on a second line under its name, instead of after it.
    const detailed = option("sidebarCards") === "detailed" && Boolean(tree) && Boolean(g);
    // Detailed: the branch has its own place on the second line, so the tail keeps to the rest.
    const tail = g ? this.gitTail(g, tree, primary ? name : w.name, t, detailed || (Boolean(tree) && !focus)) : null;
    const marks = wt ? this.badges({ ...wt.meta, pr: this.prFor(g.repo, g.branch, wt.meta) }, t, w.id, this.ports[g.top] ?? []) : null;
    const el = this.guides(v_flex().relative().id(`space-${primary ? "main-" : ""}${w.id}`).px(8).h(detailed ? 44 : 26).mt(tree || card ? 0 : 12).flex_none().justify_center().rounded(7)
      .when(on && !card, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover))), tree && g && (primary || g.linked) ? 1 : 0, t);
    // The main checkout's row moves with its header, not by itself.
    // The main checkout's row moves with its header, and a worktree's keeps the sort's place.
    return (tree ? el.cursor_pointer().on_click(select) : this.draggable(el, w, i, select, t))
      .on_mouse_down("right", () => (wt ? this.wtMenu(w, wt.path, g.branch, w.id, wt.primary) : this.menu(w)))
      .when(Boolean(wt?.meta.comment), (el) => el.tooltip(wt.meta.comment))
      .on_hover(this.hover(w.id))
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .child(lead)
          .child(div().flex_shrink(1).min_w(0).max_w(150).truncate().text_color(ink).when(!tree, (el) => el.text_size(12).font_semibold()).child(name))
          // "primary" marks the repo's own checkout (the original clone, not a worktree), as
          // Orca calls it; "main" would read as the branch.
          .when(primary, (el) => el.child(div().id(`primary-${w.id}`).flex_none().text_size(11).text_color(t.dim).tooltip("Primary checkout: the original clone, not a worktree").child("primary")))
          // Removed outside Herdr while an agent here still works (see vanished).
          .when(Boolean(g?.gone), (el) => el.child(div().id(`gone-${w.id}`).flex_none().text_size(11).text_color(t.blocked).tooltip("Its folder is gone: removed outside Herdr. The space closes once nothing here is working.").child("removed")))
          .when(Boolean(wt?.meta.pinned), (el) => el.child(svg("mods/workspace-chrome/pin.svg").size(10).flex_none().text_color(t.dim)))
          .when(!detailed, (el) => el.child(tail ?? div().flex_1()).when(Boolean(marks), (el) => el.child(marks)))
          .when(detailed, (el) => el.child(div().flex_1()))
          // Its agent's state, unless its terminals are open below and each shows its own.
          .when(Boolean(tree) && (!fold || fold.folded) && Boolean(this.glyph(w.status, t)), (el) => el.child(this.glyph(w.status, t)))
          // A top row that is a repo's main checkout (a repo not grouped): its sessions and New worktree.
          .when(this.hovered === w.id && Boolean(g) && !tree && !g.linked, el => el.child(this.rowButton(`space-sessions-${w.id}`, "clock", "Sessions…", () => this.sessions(w, g), on, t)))
          .when(this.hovered === w.id && Boolean(g) && !tree, el => el.child(this.worktreeButton(w, on, t)))
          .when(this.hovered === w.id && Boolean(tree) && Boolean(g), (el) => el.child(this.rowButton(`space-term-${primary ? "main-" : ""}${w.id}`, "plus", "New terminal here…", () => this.newTerminal(w, g.top, w.id), on, t)))
          .when(Boolean(fold), (el) => el.child(this.foldButton(`fold-${primary ? "main-" : ""}${w.id}`, fold, on, t))),
      )
      // Detailed: the second line, under the name, its branch first (not for the primary
      // checkout, whose name is its branch), the badges ending where the state above does.
      .when(detailed, (el) => el.child(this.cardLine(t, primary ? null : g.branch ?? "detached", tail, [marks], Boolean(fold))));
  }

  // A detailed card's second line (row, ghostRow): under the name (past the icon), its branch,
  // what else (tail), then the badges at the right, ending under the state mark above it:
  // before the fold button's place when the row has one, so the columns line up.
  cardLine(t, branch, tail, ends, folded) {
    return h_flex().pl(22 + 13 + 9).pr(folded ? 25 : 0).gap(6).items_center().min_w(0).text_size(11)
      .when(Boolean(branch), (el) => el.child(div().flex_shrink(1).min_w(0).max_w(150).truncate().text_color(t.dim).child(branch)))
      .child(tail ?? div().flex_1())
      .children(ends.filter(Boolean));
  }

  // A checkout under its repo that no space is in: dimmed, laid out like a nested
  // worktree row, with its display name and badges. Click opens it; right-click is the
  // worktree menu; no drag (it isn't a space yet).
  // With `primary` it is the repo's main checkout (no space at it while a worktree is open):
  // its folder icon, its branch and "primary", as the open one's row.
  ghostRow({ w, g, ghost, meta, primary }, t) {
    const name = primary ? (ghost.branch ?? "detached") : meta?.name || base(ghost.path);
    // Asleep (see sleep): "sleeping" and how many sessions wait; their titles on hover.
    const z = (shared(SLEEP) ?? {})[metaKey(w.machine, ghost.path)];
    const branch = ghost.branch ?? "detached";
    const same = branch.toLowerCase() === name.toLowerCase() || branch.split("/").pop().toLowerCase() === name.toLowerCase();
    // Detailed cards (see row): its branch, sleeping and badges on a second line, as an open one's.
    const detailed = option("sidebarCards") === "detailed";
    const marks = this.badges({ ...(meta ?? {}), pr: this.prFor(g?.repo, ghost.branch, meta) }, t, ghost.path, this.ports[ghost.path] ?? []);
    const sleeping = z ? div().flex_none().text_size(11).text_color(t.muted).child(`sleeping${z.sessions.length ? ` · ${z.sessions.length}` : ""}`) : null;
    return this.guides(v_flex().relative(), 1, t)
      .id(`space-ghost-${ghost.path}`)
      .px(8)
      .h(detailed ? 44 : 26)
      .flex_none()
      .justify_center()
      .rounded(7)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .tooltip(z ? `Asleep since ${new Date(z.at).toLocaleString()}${z.sessions.length ? `: opening it resumes\n${z.sessions.map((x) => `· ${x.title || x.agent}`).join("\n")}` : ""}` : meta?.comment ? `${meta.comment}\n${ghost.path}` : `Open ${ghost.path}`)
      .on_click(() => this.openWorktree(w, ghost))
      .on_mouse_down("right", () => this.wtMenu(w, ghost.path, ghost.branch, null, Boolean(primary)))
      .on_hover(this.hover(`g:${ghost.path}`))
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .pl(22)
          .child(div().w(13).flex_none().flex().items_center().justify_center().child(svg(`mods/workspace-chrome/${primary ? "folder" : "branch"}.svg`).size(13).text_color(t.dim).opacity(0.5)))
          .child(div().flex_shrink(1).min_w(0).max_w(150).truncate().text_color(this.hovered === `g:${ghost.path}` ? t.muted : t.dim).child(name))
          .when(Boolean(primary), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).opacity(0.7).child("primary")))
          .when(Boolean(meta?.pinned), (el) => el.child(svg("mods/workspace-chrome/pin.svg").size(10).flex_none().text_color(t.dim)))
          // Its branch, on hover only (see gitTail's quiet rows).
          .child(h_flex().flex_1().min_w(0).justify_end().text_size(11).text_color(t.dim)
            .when(!detailed && !same && this.hovered === `g:${ghost.path}`, (el) => el.child(div().min_w(0).truncate().child(branch))))
          .when(!detailed && Boolean(sleeping), (el) => el.child(sleeping))
          .when(!detailed, (el) => el.child(marks))
          .when(this.hovered === `g:${ghost.path}`, (el) => el.child(this.rowButton(`ghost-term-${ghost.path}`, "plus", "Open with a terminal or agent…", () => this.newTerminal(w, ghost.path, null, meta?.name), false, t))),
      )
      .when(detailed, (el) => el.child(this.cardLine(t, same ? null : branch, null, [sleeping, marks], false)));
  }

  // One terminal of a space, under its row: the program's icon, what it's doing (an
  // agent's title, else the program), its tab when the space has several, its state.
  // Click goes to it (its space, tab and pane); right-click is Herdr's pane menu.
  termRow({ w, term: p, tab, depth, card }, t) {
    // What it's doing: an agent's title, else the program (zsh, npm, nvim). A terminal
    // nobody titled is called by its address (t16): that names nothing.
    const a = agents().find((x) => x.pane === p.pane);
    const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}~/]+/u, "").trim();
    const named = (s) => Boolean(s) && !/^t[0-9a-z]+$/i.test(s) && s !== p.terminal;
    const title = clean(a?.title);
    const label = named(title) ? title : !p.program?.shell && named(clean(p.title)) && p.program?.key === "program" ? clean(p.title) : p.program?.name || "terminal";
    const several = (w.tabs ?? []).filter((x) => !x.settled).length > 1;
    const tag = several ? (tab.named ? tab.name : `tab ${tab.index}`) : "";
    const on = w.active && tab.active && p.focused;
    const pic = p.program?.icon ? (p.program.tint ? svg(p.program.icon).size(12).text_color(on ? t.foreground : t.muted) : image(p.program.icon).w(12).h(12)) : svg("icons/shell.svg").size(12).text_color(t.muted);
    const grouped = depth === 2;
    // In the shown space's card a row sits 4 px in from the card's sides, so the focused
    // one's background reads as a highlight inside the card (the icon column stays put).
    const inset = card ? 4 : 0;
    const row = this.guides(h_flex().relative(), grouped ? 2 : 1, t, inset).id(`term-${p.pane}`).h(24).flex_none().mx(inset).pl(8 + 22 + (depth - 1) * INDENT - inset).pr(8 - inset).gap(9).items_center().rounded(card ? 5 : 7)
      .cursor_pointer().when(on, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover))
      .on_click(() => run("pane.focus", { pane: p.pane }))
      .on_mouse_down("right", () => openOverlay({ mod: "menu", kind: "popup", width: 220, height: 260, props: { tab: "pane", target: { pane: p.pane, terminal: p.terminal } } }))
      .child(div().w(13).flex_none().flex().items_center().justify_center().child(pic))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(on ? t.foreground : t.muted).child(label))
      .when(Boolean(tag), (el) => el.child(div().flex_none().text_size(10.5).text_color(t.dim).child(tag)))
      .child(this.glyph(shownStatus(p.status, (shared(AGENT_INFO) ?? {})[p.terminal]), t) ?? div().w(7).flex_none());
    // Detailed cards: under an agent, what it's doing, asks or last said (agents-plus's
    // ag.info), as Orca's agent rows, with how long ago it changed.
    const info = (shared(AGENT_INFO) ?? {})[p.terminal];
    const news = option("sidebarCards") === "detailed" && option("sidebarAgentNews") && info
      ? (p.status === "done" || p.status === "idle" ? info.said : info.doing) : null;
    if (!news) return row;
    return v_flex().flex_none()
      .child(row)
      .child(this.guides(h_flex().relative(), grouped ? 2 : 1, t, inset).h(17).flex_none().mx(inset).pl(8 + 22 + (depth - 1) * INDENT - inset + 13 + 9).pr(8 - inset).gap(6).items_center().text_size(11)
        .child(div().flex_1().min_w(0).truncate().text_color(p.status === "blocked" ? t.blocked : t.dim).child(`${p.status === "working" ? "▸" : p.status === "blocked" ? "?" : "✓"} ${news}`))
        .when(Boolean(info.at), (el) => el.child(div().flex_none().text_color(t.dim).child(ago(info.at)))));
  }

  compact({ w, i }, t) {
    return h_flex()
      .id(`space-${w.id}`)
      .h(26)
      .flex_none()
      .justify_center()
      .gap(4)
      .when(w.active, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .cursor_pointer()
      .on_click(() => run("space.select", { id: w.id }))
      .child(div().text_color(w.active ? t.foreground : t.muted).child(String(i + 1)))
      .child(div().text_color(tone(t, w.status)).child(glyph(w.status)));
  }

  render() {
    const t = theme();
    const collapsed = narrow();
    this.reveal();
    this.publish();
    this.markSeen();
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = c => Object.values(kept).filter(v => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    return v_flex().relative().size_full().min_h(0).bg(t.chrome).text_size(13)
      .on_mouse_move((e, cx) => this.dragMove(e, cx))
      .on_mouse_up("left", (_e, cx) => this.endDrag(cx))
      .child(h_flex().h(31).pl(16).pr(10).items_center().justify_between().text_size(11.5).text_color(t.dim)
        .when(!collapsed, el => el.child("Spaces"))
        .when(!collapsed, el => el.child(div().flex_1()))
        .when(!collapsed, el => el.child(h_flex().id("space-sort").h(22).px(6).gap(4).items_center().rounded(6).cursor_pointer()
          .hover(s => s.bg(t.hover).text_color(t.foreground)).tooltip("Order worktrees by")
          .on_click(() => openOverlay({ mod: "wt-menu", kind: "popup", width: 190, height: 200, props: { mode: "sort" } }))
          .child(svg("mods/workspace-chrome/layers.svg").size(12))
          .child((SORTS.find(([id]) => id === (shared(SORT) ?? "activity")) ?? SORTS[0])[1])))
        // What to open, one click each: a folder, a terminal, a worktree of the shown repo.
        .child(this.addButtons(t)))
      .child(this.scroller(t, collapsed))
      .when(this.dragging && Boolean(this.dragAt && this.dragLabel), (el) => el.child(this.dragPreview(t)));
  }
}
