// One workspace: native divider above the native tab tree. The host owns the
// drag, terminal focus/input, pane splits and scrollback; no pointer forwarding.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { layout, shared, setShared, run, focused, panes, theme } from "herdr";
import { requestAgentSelection } from "./agent-mode.js";

export const WORKSPACE = "workspace-views";
export const SCENE = "agent-scene";
export const DOCK = "agent-terminal-dock";
export const SURFACE = "agent-terminal-surface";
export const COMPOSER = "ag.composer";
export const HANDLE_HEIGHT = 20;
const DEFAULT_SHARE = 0.6, EDGE_SHARE = 0.05, NATIVE_DRAG_MIN = 24;
const find = (id, tree) => tree?.id === id ? tree : tree?.children?.map((child) => find(id, child)).find(Boolean);
const scope = () => String(shared("layout") || layout()?.id || "main");
const restoreKey = () => `ag.workspaceSplit.${scope()}`;
const measureKey = () => `ag.workspaceSceneSize.${scope()}`;

export function workspaceSplit() {
  const tree = layout(), workspace = find(WORKSPACE, tree);
  if (workspace?.type !== "column") return null;
  const scene = workspace.children?.find((child) => child.id === SCENE);
  const dock = workspace.children?.find((child) => child.id === DOCK);
  const surface = find(SURFACE, dock);
  if (!scene || !dock || !surface) return null;
  const a = Number(scene.size?.weight), b = Number(dock.size?.weight);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0 || a + b <= 0) return null;
  return { scene, dock, surface, sceneShare: a / (a + b) };
}
export const hasTerminalDock = () => Boolean(workspaceSplit());
export const sceneVisible = () => { const split = workspaceSplit(); return Boolean(split && !split.scene.hidden && split.sceneShare > 0); };
export const terminalDockOpen = () => { const split = workspaceSplit(); return Boolean(split && !split.surface.hidden && split.sceneShare < 1); };

function rememberSplit(share) {
  if (!(share > EDGE_SHARE && share < 1 - EDGE_SHARE)) return;
  if (Math.abs(Number(shared(restoreKey())) - share) > 0.0001 || shared(restoreKey()) == null) setShared(restoreKey(), share);
}
function setSplit(share, remember = true) {
  const split = workspaceSplit();
  if (!split || !Number.isFinite(share)) return false;
  share = Math.max(0, Math.min(1, share));
  if (remember) rememberSplit(split.sceneShare);
  // Never hide either node: the native separator must remain available at both
  // endpoints. The dock's minimum leaves only its 20 px handle when closed.
  if (split.scene.hidden) run("layout.show", { id: SCENE });
  if (split.surface.hidden) run("layout.show", { id: SURFACE });
  if (Math.abs(split.sceneShare - share) > 0.0001) {
    run("layout.resize", { id: SCENE, weight: share });
    run("layout.resize", { id: DOCK, weight: 1 - share });
  }
  return true;
}
export function restoreWorkspaceSplit() {
  const saved = Number(shared(restoreKey()));
  return setSplit(saved > EDGE_SHARE && saved < 1 - EDGE_SHARE ? saved : DEFAULT_SHARE, false);
}
export function showWorkspaceScene() {
  return sceneVisible() || restoreWorkspaceSplit();
}
export function showWorkspaceTerminal(address = focused()?.terminal) {
  if (!setSplit(0)) return false;
  focusTerminal(address);
  return true;
}
export function toggleWorkspaceScene() {
  return sceneVisible() ? showWorkspaceTerminal() : restoreWorkspaceSplit();
}
export function adjustWorkspaceSplit(delta) {
  const split = workspaceSplit();
  if (!split || !Number.isFinite(delta)) return false;
  let share = Math.max(0, Math.min(1, split.sceneShare + delta));
  if (share < EDGE_SHARE) share = 0;
  if (share > 1 - EDGE_SHARE) share = 1;
  return setSplit(share);
}

function focusTerminal(address = focused()?.terminal) {
  if (!address) return false;
  const pane = panes().find((pane) => pane.terminal === address);
  if (pane) run("pane.focus", { pane: pane.pane ?? pane.id });
  else run("agent.focus", { terminal: address });
  return true;
}
export function openTerminalDock(address = focused()?.terminal) {
  if (!hasTerminalDock()) return false;
  if (!terminalDockOpen()) restoreWorkspaceSplit();
  focusTerminal(address);
  return true;
}
export const closeTerminalDock = () => setSplit(1);
export function toggleTerminalDock() {
  return terminalDockOpen() ? closeTerminalDock() : openTerminalDock();
}

