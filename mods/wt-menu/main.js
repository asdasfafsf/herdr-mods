// wt-menu (herdr-mods): the right-click menu of a worktree row in the `spaces-plus`
// sidebar, and the small dialog its Rename / Comment / Link / Pull request items open.
//
// Items: open (or wake), Sessions… (mods/wt-sessions), rename / comment / link / PR, status,
// pin, unread, archive, Finder / editor / copy, sleep, close space, remove (mods/worktree-plus).
//
// props, menu:  { mode: "menu", key, path, machine, space?, branch, primary? }
//   primary: the repo's main checkout: no Archive or Remove.
//   key: the checkout's entry in shared("wt.meta") (see META); space: the space showing
//   it, if one does (a checkout listed but not open has none).
// props, edit:  { mode: "edit", field: "name" | "comment" | "link" | "pr", key, path, machine, space? }
// props, sort:  { mode: "sort" }: how spaces-plus orders a repo's worktrees (shared "wt.sort").
// props, new:   { mode: "new", path, machine, space?, name? }: a terminal or an agent to start
//   in that folder: a new tab in its space, or (no space: a checkout that isn't open) a
//   new space there named `name`.
//
// ↑/↓ move, Enter runs, Esc closes.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, spaces, exec, shared, setShared, knownAgents, agents } from "herdr";
import { agentLaunchArgv } from "./agent-launch.js";
import { button, footer } from "./ui.js";
import { META, SLEEP, SORT, KNOWN, setMeta } from "./state.js";

// Per checkout, keyed by JSON [machine, path]: { name, branch, base, link, pr, agent,
// created, comment, status, pinned, unread, archived }. The same store worktree-plus
// writes when it makes one and spaces-plus reads to draw the rows.
// A checkout's entry by its key (props carry the key, see META in lib/state.js).
const metaOf = (key) => shared(META)?.[key] ?? {};

// Orca's board columns, in order.
export const STATUSES = [
  ["todo", "To do"],
  ["in-progress", "In progress"],
  ["in-review", "In review"],
  ["completed", "Completed"],
];

const icon = (name) => `mods/workspace-chrome/${name}.svg`;
const copy = (text) => exec("sh", ["-c", 'printf %s "$1" | pbcopy', "sh", text]);

const FIELDS = {
  name: { title: "Rename worktree", placeholder: "display name (empty: the folder's name)" },
  comment: { title: "Comment", placeholder: "a note on this worktree" },
  link: { title: "Link", placeholder: "issue, ticket or URL (empty: none)" },
  pr: { title: "Pull request", placeholder: "#123 or its URL (empty: none)" },
};

export default class WtMenu extends View {
  init(_props, cx) {
    this.at = 0;
    this.error = "";
    this.busy = false;
    this.handle = cx.focus_handle();
    this.editors = []; // installed editors: ["Cursor", "cursor"], ["VS Code", "code"]
    const p = props() ?? {};
    if (p.mode === "sort") this.handle.focus();
    else if (p.mode === "new") {
      const where = p.machine ?? "";
      this.agents = (shared(KNOWN)?.[where] ?? []).filter((a) => a.installed);
      this.handle.focus();
      cx.spawn(async (cx) => {
        try {
          const all = await knownAgents({ on: p.machine ?? null });
          setShared(KNOWN, { ...shared(KNOWN), [where]: all });
          this.agents = all.filter((a) => a.installed);
        } catch {}
        cx.notify();
      });
    } else if (p.mode === "edit") {
      const m = metaOf(p.key);
      const value = p.field === "pr" ? (m.pr?.number ? `#${m.pr.number}` : "") : (m[p.field] ?? "");
      this.input = InputState.new({ value: String(value), placeholder: FIELDS[p.field]?.placeholder ?? "" });
      this.input.on("submit", (_e, cx) => this.save(cx));
      this.input.on("change", (_e, cx) => { this.error = ""; cx.notify(); });
      this.input.focus();
      cx.timer.after(300, () => this.input.focus());
    } else {
      this.handle.focus();
      if (!p.machine)
        cx.spawn(async (cx) => {
          const r = await exec("sh", ["-c", "command -v cursor >/dev/null && echo cursor; command -v code >/dev/null && echo code"]).catch(() => null);
          const found = (r?.stdout ?? "").split("\n").filter(Boolean);
          this.editors = [["Cursor", "cursor"], ["VS Code", "code"]].filter(([, bin]) => found.includes(bin));
          cx.notify();
        });
    }
  }

