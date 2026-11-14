// Cards and village share this exact header; only their content differs.
import { div } from "gpui-kit";
import { h_flex, v_flex, Input, Popover } from "gpui-base";
import { themeControls, motionControl } from "./agent-theme.js";
import { button } from "./ui.js";

export function overviewHeader(view, { t, rows, scope, states, sources }) {
  const filtering = Boolean(view.input.value().trim() || view.statusFilter !== "all" || view.sourceFilter !== "all");
  return v_flex().id("overview-header").px(14).py(6).gap(8).flex_none().border_b(1).border_color(t.border).bg(t.background)
    .child(h_flex().items_center().gap(10).flex_wrap()
      .child(div().text_size(13).font_semibold().text_color(t.foreground).child("Agents"))
      .child(div().flex_1().text_size(11).text_color(t.muted).child(`${rows.length} sessions`))
      .child(themeControls(view, t))
      .child(Popover.new("village-filters").anchor("top_right").open(Boolean(view.villageFilters))
        .on_open_change((open, cx) => { view.villageFilters = open; cx.notify(); })
        .trigger(div().id("overview-options-trigger").px(10).py(6).rounded(6).text_size(11).cursor_pointer()
          .bg(view.villageFilters ? t.selected : t.raised).text_color(t.foreground).hover((el) => el.bg(t.hover))
          .accessibility_label("Agent display options").child(filtering ? "Options · filtered" : "Options"))
        .when(view.villageFilters, (el) => el.content(optionsPanel(view, { t, scope, states, sources }, filtering)))))
    .when(Boolean(view.outsideError), (el) => el.child(div().text_size(11).text_color(t.blocked).child("Couldn't update outside agents. Showing the last available list.")));
}

function optionsPanel(view, { t, scope, states, sources }, filtering) {
  return v_flex().id("village-filter-panel").w(340).max_h(420).overflow_y_scroll()
      .p(12).gap(10).rounded(10).border(1).border_color(t.border).bg(t.popover || t.raised).shadow_lg()
      .child(div().text_size(12).font_semibold().text_color(t.foreground).child("Display options"))
      .child(h_flex().items_center().gap(8).child(motionControl(view, t))
        .child(div().flex_1())
        .when(filtering, (el) => el.child(button("overview-clear-options", "Clear filters", (cx) => { view.input.set_value(""); view.statusFilter = "all"; view.sourceFilter = "all"; view.page = 0; cx.notify(); }, t))))
      .child(Input.new(view.input).h(34).px(10).items_center().rounded(7).border(1).border_color(t.border).bg(t.raised).text_color(t.foreground))
      .child(h_flex().gap(5).flex_wrap().children(states.map(([key, label]) => {
        const count = key === "all" ? scope.length : scope.filter((row) => row.status === key).length;
        return div().id(`overview-status-${key}`).px(9).py(6).rounded(5).text_size(11).cursor_pointer()
          .bg(view.statusFilter === key ? t.selected : t.background).text_color(t.foreground).hover((el) => el.bg(t.hover))
          .on_click((_e, cx) => { view.statusFilter = key; view.page = 0; cx.notify(); }).child(`${label} ${count}`);
      })))
      .child(h_flex().gap(5).flex_wrap().children(sources.map(([key, label]) => div().id(`overview-source-${key}`).px(9).py(5).rounded(5).cursor_pointer()
        .text_size(11).text_color(view.sourceFilter === key ? t.foreground : t.muted)
        .when(view.sourceFilter === key, (el) => el.bg(t.selected)).hover((el) => el.bg(t.hover))
        .on_click((_e, cx) => { view.sourceFilter = key; view.page = 0; cx.notify(); }).child(label))));
}