// Native drag snapshots publish on release, not on every mouse move. At that
// point snap the host's hard 24 px stop to a true endpoint. A debounced scene
// measurement also covers small windows where 24 px exceeds five percent.
let pendingMeasurement, measurementTask;
export function noteSceneSize(height, cx) {
  if (!Number.isFinite(height) || height < 0 || !workspaceSplit()) return;
  pendingMeasurement = { key: measureKey(), height };
  if (measurementTask) return;
  measurementTask = cx.timer.after(80, () => {
    const { key, height } = pendingMeasurement;
    setShared(key, { height, at: Date.now() });
    measurementTask = null;
  });
}
let previousSplit, pendingSplit;
export function syncWorkspaceSplit() {
  const split = workspaceSplit();
  if (!split) { previousSplit = null; pendingSplit = null; return; }
  const signature = `${scope()}:${split.sceneShare}`;
  if (signature !== previousSplit) {
    previousSplit = signature;
    pendingSplit = { signature, at: Date.now() };
  }
  // Let the final on_size_change measurement catch up with the released native
  // layout snapshot. Reading a previous frame can collapse the wrong side.
  if (!pendingSplit || Date.now() - pendingSplit.at < 100) return;
  pendingSplit = null;
  const share = split.sceneShare;
  if (share === 0 || share === 1) return;
  const measured = shared(measureKey());
  const height = measured && Date.now() - measured.at < 1000 ? measured.height : 0;
  const dockHeight = height > 0 ? height * (1 - share) / share : Infinity;
  if (share <= EDGE_SHARE || (height > 0 && height <= NATIVE_DRAG_MIN + 0.5)) setSplit(0, false);
  else if (share >= 1 - EDGE_SHARE || dockHeight <= NATIVE_DRAG_MIN + 0.5) setSplit(1, false);
  else rememberSplit(share);
}

// Compatibility for scene actions. The terminal still owns search, clipboard
// and image paste; the split handle does not duplicate its composer controls.
export function terminalAction(command, address = focused()?.terminal) {
  if (!["terminal.search", "terminal.paste", "terminal.paste_image", "terminal.copy"].includes(command)) return;
  if (openTerminalDock(address)) run(command);
}
export function showComposer(address = focused()?.terminal) {
  if (!address) return;
  const previous = shared(COMPOSER);
  setShared(COMPOSER, { address, sequence: (previous?.sequence || 0) + 1 });
  requestAgentSelection(address, address);
}

function handleButton(id, label, tooltip, action, t) {
  return div().id(id).h_full().px(7).flex().items_center().text_size(10).text_color(t.muted)
    .cursor_pointer().hover((el) => el.bg(t.hover).text_color(t.foreground)).tooltip(tooltip)
    .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
    .on_click((_event, cx) => { cx.stop_propagation(); action(); }).child(label);
}
export function renderTerminalToolbar() {
  const t = theme(), address = focused()?.terminal;
  const pane = panes().find((pane) => pane.terminal === address);
  return h_flex().id("terminal-dock-toolbar").size_full().gap(4).items_center().bg(t.chrome)
    .tooltip("Drag the top edge to resize · double-click to restore the split")
    .on_mouse_down("left", (event, cx) => { if (event.click_count === 2) { cx.stop_propagation(); restoreWorkspaceSplit(); } })
    .child(handleButton("terminal-dock-expand", "▴", "Terminal only · ⌘⇧E", () => showWorkspaceTerminal(), t))
    .child(div().flex_1().min_w(0).truncate().text_size(10).text_color(t.muted)
      .child(pane?.title || (address ? "Terminal" : "Workspace")))
    .child(handleButton("terminal-dock-restore", "↕", "Restore split · double-click the handle", restoreWorkspaceSplit, t))
    .child(handleButton("terminal-dock-toggle", "▾", "Scene only · ⌘⇧J", closeTerminalDock, t));
}

// The old Agent view tab contains a mod, not a terminal. Keep the tab intact
// and let Terminal only show it again without selecting or starting a session.
export function renderOverviewTerminalPlaceholder() {
  const t = theme();
  return v_flex().id("terminal-empty-overview").size_full().p(24).gap(8).items_center().justify_center().bg(t.background)
    .child(div().font_medium().text_color(t.foreground).child("No terminal in this pane"))
    .child(div().text_size(12).text_color(t.muted).text_center()
      .child("Agent view is already shown above. Select a terminal tab to see its output here."))
    .child(div().id("terminal-empty-agent-view").px(10).py(6).rounded(6).text_size(12).text_color(t.foreground)
      .border(1).border_color(t.border).cursor_pointer().hover((el) => el.bg(t.hover))
      .on_click((_event, cx) => { cx.stop_propagation(); showWorkspaceTerminal(null); })
      .child("Show Agent view here"));
}