  close() {
    closeOverlay(props().overlay);
  }

  space() {
    const id = props()?.space;
    return id ? spaces().find((s) => s.id === id) : null;
  }

  // How many agents are working in a space (the Sleep item says it stops them).
  working(s) {
    const tabs = new Set((s.tabs ?? []).map((t) => t.id));
    return agents().filter((a) => tabs.has(a.tab) && a.status === "working").length;
  }

  edit(field) {
    const p = props();
    openOverlay({ mod: "wt-menu", kind: "dialog", width: 420, height: 170, props: { ...p, mode: "edit", field, overlay: undefined } });
  }

  // New mode: a shell, then each installed agent, started in the folder.
  newItems() {
    const p = props() ?? {};
    const s = this.space();
    const start = (argv, name) => () => {
      if (s) run("tab.new", { space: s.id, folder: p.path, ...(argv ? { argv, name } : {}) });
      else run("space.new", { ...(p.name ? { name: p.name } : {}), folder: p.path, machine: p.machine ?? "", ...(argv ? { argv } : {}) });
    };
    return [
      ["Terminal", start(null), { svgIcon: "icons/shell.svg" }],
      ...(this.agents ?? []).map((a, i) => [a.name, start(agentLaunchArgv(a.key, a.run), a.name), { program: a, line: i === 0 }]),
    ];
  }

  // Sort mode: spaces-plus's orders (its SORTS), the current one checked.
  sortItems() {
    const now = shared(SORT) ?? "activity";
    return [["activity", "Agent activity"], ["recent", "Recent"], ["name", "Name"], ["created", "Created"]]
      .map(([id, label]) => [label, () => setShared(SORT, id), { icon: now === id ? "circle-check" : "square", check: now === id }]);
  }

  // The menu: [label, action, { icon, check, danger, line }] (line: a separator above it).
  items() {
    const p = props() ?? {};
    if (p.mode === "new") return this.newItems();
    if (p.mode === "sort") return this.sortItems();
    const m = metaOf(p.key);
    const s = this.space();
    const set = (patch) => () => setMeta(p.key, patch);
    const local = !p.machine;
    return [
      s
        ? ["Go to space", () => { setMeta(p.key, { unread: false }); run("space.select", { id: s.id }); }, { icon: "square" }]
        // spaces-plus opens it: a sleeping one wakes with its sessions.
        : [(shared(SLEEP) ?? {})[p.key] ? "Wake" : "Open as space", () => run(`spaces-plus.open@${p.path}`), { icon: "plus" }],
      ["Sessions…", () => openOverlay({ mod: "wt-sessions", kind: "dialog", width: 620, height: 520, props: { name: m.name ?? p.path.split("/").pop(), path: p.path, machine: p.machine ?? null, space: s?.id ?? null } }), { icon: "clock" }],
      ["Rename…", () => this.edit("name"), { icon: "square-pen", line: true }],
      ["Comment…", () => this.edit("comment"), { icon: "file-text" }],
      ["Link…", () => this.edit("link"), { icon: "layers" }],
      ["Pull request…", () => this.edit("pr"), { icon: "git-compare" }],
      ...STATUSES.map(([id, label], i) => [label, set({ status: m.status === id ? null : id }), { icon: m.status === id ? "circle-check" : "square", check: m.status === id, line: i === 0 }]),
      [m.pinned ? "Unpin" : "Pin", set({ pinned: !m.pinned }), { icon: m.pinned ? "pin-off" : "pin", line: true }],
      [m.unread ? "Mark as read" : "Mark as unread", set({ unread: !m.unread }), { icon: "check" }],
      ...(p.primary ? [] : [[m.archived ? "Unarchive" : "Archive", set({ archived: !m.archived }), { icon: "archive" }]]),
      ...(local ? [["Open in Finder", () => exec("open", [p.path]), { icon: "folder", line: true }]] : []),
      ...this.editors.map(([name, bin], i) => [`Open in ${name}`, () => exec(bin, [p.path]), { icon: "files", line: !local && i === 0 }]),
      ...(local ? [["Copy path", () => copy(p.path), { icon: "files" }]] : []),
      ...(local && p.branch ? [["Copy branch", () => copy(p.branch), { icon: "git-branch" }]] : []),
      // Sleep (not the main checkout): its terminals close, its agent sessions resume on opening.
      ...(s && !p.primary ? [[`Sleep${this.working(s) ? ` (stops ${this.working(s)} working)` : ""}`, () => run(`spaces-plus.sleep@${s.id}`), { icon: "clock", line: true }]] : []),
      ...(s ? [["Close space", () => run("space.close", { id: s.id }), { icon: "x", line: !(s && !p.primary) }]] : []),
      // A repo's main checkout can't be removed (as in Orca): only its worktrees.
      ...(p.primary ? [] : [["Remove worktree…", () => openOverlay({ mod: "worktree-plus", kind: "dialog", width: 460, height: 280, props: { ...(s ? { space: s.id } : {}), folder: p.path, machine: p.machine ?? null, action: "remove" } }), { icon: "x", danger: true, line: !s }]]),
    ];
  }

