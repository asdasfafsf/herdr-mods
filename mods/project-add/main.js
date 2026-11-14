// project-add (herdr-mods): the sidebar's Add project dialog, as Orca's. Opened by the
// folder button in the spaces-plus header.
//
// - Browse folder (Enter): the system folder picker; a repo or a plain folder opens as a
//   space (a repo shows under its repo in the sidebar); a folder of repos lists them to pick
//   which to open, each as its own space. On another machine there's no picker: type its folder.
// - Clone from URL: a Git URL and the folder to clone into; a new space's terminal clones it
//   (see cloneRepo in lib/project.js), then sits in it.
// - New project: a name and the folder to make it in; an empty git repo with a first commit
//   (see createProject), opened as a space.
// - Host: this computer, or a connected machine (shown only when there is one).
//
// The work is lib/project.js's, which an agent's `hm clone` / `hm project` call too.
// props: { host?, folder? (start at that folder) }. Esc goes back, then closes.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, props, closeOverlay, theme, pickFolder, hc } from "herdr";
import { button, footer } from "./ui.js";
import { defaultParent, cloneRepo, createProject, reposIn, isOpen } from "./project.js";

const icon = (name) => (name.includes("/") ? name : `mods/workspace-chrome/${name}.svg`);

export default class ProjectAdd extends View {
  init(_props, cx) {
    this.view = "home"; // "home" | "clone" | "new" | "path" (a folder on another machine) | "repos" (a folder of repos)
    this.found = []; // repos: [{ path, open }] in the folder picked
    this.picked = new Set();
    this.host = props()?.host ?? null; // null: this computer
    this.machines = []; // connected machines, for the Host row
    this.busy = false;
    this.error = "";
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.url = InputState.new({ value: "", placeholder: "https://… or git@…:team/repo.git" });
    this.name = InputState.new({ value: "", placeholder: "name, e.g. 새-서비스" });
    this.parent = InputState.new({ value: defaultParent(this.host), placeholder: "the folder it goes in" });
    this.path = InputState.new({ value: "", placeholder: "a folder on that machine" });
    for (const s of [this.url, this.name, this.parent, this.path]) {
      s.on("submit", (_e, cx) => this.go(cx));
      s.on("change", (_e, cx) => { this.error = ""; cx.notify(); });
    }
    // props.folder: start at that folder (a folder of repos lists them; see openFolder).
    if (props()?.folder) cx.spawn(async (cx) => this.openFolder(props().folder, cx));
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["machine", "ls", "--json"]);
        if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary && m.state === "connected");
      } catch {}
      cx.notify();
    });
  }

  close() {
    closeOverlay(props()?.overlay);
  }

  show(view, cx) {
    this.view = view;
    this.error = "";
    if (view === "clone") this.url.focus();
    else if (view === "new") this.name.focus();
    else if (view === "path") this.path.focus();
    else this.handle.focus();
    cx.notify();
  }

  pickHost(name, cx) {
    this.host = name;
    this.parent.set_value(defaultParent(name));
    cx.notify();
  }

  // Browse folder: the picker here; on another machine, its folder typed in (see go). A
  // folder of repos (not in one itself) lists them to pick from (see openFolder).
  browse(cx) {
    if (this.host) return this.show("path", cx);
    cx.spawn(async (cx) => {
      const folder = await pickFolder({ prompt: "Open" }).catch(() => null);
      if (folder) await this.openFolder(folder, cx);
    });
  }

  // A repo or a plain folder opens as a space; a folder with repos in it shows them to pick
  // which to open, each as a space (so each shows under its repo); open ones are greyed.
  async openFolder(folder, cx) {
    const repos = await reposIn(folder, this.host);
    if (!repos.length) { this.close(); return run("space.new", { folder, machine: this.host ?? "" }); }
    this.parentPicked = folder;
    this.found = repos.map((path) => ({ path, open: isOpen(path, this.host) }));
    // None picked at first: opening a dozen spaces should be asked for (see Pick all).
    this.picked = new Set();
    this.show("repos", cx);
  }

  openPicked() {
    const go = this.found.filter((r) => this.picked.has(r.path));
    if (!go.length) return;
    this.close();
    for (const r of go) run("space.new", { folder: r.path, machine: this.host ?? "" });
  }

  // The parent folder's Browse (this computer only).
  browseParent(cx) {
    cx.spawn(async (cx) => {
      const folder = await pickFolder({ prompt: "Choose" }).catch(() => null);
      if (folder) { this.parent.set_value(folder); this.error = ""; }
      cx.notify();
    });
  }

  // What the shown form does: clone, create, or open the typed folder.
  go(cx) {
    if (this.busy) return;
    if (this.view === "home") return this.browse(cx);
    if (this.view === "repos") return this.openPicked();
    if (this.view === "path") {
      const folder = this.path.value().trim();
      if (!folder) { this.error = "Type the folder."; return cx.notify(); }
      cx.spawn(async (cx) => this.openFolder(folder, cx));
      return;
    }
    this.busy = true;
    this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        if (this.view === "clone") await cloneRepo({ url: this.url.value(), parent: this.parent.value(), on: this.host });
        else await createProject({ name: this.name.value(), parent: this.parent.value(), on: this.host });
        this.close();
      } catch (e) { this.error = String(e?.message ?? e); }
      this.busy = false;
      cx.notify();
    });
  }

  key(e, cx) {
    if (e.key === "escape") {
      cx.stop_propagation();
      return this.view === "home" ? this.close() : this.show("home", cx);
    }
    if (e.key === "enter" && this.view === "home") { cx.stop_propagation(); this.browse(cx); }
    if (e.key === "enter" && this.view === "repos") { cx.stop_propagation(); this.openPicked(); }
  }

  // An option: its icon in a tile, title and line under it, and on the main one the Enter key.
  option(id, iconName, title, line, action, t, main = false) {
    return h_flex().id(id).gap(12).px(12).py(10).items_center().rounded(8).cursor_pointer()
      .when(main, (el) => el.bg(t.raised ?? t.hover).border(1).border_color(t.border))
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => action(cx))
      .child(div().size(30).flex_none().flex().items_center().justify_center().rounded(7).when(main, (el) => el.bg(t.background))
        .child(svg(icon(iconName)).size(15).text_color(t.foreground)))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().text_size(13).font_semibold().text_color(t.foreground).child(title))
        .child(div().text_size(11.5).text_color(t.muted).truncate().child(line)))
      .when(main, (el) => el.child(div().flex_none().px(7).py(2).rounded(5).border(1).border_color(t.border).text_size(11).text_color(t.muted).child("↵")));
  }

  field(label, state, t, extra = null) {
    return v_flex().gap(4)
      .child(div().text_size(11.5).text_color(t.muted).child(label))
      .child(h_flex().gap(8).items_center()
        .child(Input.new(state).flex_1().h(30).px(10).items_center().rounded(6).border(1).border_color(t.input).bg(t.background).text_color(t.foreground))
        .when(Boolean(extra), (el) => el.child(extra)));
  }

  hostRow(t) {
    if (!this.machines.length) return null;
    const chip = (name, label) => {
      const on = (this.host ?? null) === name;
      return div().id(`host-${name ?? "local"}`).h(26).px(10).flex().items_center().rounded(6).cursor_pointer()
        .border(1).border_color(on ? t.accent : t.border).bg(on ? t.selected : t.popover).text_color(on ? t.foreground : t.muted)
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => this.pickHost(name, cx)).child(label);
    };
    return h_flex().gap(8).items_center().flex_wrap()
      .child(div().text_size(11.5).text_color(t.muted).child("Host"))
      .child(chip(null, "This computer"))
      .children(this.machines.map((m) => chip(m.name, m.name)));
  }

  render() {
    const t = theme();
    const head = (title, back) => h_flex().gap(8).items_center()
      .when(back, (el) => el.child(div().id("pa-back").size(22).flex().items_center().justify_center().rounded(5).cursor_pointer()
        .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => this.show("home", cx)).child("‹")))
      .child(div().flex_1().font_semibold().text_size(15).text_color(t.foreground).child(title))
      .child(div().id("pa-close").size(22).flex().items_center().justify_center().rounded(5).cursor_pointer()
        .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => this.close())
        .child(svg(icon("x")).size(12)));
    const where = this.host ? ` on ${this.host}` : "";
    const parentField = this.field("Parent folder", this.parent, t, this.host ? null : button("pa-browse-parent", "Browse", (cx) => this.browseParent(cx), t));
    const error = Boolean(this.error) && div().text_color(t.blocked).text_size(12).child(this.error);
    let body;
    if (this.view === "clone") {
      body = v_flex().gap(12)
        .child(head(`Clone from URL${where}`, true))
        .child(div().text_size(12).text_color(t.muted).child("A new space clones it in its terminal (so a login it asks for goes there), then opens it."))
        .child(this.field("Git URL", this.url, t))
        .child(parentField)
        .when(Boolean(error), (el) => el.child(error))
        .child(div().flex_1())
        .child(footer("↵ clone · esc back", t, button("pa-back2", "Back", (cx) => this.show("home", cx), t), button("pa-clone", this.busy ? "Starting…" : "Clone", (cx) => this.go(cx), t, { kind: "primary", disabled: this.busy })));
    } else if (this.view === "new") {
      body = v_flex().gap(12)
        .child(head(`New project${where}`, true))
        .child(div().text_size(12).text_color(t.muted).child("An empty folder with git and a first commit, so worktrees can start from it."))
        .child(this.field("Name", this.name, t))
        .child(parentField)
        .when(Boolean(error), (el) => el.child(error))
        .child(div().flex_1())
        .child(footer("↵ create · esc back", t, button("pa-back3", "Back", (cx) => this.show("home", cx), t), button("pa-create", this.busy ? "Creating…" : "Create", (cx) => this.go(cx), t, { kind: "primary", disabled: this.busy })));
    } else if (this.view === "repos") {
      const n = this.found.filter((r) => this.picked.has(r.path)).length;
      const repoRow = (r) => {
        const on = this.picked.has(r.path);
        return h_flex().id(`pa-repo-${r.path}`).gap(10).px(8).py(5).items_center().rounded(6)
          .when(!r.open, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { on ? this.picked.delete(r.path) : this.picked.add(r.path); cx.notify(); }))
          .when(r.open, (el) => el.opacity(0.5))
          .child(svg(icon(on ? "circle-check" : "square")).size(14).flex_none().text_color(on ? t.accent : t.dim))
          .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(r.path.split("/").pop()))
          .when(r.open, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child("open")));
      };
      body = v_flex().gap(10)
        .child(head(`Repos in ${(this.parentPicked ?? "").split("/").pop()}`, true))
        .child(div().text_size(12).text_color(t.muted).child("A folder of repos: each picked one opens as a space, under its repo in the sidebar."))
        .child(div().relative().flex_1().min_h(0)
          .child(v_flex().id("pa-repos").size_full().overflow_y_scroll().gap(1).children(this.found.map(repoRow))))
        .child(footer("click to pick · ↵ open · esc back", t, button("pa-back5", "Back", (cx) => this.show("home", cx), t),
          button("pa-pick-all", this.found.some((r) => !r.open && !this.picked.has(r.path)) ? "Pick all" : "Pick none", (cx) => {
            const left = this.found.filter((r) => !r.open);
            this.picked = left.some((r) => !this.picked.has(r.path)) ? new Set(left.map((r) => r.path)) : new Set();
            cx.notify();
          }, t),
          button("pa-open-repos", `Open ${n} repo${n === 1 ? "" : "s"}`, () => this.openPicked(), t, { kind: "primary", disabled: !n })));
    } else if (this.view === "path") {
      body = v_flex().gap(12)
        .child(head(`Open a folder${where}`, true))
        .child(this.field("Folder", this.path, t))
        .when(Boolean(error), (el) => el.child(error))
        .child(div().flex_1())
        .child(footer("↵ open · esc back", t, button("pa-back4", "Back", (cx) => this.show("home", cx), t), button("pa-open", "Open", (cx) => this.go(cx), t, { kind: "primary" })));
    } else {
      body = v_flex().gap(14)
        .child(head("Add project", false))
        .when(this.machines.length > 0, (el) => el.child(this.hostRow(t)))
        .child(this.option("pa-browse", "folder", "Browse folder", this.host ? `A folder on ${this.host}` : "A project, a Git repo, or a folder with many repos", (cx) => this.browse(cx), t, true))
        .child(v_flex().gap(6)
          .child(div().text_size(11.5).text_color(t.muted).child("Other ways to add"))
          .child(v_flex().gap(2).p(4).rounded(8).border(1).border_color(t.border)
            .child(this.option("pa-clone-url", "mods/project-add/globe.svg", "Clone from URL", "Clone a remote Git repo", (cx) => this.show("clone", cx), t))
            .child(this.option("pa-new", "plus", "New project", "Start from an empty folder", (cx) => this.show("new", cx), t))));
    }
    return v_flex().id("project-add").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().p(18).bg(t.popover).text_size(13)
      .child(body.flex_1());
  }
}
