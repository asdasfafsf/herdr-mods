// Two presentations of one workspace. Native session focus remains the owner;
// a stack shows either the original terminal tree or the agent presentation.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { layout, shared, setShared, run, props, theme, themes, focused, panes, settings } from "herdr";
import { THEMES, themeDefinition } from "./themes.js";
import { VIEW_LAYOUTS, hasVillage, packDefinition } from "./resource-packs.js";
import { initResourcePack, selectedResourcePack } from "./resource-pack-state.js";
import { LEGACY_CHIIKAWA_COLORS } from "./legacy-theme.js";
import { setThemeContrast } from "./theme-contrast.js";
import { workspaceSplit, sceneVisible, showWorkspaceScene, showWorkspaceTerminal } from "./terminal-dock.js";

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

export const agentViewVisible = () => workspaceSplit() ? sceneVisible() : findViewStack()?.active === AGENT_VIEW;
export const AGENT_SELECTION = "ag.selection";
export function requestAgentSelection(id, address) {
  if (!agentViewVisible()) return;
  const sequence = (shared(AGENT_SELECTION)?.sequence || 0) + 1;
  setShared(AGENT_SELECTION, { id, address, sequence, at: Date.now() });
  return sequence;
}
const baseKey = () => `overview.baseLook.${shared("layout") || "main"}`;
// The effective native theme is the only authority, including Settings picks.
export function workspaceTheme() {
  const current = settings().theme;
  const fallback = layout()?.theme;
  const name = typeof current === "string" ? current
    : typeof fallback === "string" ? fallback : fallback?.[settings().dark ? "dark" : "light"];
  return Object.entries(THEMES).find(([, definition]) => definition.native === name)?.[0] || "default";
}

function savedLook() {
  const key = baseKey();
  let base = shared(key);
  if (!base) try { base = JSON.parse(localStorage.getItem(key) || "null"); } catch {}
  return base;
}

// Older Agent theme selection wrote one light theme into both appearance slots.
// Repair only our saved selection once; native Settings choices remain untouched.
export function migrateAppearanceTheme() {
  if (!findViewStack()) return;
  const key = `ag.themePairMigrated.${shared("layout") || "main"}`;
  if (shared(key)) return;
  const base = savedLook(), current = layout(), native = THEMES.chiikawa.native;
  const fixed = current.theme === native || (current.theme?.light === native && current.theme?.dark === native);
  if (fixed && (base || shared("ag.workspaceTheme") === "chiikawa")) {
    const darkThemes = new Set(themes().filter((entry) => !entry.light).map((entry) => entry.name));
    const previous = typeof base?.theme === "string" ? base.theme : base?.theme?.dark;
    const dark = darkThemes.has(previous) ? previous : "graphite";
    const next = JSON.parse(JSON.stringify(current));
    next.theme = { light: native, dark };
    run("layout.set", { layout: next });
  }
  setShared(key, true);
}

function clearLegacyColors(next, base) {
  if (!next.colors) return;
  // Remove only the values this mod used to inject. Preserve later user edits.
  for (const [key, value] of Object.entries(LEGACY_CHIIKAWA_COLORS)) {
    if (next.colors[key] !== value) continue;
    const original = base?.colors?.[key];
    if (original != null && original !== value) next.colors[key] = original;
    else delete next.colors[key];
  }
  if (!Object.keys(next.colors).length) delete next.colors;
}

export function migrateWorkspaceTheme() {
  if (!findViewStack()) return;
  const marker = `ag.nativeThemeMigrated.${shared("layout") || "main"}`;
  if (shared(marker)) return;
  const base = savedLook(), legacy = shared("ag.workspaceTheme");
  const current = layout(), next = JSON.parse(JSON.stringify(current));
  if (base || legacy != null) clearLegacyColors(next, base);
  if (JSON.stringify(current) !== JSON.stringify(next)) run("layout.set", { layout: next });
  if (legacy != null) setShared("ag.workspaceTheme", null);
  setShared(marker, true);
}

export function initWorkspaceTheme(cx) {
  initResourcePack(workspaceTheme());
  migrateAppearanceTheme();
  migrateWorkspaceTheme();
  let previous, previousLook;
  const sync = (cx) => {
    const current = workspaceTheme();
    if (current === "default") previousLook = { theme: layout()?.theme };
    if (current === previous) return;
    if (current !== "default" && previous === "default" && previousLook) setShared(baseKey(), previousLook);
    previous = current;
    cx.spawn(async (cx) => { await setThemeContrast(Boolean(themeDefinition(current).contrast)); cx.notify(); });
  };
  sync(cx);
  cx.timer.every(250, sync);
}

export function applyModeTheme(skin) {
  if (!findViewStack() || !THEMES[skin]) return;
  migrateAppearanceTheme();
  migrateWorkspaceTheme();
  const current = layout(), next = JSON.parse(JSON.stringify(current));
  let base = savedLook();
  if (skin !== workspaceTheme()) {
    if (THEMES[skin].native) {
      // Store the native look, not a separate current-theme flag. Settings and
      // every view read the same effective layout theme immediately afterward.
      base = { theme: next.theme, colors: next.colors };
      setShared(baseKey(), base);
      // Native selection replaces only the theme's light/dark half, preserving
      // the opposite appearance and the person's Appearance setting.
      run("app.theme", { name: THEMES[skin].native });
      return;
    } else {
      if (base?.theme == null) delete next.theme; else next.theme = base.theme;
      // A legacy backup may itself name our theme; Default must leave it.
      const nativeThemes = new Set(Object.values(THEMES).map((definition) => definition.native).filter(Boolean));
      if (nativeThemes.has(next.theme)) delete next.theme;
      else if (next.theme && typeof next.theme === "object") {
        if (nativeThemes.has(next.theme.light)) next.theme.light = "paper";
        if (nativeThemes.has(next.theme.dark)) next.theme.dark = "graphite";
      }
      setShared(baseKey(), null);
      localStorage.removeItem(baseKey());
    }
  }
  if (JSON.stringify(current) !== JSON.stringify(next)) run("layout.set", { layout: next });
}

export function setWorkspaceView(agent) {
  if (workspaceSplit()) { if (agent) showWorkspaceScene(); else showWorkspaceTerminal(); return; }
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
        .cursor_pointer().hover((el) => el.bg(t.hover)).tooltip("Switch Terminal / Agent · ⌘⇧E")
        .on_click(() => setWorkspaceView(value)).child(label))))
    .when(agent && hasVillage(selectedResourcePack()), (el) => el.child(h_flex().gap(2).p(2).rounded(7).border(1).border_color(t.border)
      .children(VIEW_LAYOUTS.map(([key, label]) => div().id(`overview-layout-${key}`).px(10).py(4).rounded(5).text_size(11)
        .text_color(t.foreground).when((shared("ag.presentation") || packDefinition(selectedResourcePack()).layout) === key, (el) => el.bg(t.selected))
        .cursor_pointer().hover((el) => el.bg(t.hover)).on_click(() => setShared("ag.presentation", key)).child(label)))))
    .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted)
      .child(pane?.title || "Select a session"));
}
