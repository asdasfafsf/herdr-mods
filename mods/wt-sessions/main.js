// wt-sessions (herdr-mods): the Claude Code and Codex sessions that ran in a worktree, to
// pick one up again. Opened as a dialog by wt-menu (Sessions…) and the spaces-plus repo row.
//
// props: { name, path, machine?, space?, exclude?: [paths] }
//   space: the space showing the worktree, if open: a session resumes in a new tab there,
//   else in a new space on the worktree. exclude: folders inside path that are other
//   worktrees (a repo's main checkout holds .claude/worktrees/*), left out.
//
// The list and the search come from sessions.py next to this file (it only reads
// ~/.claude/projects and ~/.codex). Typing filters titles; the first row then searches
// every message for it. ↵ (or Resume) resumes, ⌥↵ (or Fork, or the row's fork) forks, ↑/↓ move,
// esc (or Close) closes.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar } from "gpui-base";
import { run, props, closeOverlay, theme, spaces, exec, appHome, shared } from "herdr";
import { button, footer, ago } from "./ui.js";
import { KNOWN } from "./state.js";
import { AGENTS } from "./resume.js";

const SCRIPT = () => `${appHome()}/mods/wt-sessions/sessions.py`;
// How each agent picks a session up again, after its own command (programs.json `run`).
// How each agent's session is resumed or forked, and its name and icon: lib/resume.js's AGENTS.
const P = () => props() ?? {};

