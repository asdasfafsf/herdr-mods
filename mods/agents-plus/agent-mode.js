// Two presentations of one workspace. Native session focus remains the owner;
// a stack shows either the original terminal tree or the agent presentation.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { layout, shared, setShared, run, props, theme, focused, panes } from "herdr";
import { THEMES } from "./themes.js";

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
export const workspaceTheme = () => shared("ag.workspaceTheme") || (layout()?.colors?.chrome === THEMES.chiikawa.colors.chrome ? "chiikawa" : "default");

function paint(next, skin) {
  const key = baseKey();
  let base = shared(key);
  // localStorage belongs to each mod copy; theme state must be shared by the
  // toolbar, sidebar and overview. Import the previous per-copy backup once.
  if (!base) try { base = JSON.parse(localStorage.getItem(key) || "null"); } catch {}
  if (skin === "chiikawa") {
    if (!base) {
      base = next.colors?.chrome === THEMES.chiikawa.colors.chrome ? {} : { theme: next.theme, colors: next.colors };
    }
    setShared(key, base);
    next.theme = "paper";
    next.colors = { ...(base.colors ?? {}), ...THEMES.chiikawa.colors };
  } else if (base) {
    if (base.theme === undefined) delete next.theme; else next.theme = base.theme;
    if (base.colors === undefined) delete next.colors; else next.colors = base.colors;
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
    .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted)
      .child(pane?.title || "Select a session"))
    .child(h_flex().gap(2).p(2).rounded(7).border(1).border_color(t.border)
      .children(Object.entries(THEMES).map(([key, value]) => div().id(`workspace-theme-${key}`).px(9).py(4).rounded(5).text_size(11)
        .text_color(t.foreground).when(workspaceTheme() === key, (el) => el.bg(t.selected))
        .cursor_pointer().hover((el) => el.bg(t.hover)).on_click(() => {
          setShared("ag.workspaceTheme", key);
          applyModeTheme(key);
        }).child(value.label))));
}
