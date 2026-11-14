// hm-settings (herdr-mods): every look choice of the herdr-mods sidebar and Agents list in one
// window, opened from the sidebar's settings button. What it lists comes from
// lib/state.js's OPTION_DEFS (one line per choice there makes one row here) and the repos the
// sidebar knows (their colors). An agent changes the same through hm option / hm color.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, theme, shared } from "herdr";
import { OPTION_DEFS, TREES, REPO_COLORS, REPO_COLOR_NAMES, option, setOption, setRepoColor, resetRepoColors } from "./state.js";
import { button, footer } from "./ui.js";

const minutes = (m) => (m % 60 ? `${m}m` : `${m / 60}h`);

export default class Settings extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  close() {
    closeOverlay(props().overlay);
  }

  // An on/off choice: its name and what it does, a switch at the end.
  toggle(t, name, d) {
    const on = option(name);
    return h_flex().id(`set-${name}`).px(10).py(7).gap(12).items_center().rounded(8).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { setOption(name, !on); cx.notify(); })
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().text_size(13).text_color(t.foreground).child(d.label))
        .child(div().text_size(11.5).text_color(t.dim).child(d.about)))
      .child(h_flex().w(34).h(20).flex_none().rounded(10).p(2).bg(on ? t.accent : t.border).when(on, (el) => el.justify_end())
        .child(div().size(16).rounded(8).bg("#ffffff")));
  }

  // A number with a few steps (OPTION_DEFS steps): each a button, the one set stands out.
  steps(t, name, d) {
    const now = option(name);
    return h_flex().id(`set-${name}`).px(10).py(7).gap(12).items_center()
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().text_size(13).text_color(t.foreground).child(d.label))
        .child(div().text_size(11.5).text_color(t.dim).child(d.about)))
      .child(h_flex().flex_none().gap(4).children(d.steps.map((v) =>
        div().id(`set-${name}-${v}`).h(24).px(8).flex().items_center().rounded(6).cursor_pointer().text_size(12)
          .when(v === now, (el) => el.bg(t.selected).text_color(t.foreground).font_semibold())
          .when(v !== now, (el) => el.text_color(t.muted).hover((s) => s.bg(t.hover)))
          .on_click((_e, cx) => { setOption(name, v); cx.notify(); })
          .child(minutes(v)))));
  }

  // One of a few words (OPTION_DEFS choices): each a button, the one set stands out.
  choices(t, name, d) {
    const now = option(name);
    return h_flex().id(`set-${name}`).px(10).py(7).gap(12).items_center()
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().text_size(13).text_color(t.foreground).child(d.label))
        .child(div().text_size(11.5).text_color(t.dim).child(d.about)))
      .child(h_flex().flex_none().gap(4).children(d.choices.map((v) =>
        div().id(`set-${name}-${v}`).h(24).px(8).flex().items_center().rounded(6).cursor_pointer().text_size(12)
          .when(v === now, (el) => el.bg(t.selected).text_color(t.foreground).font_semibold())
          .when(v !== now, (el) => el.text_color(t.muted).hover((s) => s.bg(t.hover)))
          .on_click((_e, cx) => { setOption(name, v); cx.notify(); })
          .child(v[0].toUpperCase() + v.slice(1)))));
  }

  // Each repo the sidebar lists: its color, picked from the palette, or Auto.
  colors(t) {
    const set = shared(REPO_COLORS) ?? {};
    const repos = Object.entries(shared(TREES) ?? {}).sort(([, a], [, b]) => a.name.localeCompare(b.name));
    return repos.map(([key, r]) => h_flex().id(`color-${key}`).px(10).py(5).gap(10).items_center()
      .child(h_flex().size(18).flex_none().rounded(5).bg(set[key] ?? t.border).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff").child([...r.name][0]?.toUpperCase() ?? "?"))
      .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child(r.name))
      .child(h_flex().flex_none().gap(5).items_center()
        .children(Object.entries(REPO_COLOR_NAMES).map(([name, hex]) =>
          div().id(`color-${key}-${name}`).size(16).rounded(4).bg(hex).cursor_pointer().tooltip(name)
            .when(set[key] === hex, (el) => el.border(2).border_color(t.foreground))
            .on_click((_e, cx) => { setRepoColor(key, name); cx.notify(); })))
        .child(div().id(`color-${key}-auto`).ml(4).px(6).h(20).flex().items_center().rounded(5).cursor_pointer().text_size(11).text_color(t.muted)
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Back to an automatic color")
          .on_click((_e, cx) => { setRepoColor(key, null); cx.notify(); })
          .child("Auto"))));
  }

  // A group's title, with an action at its end if it has one.
  section(t, title, rows, action = null) {
    return v_flex().gap(2)
      .child(h_flex().px(10).pt(10).pb(4).items_center()
        .child(div().flex_1().text_size(11).font_semibold().text_color(t.dim).child(title))
        .when(Boolean(action), (el) => el.child(action)))
      .children(rows);
  }

  render() {
    const t = theme();
    const groups = {};
    for (const [name, d] of Object.entries(OPTION_DEFS)) {
      // How long Seen lasts only matters with Seen on.
      if (name === "seenMinutes" && !option("seen")) continue;
      // Agent activity is part of the detailed cards only.
      if (name === "sidebarAgentNews" && option("sidebarCards") !== "detailed") continue;
      (groups[d.group] ??= []).push(d.choices ? this.choices(t, name, d) : d.steps ? this.steps(t, name, d) : this.toggle(t, name, d));
    }
    return v_flex().id("hm-settings").track_focus(this.handle).size_full().p(18).gap(8).bg(t.popover)
      .on_key_down((e, cx) => { if (e.key === "escape") { cx.stop_propagation(); this.close(); } })
      .child(div().text_size(15).font_semibold().text_color(t.foreground).child("Settings"))
      .child(v_flex().id("hm-settings-body").flex_1().min_h(0).overflow_y_scrollbar().gap(4)
        .children(Object.entries(groups).map(([g, rows]) => this.section(t, g, rows)))
        .child(this.section(t, "Repo colors", this.colors(t),
          // All at once: every open repo a different color again (also what hm color all auto does).
          div().id("color-reassign").px(8).h(22).flex().items_center().rounded(6).cursor_pointer().text_size(11.5).text_color(t.muted)
            .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Give every open repo a different color again")
            .on_click((_e, cx) => { resetRepoColors(); cx.notify(); })
            .child("Reassign all"))))
      .child(footer("An agent can change these too: “레포 이름 숨겨줘”, “owl 파란색으로”", t,
        button("hm-settings-close", "Close", () => this.close(), t, { kind: "primary" })));
  }
}
