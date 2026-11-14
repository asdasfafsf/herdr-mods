// Empty states describe what the host actually reported, before quiet sessions
// and search filters are applied. They never invent or change an agent status.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { button } from "./ui.js";

export function agentEmptyState({ total, available, count }) {
  if (count > 0) return null;
  if (total === 0) return {
    kind: "no-sessions",
    title: "No agents running yet",
    detail: "Agents appear here when Herdr or a supported local app reports them.",
  };
  if (available === 0) return {
    kind: "idle-hidden",
    title: "All agents are idle",
    detail: "Idle sessions stay hidden until you select them.",
  };
  return {
    kind: "filtered",
    title: "No matching agents",
    detail: "Try another search, status or source.",
  };
}

export function renderAgentEmptyState(state, t, { openTerminal, clearFilters } = {}) {
  if (!state) return null;
  return v_flex().id("agent-empty-state").p(28).gap(8).items_center()
    .child(div().id("agent-empty-title").font_medium().text_color(t.foreground).child(state.title))
    .child(div().text_size(12).text_color(t.muted).text_center().child(state.detail))
    .child(h_flex().gap(8).items_center()
      .when(state.kind === "filtered" && typeof clearFilters === "function", (el) => el.child(
        button("agent-empty-clear", "Clear filters", clearFilters, t)))
      .when(typeof openTerminal === "function", (el) => el.child(
        button("agent-empty-terminal", "Open terminal", openTerminal, t))));
}