export default class WtSessions extends View {
  init(_props, cx) {
    this.list = undefined; // undefined: reading; [] none
    this.hits = null; // a search's results, null: not searched
    this.searching = false;
    this.error = "";
    this.at = 0;
    this.input = InputState.new({ value: "", placeholder: "filter titles" });
    this.input.on("change", (_e, cx) => { this.hits = null; this.at = 0; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.enter(false, cx));
    this.input.focus();
    cx.timer.after(300, () => this.input.focus());
    this.handle = cx.focus_handle();
    cx.spawn(async (cx) => {
      try { this.list = P().path ? await this.read(["list", P().path]) : []; }
      catch (e) { this.list = []; this.error = String(e.message ?? e); }
      cx.notify();
    });
  }

  async read(args) {
    if (P().machine) throw new Error("Sessions are read on this computer only.");
    const r = await exec("python3", ["-I", SCRIPT(), ...args]);
    if (r.code !== 0) throw new Error(r.stderr.trim() || "sessions.py failed.");
    const out = (p) => (P().exclude ?? []).some((x) => p === x || p.startsWith(`${x}/`));
    return JSON.parse(r.stdout).filter((s) => !out(s.cwd));
  }

  close() {
    closeOverlay(P().overlay);
  }

  query() {
    return this.input.value().trim();
  }

  // What the list shows: a search's hits, else the sessions whose title has the filter,
  // led by the row that searches every message for it.
  rows() {
    if (this.hits) return this.hits;
    const q = this.query().toLowerCase();
    const shown = (this.list ?? []).filter((s) => !q || s.title.toLowerCase().includes(q));
    return q ? [{ search: q }, ...shown] : shown;
  }

  search(cx) {
    const q = this.query();
    if (!q || this.searching) return;
    this.searching = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try { this.hits = await this.read(["search", q, P().path]); }
      catch (e) { this.error = String(e.message ?? e); }
      this.searching = false;
      this.at = 0;
      cx.notify();
    });
  }

  enter(fork, cx) {
    const row = this.rows()[this.at];
    if (!row) return;
    if (row.search) return this.search(cx);
    this.resume(row, fork);
  }

  // Back in its agent: a new tab in the worktree's space when it's open, else a new space
  // on the worktree. In the session's own folder: Claude Code finds sessions by folder.
  resume(s, fork) {
    const how = AGENTS[s.agent];
    if (!how) return;
    const known = (shared(KNOWN)?.[""] ?? []).find((a) => a.key === s.agent && a.installed);
    // As the agent menu starts it (programs.json's run, its flags), then resumed or forked.
    const launch = known?.run ?? [s.agent];
    const argv = (fork ? how.fork : how.resume)(launch[0], launch.slice(1), s.id);
    const p = P();
    const space = p.space && spaces().find((x) => x.id === p.space);
    this.close();
    if (space) run("tab.new", { space: space.id, folder: s.cwd, argv, name: s.title.slice(0, 28) });
    else run("space.new", { ...(p.name ? { name: p.name } : {}), folder: s.cwd, argv });
  }

  key(e, cx) {
    const n = this.rows().length;
    if (e.key === "escape") return this.close();
    if (e.key === "enter" && e.modifiers?.alt) this.enter(true, cx);
    else if ((e.key === "down" || e.key === "up") && n) this.at = (this.at + (e.key === "down" ? 1 : n - 1)) % n;
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  row(s, i, t) {
    const on = i === this.at;
    const base = v_flex().id(`ss-${i}`).flex_none().px(10).py(6).gap(2).rounded(7).cursor_pointer()
      .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((st) => st.bg(t.hover)))
      .on_hover((over, cx) => { if (over && this.at !== i) { this.at = i; cx.notify(); } });
    if (s.search)
      return base.on_click((_e, cx) => this.search(cx))
        .child(h_flex().gap(8).items_center().text_color(t.foreground)
          .child(svg("mods/workspace-chrome/search.svg").size(13).text_color(t.muted))
          .child(div().flex_1().truncate().child(this.searching ? "Searching…" : `Search every message for “${this.query()}”`)));
    const how = AGENTS[s.agent] ?? { name: s.agent, icon: null };
    return base.on_click(() => this.resume(s, false))
      .child(h_flex().gap(8).items_center()
        .when(Boolean(how.icon), (el) => el.child(image(how.icon).size(14).flex_none()))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(s.title))
        .when(on, (el) => el.child(div().id(`fork-${i}`).flex_none().px(6).rounded(5).cursor_pointer().text_size(11).text_color(t.muted)
          .hover((st) => st.bg(t.hover).text_color(t.foreground)).tooltip("A new session from this one (⌥↵)")
          .on_click((_e, cx) => { cx.stop_propagation(); this.resume(s, true); }).child("fork")))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(ago(s.updated))))
      .when(Boolean(s.snippet), (el) => el.child(div().pl(22).truncate().text_size(11.5).text_color(t.muted).child(s.snippet)))
      .when(Boolean(P().path) && s.cwd !== P().path, (el) => el.child(div().pl(22).truncate().text_size(11).text_color(t.dim).child(s.cwd.slice(P().path.length + 1))));
  }

  render(cx) {
    const t = theme();
    const rows = this.rows();
    const total = this.list?.length ?? 0;
    const count = this.hits ? `${this.hits.length} found` : this.list ? `${total} session${total === 1 ? "" : "s"}` : "";
    return v_flex().id("wt-sessions").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().p(16).gap(10).bg(t.popover).text_size(13)
      .child(h_flex().gap(8)
        .child(div().flex_1().min_w(0).truncate().font_semibold().text_color(t.foreground).child(`Sessions · ${P().name ?? (P().path ?? "").split("/").pop()}`))
        .child(div().text_size(11).text_color(t.dim).child(count)))
      .child(Input.new(this.input).h(32).px(10).items_center().rounded(6).border(1).border_color(t.accent).bg(t.background).text_color(t.foreground))
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error)))
      .child(div().relative().flex_1().min_h(0)
        .child(v_flex().id("ss-list").size_full().overflow_y_scroll()
          .when(this.list === undefined, (el) => el.child(div().p(10).text_color(t.muted).child("Reading sessions…")))
          .when(this.list !== undefined && rows.length === 0, (el) => el.child(div().p(10).text_color(t.dim).child(this.hits ? "No session mentions it." : "No Claude Code or Codex sessions ran here yet.")))
          .children(rows.map((s, i) => this.row(s, i, t))))
        .child(Scrollbar.vertical("ss-list").absolute().inset_0()))
      .child(this.footer(rows, t));
  }

  // Close, and for the chosen row Fork and Resume (the row that searches every message:
  // Search instead).
  footer(rows, t) {
    const row = rows[this.at];
    return footer("↑↓ choose · ↵ resume · ⌥↵ fork · esc close", t,
      button("ss-close", "Close", () => this.close(), t),
      row?.search
        ? button("ss-search", this.searching ? "Searching…" : "Search", (cx) => this.enter(false, cx), t, { kind: "primary", disabled: this.searching })
        : [button("ss-fork", "Fork", (cx) => this.enter(true, cx), t, { disabled: !row }),
          button("ss-resume", "Resume", (cx) => this.enter(false, cx), t, { kind: "primary", disabled: !row })]);
  }
}
