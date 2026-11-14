// Two presentations of one workspace. Native session focus remains the owner;
// a stack shows either the original terminal tree or the agent presentation.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { layout, shared, setShared, run, props, theme, focused, panes } from "herdr";
import { THEMES, VIEW_LAYOUTS } from "./themes.js";
import { setThemeContrast } from "./theme-contrast.js";

export const VIEW_STACK = "workspace-views";
export const AGENT_VIEW = "agent-world";
export const inAgentMode = () => props()?.integrated === true;

export function findViewStack(node = layout()) {
  if (node?.id === VIEW_STACK) return node;
  for (const child of node?.children ?? []) {
    const found = findViewStack(child);
    if (found) return found;
  }
  return null;
}

export const agentViewVisible = () => findViewStack()?.active === AGENT_VIEW;
const baseKey = () => `overview.baseLook.${shared("layout") || "main"}`;
export const workspaceTheme = () => shared("ag.workspaceTheme") || (layout()?.theme === THEMES.chiikawa.native || layout()?.colors?.chrome === THEMES.chiikawa.colors.chrome ? "chiikawa" : "default");

function paint(next, skin) {
  const key = baseKey();
  let base = shared(key);
  // localStorage belongs to each mod copy; theme state must be shared by the
  // toolbar, sidebar and overview. Import the previous per-copy backup once.
  if (!base) try { base = JSON.parse(localStorage.getItem(key) || "null"); } catch {}
  const terminals = [];
  const visit = (node) => {
    if (node.content?.tab || node.content?.terminal || node.content?.agent) terminals.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  visit(next);
  if (skin === "chiikawa") {
    if (!base) {
      base = next.colors?.chrome === THEMES.chiikawa.colors.chrome ? {} : { theme: next.theme, colors: next.colors };
    }
    base.terminals ??= Object.fromEntries(terminals.map((node) => [node.id, { theme: node.theme, colors: node.colors }]));
    if (JSON.stringify(shared(key)) !== JSON.stringify(base)) setShared(key, base);
    // Host currently applies only the root look. Keep terminal and panels in
    // the same light palette, including ANSI colors used by terminal programs.
    next.theme = THEMES.chiikawa.native;
    next.colors = { ...THEMES.chiikawa.colors };
    for (const node of terminals) {
      const original = base.terminals[node.id];
      if (original?.theme == null) delete node.theme; else node.theme = original.theme;
      if (original?.colors == null) delete node.colors; else node.colors = original.colors;
    }
  } else if (base) {
    if (base.theme == null) delete next.theme; else next.theme = base.theme;
    if (base.colors == null) delete next.colors; else next.colors = base.colors;
    for (const node of terminals) {
      const original = base.terminals?.[node.id];
      if (!original) continue;
      if (original.theme == null) delete node.theme; else node.theme = original.theme;
      if (original.colors == null) delete node.colors; else node.colors = original.colors;
    }
    setShared(key, null);
    localStorage.removeItem(key);
  }
}

export function applyModeTheme(skin) {
  if (!findViewStack()) return;
  const current = layout(), next = JSON.parse(JSON.stringify(current));
  paint(next, skin);
  if (JSON.stringify(current) !== JSON.stringify(next)) run("layout.set", { layout: next });
}

export function setWorkspaceView(agent) {
  const stack = findViewStack();
  if (!stack) return;
  const terminal = stack.children.find((child) => child.id !== AGENT_VIEW);
  const child = agent ? AGENT_VIEW : terminal?.id;
  if (!child) return;
  run("layout.select", { stack: VIEW_STACK, child });
}

export const openAgentMode = () => setWorkspaceView(true);
export const leaveAgentMode = () => setWorkspaceView(false);

export function renderViewSwitch() {
  const t = theme(), agent = agentViewVisible();
  const focus = focused(), pane = panes().find((item) => item.terminal === focus?.terminal);
  return h_flex().size_full().px(8).gap(12).items_center().bg(t.chrome)
    .child(h_flex().gap(2).p(2).rounded(7).border(1).border_color(t.border)
      .children([[false, "Terminal"], [true, "Agent"]].map(([value, label]) => div()
        .id(value ? "workspace-view-agent" : "workspace-view-terminal").px(12).py(4).rounded(5).text_size(11)
        .text_color(agent === value ? t.foreground : t.muted).when(agent === value, (el) => el.bg(t.selected))
        .cursor_pointer().hover((el) => el.bg(t.hover)).on_click(() => setWorkspaceView(value)).child(label))))
    .when(agent && workspaceTheme() === "chiikawa", (el) => el.child(h_flex().gap(2).p(2).rounded(7).border(1).border_color(t.border)
      .children(VIEW_LAYOUTS.map(([key, label]) => div().id(`overview-layout-${key}`).px(10).py(4).rounded(5).text_size(11)
        .text_color(t.foreground).when((shared("ag.presentation") || "village") === key, (el) => el.bg(t.selected))
        .cursor_pointer().hover((el) => el.bg(t.hover)).on_click(() => setShared("ag.presentation", key)).child(label)))))
    .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted)
      .child(pane?.title || "Select a session"))
    .child(h_flex().gap(2).p(2).rounded(7).border(1).border_color(t.border)
      .children(Object.entries(THEMES).map(([key, value]) => div().id(`workspace-theme-${key}`).px(9).py(4).rounded(5).text_size(11)
        .text_color(t.foreground).when(workspaceTheme() === key, (el) => el.bg(t.selected))
        .cursor_pointer().hover((el) => el.bg(t.hover)).on_click((_event, cx) => {
          setShared("ag.workspaceTheme", key);
          applyModeTheme(key);
          cx.spawn(async (cx) => { await setThemeContrast(key === "chiikawa"); cx.notify(); });
        }).child(value.label))));
}
