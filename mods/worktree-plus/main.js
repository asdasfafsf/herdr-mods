// Worktree dialog: { space, action: "new" | "open" | "remove" } or
// { folder, machine } for a repo without a space; optional { branch, tab, argv }, and for
// New worktree { name, base, link } to fill the form in. Create calls createWorktree
// (lib/worktree.js), which an agent's `hm new` calls too (spaces-plus create@).
// { folder, action: "clean", request? }: Clean up, the repo's worktrees whose work is done.
//
// worktree-plus (herdr-mods): a clone of the shipped `worktree`. Its New worktree is
// the Orca-style form: a display name (any language), the branch (follows the name until
// edited), the base (default the remote's HEAD, fetched first; `#123` or a PR URL checks
// out that pull request's branch), a link (issue, ticket or URL), an agent to start in
// the first terminal and its first message. What it knows about each checkout goes in
// shared("wt.meta") (see META), which the `spaces-plus` sidebar shows.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, Scrollbar } from "gpui-base";
import { run, props, closeOverlay, theme, spaces, panes, exec, home, knownAgents, shared, setShared, notify } from "herdr";
import { button, footer } from "./ui.js";
import { TREES, answer } from "./state.js";
import { META, metaKey, setMeta, REPOS, KNOWN, LAST_AGENT, folderName, prNumber, ROOT, git, repoOf, defaultBase, includeFile, createWorktree, removeWorktree, cleanupCandidates, nameFrom, short } from "./worktree.js";

// A command to suggest for setup, by the lock file the repo has.
const SUGGEST = [["pnpm-lock.yaml", "pnpm install"], ["yarn.lock", "yarn install"], ["package-lock.json", "npm ci"], ["bun.lockb", "bun install"], ["uv.lock", "uv sync"], ["poetry.lock", "poetry install"], ["Pipfile.lock", "pipenv install"], ["Gemfile.lock", "bundle install"], ["go.sum", "go mod download"], ["Cargo.lock", "cargo fetch"]];
// Where a space is now: its first terminal's live folder, else where it was made.
function place(s) {
  if (!s) return null;
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || null;
}

// Home as ~ (git says C:/Users/x where Windows says C:\Users\x).
const tilde = (path, userHome) => {
  const [p, h] = [path, userHome].map((s) => s.replace(/\\/g, "/"));
  return p.startsWith(h) ? `~${p.slice(h.length)}` : path;
};
const ago = (s) => {
  const d = Date.now() / 1000 - s;
  return d < 3600 ? `${Math.max(1, Math.round(d / 60))}m` : d < 86400 ? `${Math.round(d / 3600)}h` : d < 86400 * 60 ? `${Math.round(d / 86400)}d` : `${Math.round(d / 86400 / 30)}mo`;
};