  choose(i) {
    const it = this.items()[i];
    if (!it) return;
    this.close();
    it[1]();
  }

  // Edit mode: store the field. A display name also renames the open space ("" gives it
  // Herdr's automatic name back); a PR is looked up with gh for its title and URL.
  async save(cx) {
    if (this.busy) return;
    const p = props();
    const text = this.input.value().trim();
    this.busy = true;
    cx.notify();
    try {
      if (p.field === "pr") {
        const n = text.match(/^#?(\d+)$/)?.[1] ?? text.match(/\/pull\/(\d+)(?:[/?#]|$)/)?.[1] ?? null;
        if (text && !n) { this.error = "Type #123 or a pull request URL."; return; }
        let pr = n ? { number: Number(n) } : null;
        if (n) {
          const view = await exec("gh", ["pr", "view", n, "--json", "number,url,title,state"], { cwd: p.path, on: p.machine ?? null }).catch(() => null);
          if (view?.code === 0) pr = JSON.parse(view.stdout);
        }
        setMeta(p.key, { pr });
      } else {
        setMeta(p.key, { [p.field]: text || null });
        const s = this.space();
        if (p.field === "name" && s) run("space.rename", { id: s.id, name: text });
      }
      this.close();
    } finally {
      this.busy = false;
      cx.notify();
    }
  }

  renderEdit(t) {
    const f = FIELDS[props().field] ?? { title: "Edit" };
    return v_flex().id("wt-edit").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { cx.stop_propagation(); this.close(); } })
      .size_full().p(16).gap(10).bg(t.popover).text_size(13)
      .child(div().font_semibold().text_color(t.foreground).child(f.title))
      .child(Input.new(this.input).h(32).px(10).items_center().rounded(6).border(1).border_color(t.accent).bg(t.background).text_color(t.foreground))
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error)))
      .child(div().flex_1())
      .child(footer("↵ save · esc cancel", t,
        button("wt-edit-cancel", "Cancel", () => this.close(), t),
        button("wt-edit-save", this.busy ? "Saving…" : "Save", (cx) => this.save(cx), t, { kind: "primary", disabled: this.busy })));
  }

  render(cx) {
    const t = theme();
    if (props()?.mode === "edit") return this.renderEdit(t);
    const list = this.items();
    if (this.at >= list.length) this.at = 0;
    return v_flex().id("wt-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(this.at);
        else if (e.key === "escape") this.close();
        else return;
        cx.notify();
      })
      .children(list.map(([label, , o = {}], i) =>
        v_flex()
          .when(i > 0 && Boolean(o.line), (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
          .child(h_flex().id(`wm-${i}`).h(29).px(8).gap(9).rounded(7).items_center().cursor_pointer()
            .text_color(o.danger ? t.blocked : t.foreground)
            .when(i === this.at, (el) => el.bg(t.selected))
            .on_hover((on, cx) => { if (on) { this.at = i; cx.notify(); } })
            .on_click(() => this.choose(i))
            .child(o.program?.icon ? (o.program.tint ? svg(o.program.icon).size(13).text_color(t.foreground) : image(o.program.icon).size(13))
              : o.svgIcon ? svg(o.svgIcon).size(13).text_color(t.foreground)
              : svg(icon(o.icon ?? "square")).size(13).text_color(o.check ? t.accent : o.danger ? t.blocked : t.muted))
            .child(div().flex_1().child(label)))));
  }
}