// Every checkout of a repo (`git worktree list`), the main one first, then
// the most recently committed: { path, branch, main, at }.
async function checkouts(repo, on) {
  const list = await git(repo.main, ["worktree", "list", "--porcelain"], on);
  if (!list.ok) return [];
  const refs = await git(repo.main, ["for-each-ref", "--format=%(refname:short)%09%(committerdate:unix)", "refs/heads"], on);
  const when = new Map(refs.out.split("\n").map((l) => l.split("\t")).map(([b, at]) => [b, Number(at) || 0]));
  const out = [];
  for (const block of list.out.split(/\n\n+/)) {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
    if (!path || lines.some((l) => l === "bare" || l.startsWith("prunable"))) continue;
    const branch = lines.find((l) => l.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? null;
    out.push({ path, branch, main: out.length === 0, at: branch ? (when.get(branch) ?? 0) : 0 });
  }
  return out.sort((a, b) => b.main - a.main || b.at - a.at);
}

// The space showing a checkout: its first terminal is in it (the deepest checkout wins).
function spaceOf(path, all, on) {
  const inside = (p, dir) => p === dir || p.startsWith(dir + "/");
  return spaces().find((s) => (s.machine ?? null) === (on ?? null) && (() => {
    const at = place(s)?.replace(/\\/g, "/");
    if (!at || !inside(at, path)) return false;
    return !all.some((c) => c.path !== path && c.path.length > path.length && inside(at, c.path));
  })());
}

// The submodule repos git keeps for a checkout (nested ones too, checked out
// or not): { name, dir, pinned }. `config` is the args that read its
// .gitmodules; `pinned` is the commit its parent records ("" if none).
async function modules(gitDir, config, on, out = [], parent = "") {
  const keys = await git(gitDir, ["--git-dir", gitDir, "config", ...config, "-z", "--get-regexp", "^submodule\\..*\\.path$"], on);
  if (!keys.ok) return out; // no .gitmodules, or no submodules in it
  // -z: "key\nvalue" records ended by NUL, so names and paths may hold spaces.
  for (const record of keys.out.split("\0").filter(Boolean)) {
    const at = record.indexOf("\n");
    const name = record.slice("submodule.".length, at - ".path".length);
    const dir = `${gitDir}/modules/${name}`;
    if (!(await git(gitDir, ["--git-dir", dir, "rev-parse", "--git-dir"], on)).ok) continue; // never checked out
    const pinned = await git(gitDir, ["--git-dir", gitDir, "rev-parse", `HEAD:${record.slice(at + 1)}`], on);
    // Names are only unique within their parent: nested ones carry its name.
    out.push({ name: parent + name, dir, pinned: pinned.ok ? pinned.out : "" });
    if ((await git(gitDir, ["--git-dir", dir, "cat-file", "-e", "HEAD:.gitmodules"], on)).ok) await modules(dir, ["--blob", "HEAD:.gitmodules"], on, out, `${parent + name}/`);
  }
  return out;
}

// The worktree's submodules, and the names of those with commits that exist
// nowhere else: not on a remote, and not the commit the parent pins (git
// fetches that by hash, so it is often on no remote branch here).
async function submodules(top, on) {
  const gitDir = await git(top, ["rev-parse", "--absolute-git-dir"], on);
  if (!gitDir.ok) throw new Error(gitDir.err || "git rev-parse failed.");
  const mods = await modules(gitDir.out, ["--file", `${top}/.gitmodules`], on);
  const unpushed = [];
  for (const m of mods) {
    const local = await git(gitDir.out, ["--git-dir", m.dir, "rev-list", "-n1", "--all", "--not", "--remotes", ...(m.pinned ? [m.pinned] : [])], on);
    if (!local.ok) throw new Error(local.err || `Couldn't check submodule ${m.name}.`);
    if (local.out) unpushed.push(m.name);
  }
  return { mods, unpushed };
}

export default class Worktree extends View {
  init(_props, cx) {
    this.on = this.space()?.machine;
    this.userHome = this.on ? null : home();
    this.opening = props()?.action === "open";
    // `name` / `base` fill the New worktree form (picker-plus passes what was typed);
    // `branch` makes one at once, as the shipped dialog does.
    this.text = props()?.name ?? props()?.branch ?? "";
    this.list = undefined; // open: the checkouts, once read
    this.at = 0;
    this.input = InputState.new({ value: this.text, placeholder: this.opening ? "filter worktrees" : "name, e.g. 셀프신고-파일-검증" });
    this.input.on("change", (_e, cx) => {
      this.text = this.input.value();
      this.error = "";
      this.at = 0;
      // Typed by the person (a set_value sends no change): ours to fill no more.
      this.nameAuto = false;
      this.nameFromLabel = null;
      // The branch follows the name until someone edits it.
      if (!this.branchEdited) { this.syncing = true; this.branch.set_value(folderName(this.text)); this.syncing = false; }
      cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.go(cx));
    this.focusedField = "name";
    this.input.on("focus", (_e, cx) => { this.focusedField = "name"; cx.notify(); });
    this.input.on("blur", (_e, cx) => { if (this.focusedField === "name") this.focusedField = null; cx.notify(); });
    // The New worktree form's other fields (see renderNew).
    this.branchEdited = Boolean(props()?.branch);
    this.nameAsk = 0; // the latest name lookup (see lookName)
    this.nameAuto = false;
    this.nameFromLabel = null;
    this.branch = InputState.new({ value: props()?.branch ?? folderName(props()?.name ?? ""), placeholder: "branch (default: the name)" });
    this.base = InputState.new({ value: "", placeholder: "base" });
    this.link = InputState.new({ value: props()?.link ?? "", placeholder: "link: issue, ticket or URL (optional)" });
    this.prompt = TextareaState.new({ value: "", placeholder: "first message for the agent (optional)", rows: 3 });
    this.setup = InputState.new({ value: "", placeholder: "setup command (optional)" });
    this.include = InputState.new({ value: "", placeholder: "also copy: .env, config/local.json" });
    this.includeFile = []; // the repo's .worktreeinclude patterns, read with the repo
    this.suggest = null; // a setup command for the repo's lock file
    for (const [name, state] of [["branch", this.branch], ["base", this.base], ["link", this.link], ["prompt", this.prompt], ["setup", this.setup], ["include", this.include]]) {
      state.on("focus", (_e, cx) => { this.focusedField = name; cx.notify(); });
      state.on("blur", (_e, cx) => { if (this.focusedField === name) this.focusedField = null; cx.notify(); });
      state.on("change", (_e, cx) => {
        if (name === "branch" && !this.syncing) this.branchEdited = true;
        if (name === "base" || name === "link") this.lookName(cx);
        this.error = "";
        cx.notify();
      });
      // Enter creates from a one-line field; the first message's box takes ⌘↵ (Enter is a new line there).
      state.on("submit", (e, cx) => { if (name !== "prompt" || e?.secondary) this.go(cx); });
    }
    this.defaultBase = null; // the remote's HEAD (origin/develop), read with the repo
    const where = this.space()?.machine ?? "";
    this.agents = (shared(KNOWN)?.[where] ?? []).filter((a) => a.installed);
    this.agent = props()?.argv ? null : (shared(LAST_AGENT) ?? null); // an agent's key, null: just a shell
    if (props()?.action !== "remove") {
      this.input.focus();
      cx.timer.after(600, () => this.input.focus());
    }
    this.busy = false;
    this.error = "";
    this.repo = undefined; // undefined: looking, null: not in git
    this.dirty = false;
    this.unpushed = [];
    this.handle = cx.focus_handle();
    if (props()?.action === "remove") this.handle.focus();
    cx.spawn(async (cx) => {
      try {
        if (this.on) {
          let result;
          try { result = await exec("sh", ["-c", 'printf %s "$HOME"'], { on: this.on }); } catch {}
          if (!result || result.code !== 0 || !result.stdout.trim()) result = await exec("powershell.exe", ["-NoProfile", "-Command", "[Console]::Write($HOME)"], { on: this.on });
          if (result.code !== 0 || !result.stdout.trim()) throw new Error("Could not find the remote home folder.");
          this.userHome = result.stdout.trim().replace(/\\/g, "/");
        }
        this.folder = props()?.folder || place(this.space()) || this.userHome;
        // The repo is set last: Enter does nothing until the warnings it consents to are known.
        const repo = await repoOf(this.folder, this.on);
        if (repo && props().action === "clean") await this.findClean(repo, cx);
        if (repo && props().action === "remove") {
          this.dirty = (await git(repo.top, ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"], this.on)).out !== "";
          this.unpushed = (await submodules(repo.top, this.on)).unpushed;
        }
        if (repo && this.opening) this.list = await checkouts(repo, this.on);
        if (repo && props().action === "new") {
          // The form shows as soon as the repo is known; the base, the setup suggestion and
          // the installed agents fill in after (the agents are cached from the last look).
          const saved = (shared(REPOS) ?? {})[metaKey(this.on, repo.main)] ?? {};
          this.setup.set_value(saved.setup ?? "");
          this.include.set_value(saved.include ?? "");
          this.defaultBase = await defaultBase(repo, this.on);
          this.base.set_value(props().base || this.defaultBase);
          this.repo = repo;
          cx.notify();
          // Opened with a PR or a link and no name (⌘P with a PR pasted): name it from that.
          if (!this.text.trim() && (props().base || props().link)) this.lookName(cx);
          // One listing of the main checkout: its .worktreeinclude and lock files.
          const ls = await exec("ls", ["-a", repo.main], { on: this.on }).catch(() => null);
          const names = new Set((ls?.stdout ?? "").split("\n"));
          this.suggest = SUGGEST.find(([file]) => names.has(file))?.[1] ?? null;
          if (names.has(".worktreeinclude")) {
            this.includeFile = await includeFile(repo, this.on);
          }
          cx.notify();
          try {
            const where = this.on ?? "";
            const all = await knownAgents({ on: this.on });
            setShared(KNOWN, { ...shared(KNOWN), [where]: all });
            this.agents = all.filter((a) => a.installed);
          } catch {}
          if (this.agent && !this.agents.some((a) => a.key === this.agent)) this.agent = null;
        }
        this.repo = repo;
        cx.notify();
        if (props().branch) await this.work(cx);
      } catch (error) { this.repo = null; this.error = String(error); cx.notify(); }
    });
  }

  space() {
    const p = props() ?? {};
    return spaces().find((s) => s.id === p.space) ?? (p.folder ? { folder: p.folder, machine: p.machine ?? null, name: "" } : undefined);
  }

  close() {
    closeOverlay(props().overlay);
  }

  // A PR or an issue in Base or Link, while the name is empty or one we filled: its title
  // as the name (a PR's branch as the branch, unless that was typed), from gh, half a second
  // after the typing stops (see nameFrom in lib/worktree.js).
  lookName(cx) {
    if (!this.repo || (this.text.trim() && !this.nameAuto)) return;
    const ask = ++this.nameAsk;
    cx.timer.after(500, (cx) => cx.spawn(async (cx) => {
      if (ask !== this.nameAsk || (this.text.trim() && !this.nameAuto)) return;
      const found = await nameFrom({ base: this.base.value(), link: this.link.value(), top: this.repo.top, on: this.on });
      if (ask !== this.nameAsk || (this.text.trim() && !this.nameAuto)) return;
      if (!found) { if (this.nameAuto) { this.input.set_value(""); this.text = ""; this.nameAuto = false; this.nameFromLabel = null; } return cx.notify(); }
      this.input.set_value(found.name);
      this.text = found.name;
      this.nameAuto = true;
      this.nameFromLabel = found.from;
      if (!this.branchEdited) { this.syncing = true; this.branch.set_value(found.branch ?? short(folderName(found.name))); this.syncing = false; }
      cx.notify();
    }));
  }

  go(cx) {
    if (this.busy || !this.repo) return;
    cx.spawn(async (cx) => this.work(cx));
  }

  async work(cx) {
    if (this.busy || !this.repo) return;
    this.busy = true;
    this.error = "";
    cx.notify();
    try { this.error = props().action === "remove" ? await this.remove() : props().action === "clean" ? await this.cleanUp(cx) : await this.create(); }
    catch (error) { this.error = String(error); }
    this.busy = false;
    if (!this.error) this.close();
    cx.notify();
  }

  // Create: what the form says, made by createWorktree (lib/worktree.js: which commit it
  // starts from, where it goes, what readies it), the one an agent's `hm new` calls too.
  // "" when made, else why not.
  async create() {
    // From the field itself: a syllable still being composed (Korean IME) may not have
    // reported a change yet.
    this.text = this.input.value();
    const p = props();
    try {
      await createWorktree({
        repo: this.repo, on: this.on, userHome: this.userHome, name: this.text,
        branch: this.branch.value(), branchEdited: this.branchEdited,
        base: this.base.value().trim() || this.defaultBase || "HEAD", link: this.link.value(),
        agent: this.agent, agents: this.agents, prompt: this.prompt.value(),
        setup: this.setup.value(), include: this.include.value(), includeFile: this.includeFile,
        argv: p.argv, tab: p.tab,
      });
      return "";
    } catch (error) { return String(error?.message ?? error); }
  }

  shown() {
    const f = this.text.trim().toLowerCase();
    return (this.list ?? []).filter((c) => !f || `${c.branch ?? ""} ${c.path}`.toLowerCase().includes(f));
  }

  open(c) {
    if (!c) return;
    this.close();
    const s = spaceOf(c.path, this.list, this.on);
    if (s) run("space.select", { id: s.id });
    else run("space.new", { folder: c.path, machine: this.on });
  }

  async remove() {
    const s = this.space();
    const status = await git(this.repo.top, ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"], this.on);
    if (!status.ok) return status.err || "git status failed.";
    // git refuses a worktree with submodules unless forced, because their
    // history goes with it. The popup already showed what's at risk; only
    // risk that appeared since it opened gets one more warning.
    const { mods, unpushed } = await submodules(this.repo.top, this.on);
    const changed = (status.out && !this.dirty) || unpushed.some((name) => !this.unpushed.includes(name));
    this.dirty ||= status.out !== "";
    this.unpushed = [...new Set([...this.unpushed, ...unpushed])];
    if (changed) return "It changed since this opened. Enter again removes it anyway.";
    try {
      await removeWorktree({ repo: this.repo, on: this.on, space: s?.id, force: this.dirty || mods.length > 0 });
      return "";
    } catch (error) { return String(error?.message ?? error); }
  }

  key(e, cx) {
    if (e.key === "escape") return this.close();
    // New worktree: Tab and Shift-Tab go round the form's fields.
    if (e.key === "tab" && props()?.action === "new") {
      const order = [["name", this.input], ["branch", this.branch], ["base", this.base], ["link", this.link], ["setup", this.setup], ["include", this.include], ...(this.agent ? [["prompt", this.prompt]] : [])];
      const at = Math.max(0, order.findIndex(([n]) => n === this.focusedField));
      order[(at + (e.modifiers?.shift ? order.length - 1 : 1)) % order.length][1].focus();
      cx.stop_propagation();
      return cx.notify();
    }
    if (this.opening) {
      const n = this.shown().length;
      if (e.key === "enter") this.open(this.shown()[this.at]);
      else if ((e.key === "down" || e.key === "up") && n) this.at = (this.at + (e.key === "down" ? 1 : n - 1)) % n;
      else return;
      cx.stop_propagation();
      return cx.notify();
    }
    if (e.key === "enter" && (props()?.action === "remove" || props()?.action === "clean")) return this.go(cx);
    // New worktree: the one-line fields submit on Enter themselves (see init). Elsewhere in
    // the form (after picking an agent, focus is on no field) Enter creates too, and ⌘↵ does
    // from anywhere, the first message's box included, where Enter is a new line.
    if (e.key === "enter" && props()?.action === "new" && (e.modifiers?.platform || this.focusedField === null)) {
      cx.stop_propagation();
      return this.go(cx);
    }
  }

  // Clean up (action "clean"): the repo's worktrees whose work is done (cleanupCandidates in
  // lib/worktree.js), the picked ones removed as Remove removes them, one after another.
  // `request` (hm clean): what was found goes to shared("wt.results")[request].
  async findClean(repo, cx) {
    const entry = Object.values(shared(TREES) ?? {}).find((r) => (r.checkouts ?? []).some((c) => c.main && c.path === repo.main));
    const list = entry?.checkouts ?? (await checkouts(repo, this.on));
    // Where an agent is at work or waiting: a space in that checkout with such a pane.
    const ps = panes();
    const busy = new Set();
    for (const s of spaces().filter((x) => (x.machine ?? null) === (this.on ?? null))) {
      const at = place(s);
      const c = list.find((c) => at && (at === c.path || at.startsWith(`${c.path}/`)));
      const tabs = new Set((s.tabs ?? []).map((tab) => tab.id));
      if (c && ps.some((p) => tabs.has(p.tab) && (p.status === "working" || p.status === "blocked"))) busy.add(c.path);
    }
    try {
      this.found = await cleanupCandidates({ main: repo.main, on: this.on, checkouts: list, busy });
      this.picked = new Set(this.found.filter((f) => f.ok).map((f) => f.path));
    } catch (error) { this.found = []; this.error = String(error?.message ?? error); }
    answer(props()?.request, { ok: !this.error, error: this.error || null, found: this.found.map(({ name, branch, path, why, ok, stop }) => ({ name, branch, path, why, picked: ok, stop })) });
    cx.notify();
  }

  async cleanUp(cx) {
    const go = (this.found ?? []).filter((f) => this.picked?.has(f.path));
    if (!go.length) return "Nothing picked.";
    const failed = [];
    this.done = [];
    for (const f of go) {
      const repo = await repoOf(f.path, this.on);
      const s = spaces().find((x) => (x.machine ?? null) === (this.on ?? null) && (place(x) === f.path || place(x)?.startsWith(`${f.path}/`)));
      try { await removeWorktree({ repo, on: this.on, space: s?.id, prMerged: f.prMerged }); this.done.push(f.path); }
      catch (error) { failed.push(`${f.name}: ${String(error?.message ?? error)}`); }
      cx.notify();
    }
    return failed.length ? `Removed ${this.done.length}; not ${failed.length}:\n${failed.join("\n")}` : "";
  }

  renderClean(t) {
    const found = this.found;
    const n = (found ?? []).filter((f) => this.picked?.has(f.path)).length;
    const row = (f) => {
      const on = this.picked?.has(f.path);
      const gone = this.done?.includes(f.path);
      const locked = Boolean(f.stop) && f.stop !== "pinned";
      return h_flex().id(`clean-${f.path}`).gap(10).px(8).py(6).items_center().rounded(6)
        .when(!locked && !this.busy, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { on ? this.picked.delete(f.path) : this.picked.add(f.path); cx.notify(); }))
        .when(locked || gone, (el) => el.opacity(0.5))
        .child(svg(`mods/workspace-chrome/${on ? "circle-check" : "square"}.svg`).size(14).flex_none().text_color(on ? t.accent : t.dim))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(h_flex().gap(8).items_center()
            .child(div().flex_shrink(1).min_w(0).truncate().text_color(t.foreground).child(f.name))
            .when(f.branch !== f.name, (el) => el.child(div().flex_shrink(1).min_w(0).truncate().text_size(11).text_color(t.dim).child(f.branch))))
          .child(h_flex().gap(8).text_size(11.5)
            .child(div().text_color(f.ok ? t.ansi2 : t.muted).child(f.why))
            .when(Boolean(f.stop), (el) => el.child(div().text_color(t.blocked).child(f.stop)))
            .when(gone, (el) => el.child(div().text_color(t.muted).child("removed")))));
    };
    return v_flex().id("worktree").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().p(16).gap(10).bg(t.popover).text_size(13)
      .child(div().font_semibold().text_color(t.foreground).child(`Clean up ${this.repo?.name ?? ""}`))
      .child(div().text_size(12).text_color(t.muted).child("Worktrees whose work is done: their pull request merged, or their branch already in its base. Picked ones go as Remove does (space closed, branch deleted when merged)."))
      .child(div().relative().flex_1().min_h(0)
        .child(v_flex().id("clean-list").size_full().overflow_y_scroll().gap(2)
          .when(found === undefined, (el) => el.child(div().p(8).text_color(t.muted).child("Looking at its worktrees…")))
          .when(found !== undefined && !found.length && !this.error, (el) => el.child(div().p(8).text_color(t.dim).child("Nothing to clean up: no merged worktrees.")))
          .children((found ?? []).map(row)))
        .child(Scrollbar.vertical("clean-list").absolute().inset_0()))
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).text_size(12).child(this.error)))
      .child(footer(found?.length ? "click to pick · ↵ remove · esc cancel" : "esc close", t,
        button("wt-cancel", "Cancel", () => this.close(), t),
        Boolean(found?.length) && button("wt-go", this.busy ? `Removing… ${this.done?.length ?? 0}/${n}` : `Remove ${n} worktree${n === 1 ? "" : "s"}`, (cx) => this.go(cx), t, { kind: "danger", disabled: this.busy || !n })));
  }

  renderOpen(t) {
    const r = this.repo;
    const rows = this.shown();
    const all = this.list ?? [];
    const row = (c, i) => {
      const on = i === this.at;
      const there = spaceOf(c.path, all, this.on);
      return v_flex()
        .id(`wt-${i}`)
        .flex_none()
        .h(44)
        .px(10)
        .justify_center()
        .rounded(7)
        .cursor_pointer()
        .when(on, (el) => el.bg(t.selected))
        .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
        .on_click(() => this.open(c))
        .child(
          h_flex()
            .gap(8)
            .items_center()
            .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(c.branch ?? "detached"))
            .when(c.main, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child("main checkout")))
            .when(Boolean(there), (el) => el.child(div().flex_none().text_size(11).text_color(t.accent).child("open")))
            .when(!there && c.at > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(ago(c.at)))),
        )
        .child(div().truncate().text_size(11.5).text_color(t.dim).child(tilde(c.path, this.userHome ?? "")));
    };
    const count = rows.length === all.length ? `${all.length} checkouts` : `${rows.length}/${all.length} checkouts`;
    return v_flex()
      .id("worktree")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .size_full()
      .p(16)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .child(h_flex().child(div().flex_1().font_semibold().text_color(t.foreground).child(`Open worktree${r ? ` of ${r.name}` : ""}`)).child(div().text_size(11).text_color(t.dim).child(r ? count : "")))
      .when(r === undefined || (r && this.list === undefined), (el) => el.child(div().text_color(t.muted).child("\u2026")))
      .when(r === null, (el) => el.child(div().text_color(t.muted).child(`${this.folder ? tilde(this.folder, this.userHome ?? "") : "This folder"} is not in a git repository.`)))
      .when(Boolean(r && this.list), (el) =>
        el
          .child(Input.new(this.input).h(32).px(10).items_center().rounded(6).border(1).border_color(this.focusedField === "name" ? t.accent : t.input).bg(t.background).text_color(t.foreground))
          .child(
            div()
              .relative()
              .flex_1()
              .min_h(0)
              .child(
                v_flex()
                  .id("wt-list")
                  .size_full()
                  .overflow_y_scroll()
                  .children(rows.map(row))
                  .when(rows.length === 0, (el) => el.child(div().p(10).text_color(t.dim).child("No matching worktrees."))),
              )
              .child(Scrollbar.vertical("wt-list").absolute().inset_0()),
          ),
      )
      .child(footer("\u2191\u2193 choose \u00b7 \u21b5 open \u00b7 esc close", t,
        button("wt-close", "Cancel", () => this.close(), t),
        r && button("wt-open", "Open", () => this.open(rows[this.at]), t, { kind: "primary", disabled: !rows[this.at] })));
  }

  // The New worktree form: name, branch, base, link, agent and its first message.
  renderNew(t) {
    const r = this.repo;
    const field = (label, el, hint = "") => v_flex().gap(4)
      .child(h_flex().justify_between().text_size(11.5).text_color(t.muted).child(label).child(div().text_color(t.dim).child(hint)))
      .child(el);
    const frame = (name, el) => el.px(10).rounded(6).border(1).border_color(this.focusedField === name ? t.accent : t.input).bg(t.background).text_color(t.foreground);
    const input = (name, state) => frame(name, Input.new(state).h(30).items_center());
    const pr = prNumber(this.base.value());
    const chip = (key, label, icon) => {
      const on = this.agent === key;
      return h_flex().id(`agent-${key ?? "none"}`).h(26).px(9).gap(6).items_center().rounded(6).cursor_pointer()
        .border(1).border_color(on ? t.accent : t.border).bg(on ? t.selected : t.popover).text_color(on ? t.foreground : t.muted)
        .hover((s) => s.text_color(t.foreground))
        // Then typing goes on: into its first message, or (a shell) to the form, so Enter creates.
        .on_click((_e, cx) => { this.agent = key; key ? cx.timer.after(0, () => this.prompt.focus()) : this.handle.focus(); cx.notify(); })
        .when(Boolean(icon), (el) => el.child(icon)).child(label);
    };
    const agentIcon = (a) => (a.icon ? (a.tint ? svg(a.icon).size(13).text_color(t.foreground) : image(a.icon).size(13)) : null);
    const body = r === undefined ? div().text_color(t.muted).child("…")
      : r === null ? div().text_color(t.muted).child(`${this.folder ? tilde(this.folder, this.userHome) : "This folder"} is not in a git repository.`)
      : v_flex().gap(10)
        .child(field("Name", input("name", this.input), this.nameFromLabel ? `from ${this.nameFromLabel}` : ""))
        .child(h_flex().gap(10)
          .child(field("Branch", input("branch", this.branch)).flex_1().min_w(0))
          .child(field("Base", input("base", this.base), pr ? `PR #${pr}` : this.defaultBase && this.base.value().trim() === this.defaultBase ? "default" : "").flex_1().min_w(0)))
        .child(field("Link", input("link", this.link)))
        // What readies it, remembered for this repo (see REPOS and include.py).
        .child(h_flex().gap(10)
          .child(field("Setup", input("setup", this.setup), this.suggest && !this.setup.value().trim() ? `e.g. ${this.suggest}` : "").flex_1().min_w(0))
          .child(field("Also copy", input("include", this.include), this.includeFile.length ? `+ .worktreeinclude: ${this.includeFile.slice(0, 3).join(", ")}${this.includeFile.length > 3 ? "…" : ""}` : "").flex_1().min_w(0)))
        .child(field("Agent", h_flex().gap(6).flex_wrap()
          .child(chip(null, "Shell", svg("icons/shell.svg").size(13).text_color(t.foreground)))
          .children(this.agents.map((a) => chip(a.key, a.name, agentIcon(a))))))
        .when(Boolean(this.agent), (el) => el.child(field("First message", frame("prompt", Textarea.new(this.prompt).py(6).h(66)))))
        .child(div().text_size(11.5).text_color(t.dim).child(
          pr ? `Checks out PR #${pr}'s branch in ${tilde(ROOT(this.userHome), this.userHome)}/${r.name}/.`
            : `A new space on a checkout in ${tilde(ROOT(this.userHome), this.userHome)}/${r.name}/. A branch that exists is checked out; a new one starts from the base.`));
    return v_flex()
      .id("worktree")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .size_full()
      .p(16)
      .gap(12)
      .bg(t.popover)
      .text_size(13)
      .child(div().font_semibold().text_color(t.foreground).child(`New worktree${r ? ` of ${r.name}` : ""}`))
      .child(body)
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error)))
      .child(div().flex_1())
      .child(this.footer(t, r));
  }

  // The New form's buttons: Cancel, and Create worktree (also ↵, or ⌘↵ from the first
  // message), dimmed until the repo is known and while it works.
  footer(t, r) {
    return footer(r ? `tab next field · ↵ create${this.agent ? " (⌘↵ in the message)" : ""} · esc cancel` : "", t,
      button("wt-cancel", "Cancel", () => this.close(), t),
      r !== null && button("wt-create", this.busy ? "Creating…" : "Create worktree", (cx) => this.go(cx), t, { kind: "primary", disabled: !r || this.busy }));
  }

  render(cx) {
    const t = theme();
    if (this.opening) return this.renderOpen(t);
    if (props()?.action === "new") return this.renderNew(t);
    if (props()?.action === "clean") return this.renderClean(t);
    const remove = props()?.action === "remove";
    const s = this.space();
    const r = this.repo;
    const title = remove ? `Remove worktree ${s?.name ?? ""}?` : `New worktree${r ? ` of ${r.name}` : ""}`;
    const detail =
      r === undefined
        ? "…"
        : r === null
          ? `${this.folder ? tilde(this.folder, this.userHome) : "This folder"} is not in a git repository.`
          : remove
            ? !r.linked
              ? "This is the repository's main checkout, not a worktree."
              : `${s?.id ? "Closes the space and deletes" : "Deletes"} ${tilde(r.top, this.userHome)}. Its branch goes too when it's merged into its base; otherwise it stays.`
            : `A new space on a checkout in ${tilde(ROOT(this.userHome), this.userHome)}/${r.name}/. A branch that exists is checked out; a new one starts from here.`;
    const blocked = !r || (remove && !r.linked);
    return v_flex()
      .id("worktree")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .size_full()
      .p(16)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .child(div().font_semibold().text_color(t.foreground).child(title))
      .child(div().text_color(t.muted).child(detail))
      .when(remove && this.dirty, (el) => el.child(div().text_color(t.blocked).child("It has uncommitted changes: they will be lost.")))
      .when(remove && this.unpushed.length > 0, (el) => el.child(div().text_color(t.blocked).child(`Submodule ${this.unpushed.join(", ")} has commits that aren't pushed anywhere: they will be lost.`)))
      .when(!remove && !blocked, (el) =>
        el.child(
          Input.new(this.input)
            .h(32)
            .px(10)
            .items_center()
            .rounded(6)
            .border(1)
            .border_color(this.focusedField === "name" ? t.accent : t.input)
            .bg(t.background)
            .text_color(t.foreground),
        ),
      )
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error)))
      .child(div().flex_1())
      .child(footer(blocked ? "esc close" : remove ? "↵ remove · esc cancel" : "↵ create · esc cancel", t,
        button("wt-cancel", blocked ? "Close" : "Cancel", () => this.close(), t),
        !blocked && button("wt-go", this.busy ? (remove ? "Removing…" : "Creating…") : remove ? "Remove worktree" : "Create worktree", (cx) => this.go(cx), t,
          { kind: remove ? "danger" : "primary", disabled: this.busy })));
  }
}
