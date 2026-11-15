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
export const PRESENTATIONS = [["scene", "Scene"], ["split", "Split"], ["terminal", "Terminal"]];
const DEFAULT_SHARE = 0.5, EDGE_SHARE = 0.05, NATIVE_DRAG_MIN = 24;
const find = (id, tree) => tree?.id === id ? tree : tree?.children?.map((child) => find(id, child)).find(Boolean);
const scope = () => String(shared("layout") || layout()?.id || "main");
const restoreKey = () => `ag.workspaceSplit.${scope()}`;
const presentationKey = () => `ag.workspacePresentation.${scope()}`;
const measureKey = () => `ag.workspaceSceneSize.${scope()}`;
let activeScope;

export function workspaceSplit() {
  const tree = layout(), workspace = find(WORKSPACE, tree);
  if (workspace?.type !== "column") return null;
  const scene = workspace.children?.find((child) => child.id === SCENE);
  const dock = workspace.children?.find((child) => child.id === DOCK);
  const surface = find(SURFACE, dock);
  if (!scene || !dock || !surface) return null;
  const a = Number(scene.size?.weight), b = Number(dock.size?.weight);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) return null;
  // The host may publish between the two resize commands at an endpoint.
  // Keep accepting cycle commands while both temporary weights are zero.
  const saved = a + b === 0 ? shared(presentationKey()) : null;
  return { scene, dock, surface, transient: a + b === 0,
    sceneShare: a + b > 0 ? a / (a + b) : validPresentation(saved) ? presentationShare(saved) : DEFAULT_SHARE };
}
export const hasTerminalDock = () => Boolean(workspaceSplit());
export const sceneVisible = () => { const split = workspaceSplit(); return Boolean(split && !split.scene.hidden && split.sceneShare > 0); };
export const terminalDockOpen = () => { const split = workspaceSplit(); return Boolean(split && !split.surface.hidden && split.sceneShare < 1); };

const intermediate = (share) => Number.isFinite(share) && share > EDGE_SHARE && share < 1 - EDGE_SHARE;
const modeFor = (share) => share === 0 ? "terminal" : share === 1 ? "scene" : "split";
const sameShare = (a, b) => Math.abs(a - b) < 0.0001;
const validPresentation = (state) => PRESENTATIONS.some(([mode]) => mode === state?.mode) && intermediate(state.splitShare);

// One persisted state for commands, buttons, native drag and reload. The native
// tab tree still owns session selection; never persist a second session address.
export function workspacePresentation() {
  const split = workspaceSplit();
  if (!split) return null;
  const saved = shared(presentationKey());
  if (validPresentation(saved)) return saved;
  const legacy = Number(shared(restoreKey()));
  const share = split.sceneShare;
  return { mode: modeFor(share), splitShare: intermediate(share) ? share : intermediate(legacy) ? legacy : DEFAULT_SHARE, sequence: 0 };
}
const presentationShare = (state) => state.mode === "scene" ? 1 : state.mode === "terminal" ? 0 : state.splitShare;

function applyShare(share) {
  const split = workspaceSplit();
  if (!split) return false;
  // Never hide either node: the native separator must remain available at both
  // endpoints. The dock's minimum leaves only its 20 px handle when closed.
  if (split.scene.hidden) run("layout.show", { id: SCENE });
  if (split.surface.hidden) run("layout.show", { id: SURFACE });
  // Always enqueue both weights. During rapid Cmd+E presses layout() can still
  // be an earlier host snapshot, including the endpoint we are returning to.
  run("layout.resize", { id: SCENE, weight: share });
  run("layout.resize", { id: DOCK, weight: 1 - share });
  return true;
}

function setSplit(share, { focus = true, remember = true } = {}) {
  const previous = workspacePresentation(), split = workspaceSplit();
  if (!previous || !Number.isFinite(share)) return false;
  activeScope = scope();
  share = Math.max(0, Math.min(1, share));
  // A released divider can be newer than the controller's next poll. Remember
  // it unless the host is still applying a presentation request.
  const released = remember && !requestPending(previous) && intermediate(split.sceneShare) ? split.sceneShare : previous.splitShare;
  const state = { mode: modeFor(share), splitShare: intermediate(share) ? share : released,
    sequence: (previous.sequence || 0) + 1, requestedAt: Date.now(), focusScene: focus && share === 1 };
  setShared(presentationKey(), state);
  applyShare(share);
  return true;
}

const requestPending = (state) => Number.isFinite(state.requestedAt) && Date.now() - state.requestedAt < 500;
export function setWorkspacePresentation(mode, address = focused()?.terminal) {
  const state = workspacePresentation();
  if (!state || !PRESENTATIONS.some(([key]) => key === mode)) return false;
  const share = mode === "scene" ? 1 : mode === "terminal" ? 0 : state.splitShare;
  setSplit(share);
  if (mode !== "scene") focusTerminal(address);
  return true;
}
export function cycleWorkspacePresentation() {
  const state = workspacePresentation();
  if (!state) return false;
  return setWorkspacePresentation(PRESENTATIONS[(PRESENTATIONS.findIndex(([mode]) => mode === state.mode) + 1) % PRESENTATIONS.length][0]);
}
export function restoreWorkspacePresentation() {
  const state = workspacePresentation();
  if (!state) return false;
  activeScope = scope();
  // Seed old layouts without changing their current ratio; subsequent mounts
  // restore the common state even if the host saved an intermediate snapshot.
  if (!shared(presentationKey())) { setShared(presentationKey(), state); return true; }
  return setSplit(presentationShare(state), { focus: state.mode === "scene", remember: false });
}
export function syncWorkspaceSceneFocus(view) {
  const state = workspacePresentation();
  const sequence = `${scope()}:${state?.sequence}`;
  if (!state || view.workspaceFocusSequence === sequence) return;
  if (state.mode === "scene" && state.focusScene && !sceneVisible()) return;
  view.workspaceFocusSequence = sequence;
  if (state.mode === "scene" && state.focusScene && sceneVisible()) view.handle.focus();
}
export const currentPresentationRequest = (request) => request?.presentationSequence == null
  || request.presentationSequence === workspacePresentation()?.sequence;
export function restoreWorkspaceSplit() {
  return setWorkspacePresentation("split");
}
export function showWorkspaceScene() {
  return sceneVisible() || setWorkspacePresentation("scene");
}
export function showWorkspaceTerminal(address = focused()?.terminal) {
  return setWorkspacePresentation("terminal", address);
}
export function adjustWorkspaceSplit(delta) {
  const state = workspacePresentation();
  if (!state || !Number.isFinite(delta)) return false;
  let share = Math.max(0, Math.min(1, presentationShare(state) + delta));
  if (share < EDGE_SHARE) share = 0;
  if (share > 1 - EDGE_SHARE) share = 1;
  return setSplit(share);
}

function focusTerminal(address = focused()?.terminal) {
  if (!address) return false;
  const pane = panes().find((pane) => pane.terminal === address);
  const id = pane?.pane ?? pane?.id;
  if (!id) return false;
  run("pane.focus", { pane: id });
  return true;
}
export function openTerminalDock(address = focused()?.terminal) {
  if (!hasTerminalDock()) return false;
  if (address && !panes().some((pane) => pane.terminal === address && (pane.pane ?? pane.id))) return false;
  if (workspacePresentation().mode === "scene") setSplit(workspacePresentation().splitShare);
  focusTerminal(address);
  return true;
}
export const closeTerminalDock = () => setWorkspacePresentation("scene");
export function toggleTerminalDock() {
  return workspacePresentation()?.mode === "scene" ? restoreWorkspaceSplit() : closeTerminalDock();
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
  if (!split) { activeScope = null; previousSplit = null; pendingSplit = null; return; }
  if (activeScope !== scope()) { restoreWorkspacePresentation(); return; }
  if (split.transient) return;
  const signature = `${scope()}:${split.sceneShare}`;
  const state = workspacePresentation();
  // Programmatic ratios are already authoritative. In particular, a late size
  // callback from a collapsed scene must never snap a freshly restored split.
  if (sameShare(split.sceneShare, presentationShare(state))) {
    if (state.requestedAt !== undefined) {
      const { requestedAt, ...settled } = state;
      setShared(presentationKey(), settled);
    }
    previousSplit = signature; pendingSplit = null; return;
  }
  if (requestPending(state)) return;
  if (signature !== previousSplit) {
    previousSplit = signature;
    pendingSplit = { signature, at: Date.now() };
  }
  // Let the final on_size_change measurement catch up with the released native
  // layout snapshot. Reading a previous frame can collapse the wrong side.
  if (!pendingSplit || Date.now() - pendingSplit.at < 100) return;
  const observedAt = pendingSplit.at;
  pendingSplit = null;
  const share = split.sceneShare;
  const measured = shared(measureKey());
  const height = measured && measured.at >= observedAt - 100 && Date.now() - measured.at < 1000 ? measured.height : 0;
  const dockHeight = height > 0 ? height * (1 - share) / share : Infinity;
  if (share <= EDGE_SHARE || (height > 0 && height <= NATIVE_DRAG_MIN + 0.5)) {
    setSplit(0, { remember: false });
    focusTerminal();
  }
  else if (share >= 1 - EDGE_SHARE || dockHeight <= NATIVE_DRAG_MIN + 0.5) setSplit(1, { remember: false });
  else setShared(presentationKey(), { mode: "split", splitShare: share, sequence: state.sequence || 0 });
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
  setShared(COMPOSER, { address, sequence: (previous?.sequence || 0) + 1, presentationSequence: workspacePresentation()?.sequence });
  requestAgentSelection(address, address);
}

function handleButton(id, label, tooltip, action, t, selected = false) {
  return div().id(id).h_full().px(7).flex().items_center().text_size(10).text_color(t.muted)
    .when(selected, (el) => el.bg(t.selected).text_color(t.foreground))
    .cursor_pointer().hover((el) => el.bg(t.hover).text_color(t.foreground)).tooltip(tooltip)
    .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
    .on_click((_event, cx) => { cx.stop_propagation(); action(); }).child(label);
}
export function renderTerminalToolbar() {
  const t = theme(), address = focused()?.terminal;
  const pane = panes().find((pane) => pane.terminal === address);
  const mode = workspacePresentation()?.mode;
  return h_flex().id("terminal-dock-toolbar").size_full().gap(4).items_center().bg(t.chrome)
    .tooltip("Drag the top edge to resize · double-click to restore the split")
    .on_mouse_down("left", (event, cx) => { if (event.click_count === 2) { cx.stop_propagation(); restoreWorkspaceSplit(); } })
    .child(handleButton("terminal-dock-toggle", "Scene", "Scene only · Cycle view with ⌘E", closeTerminalDock, t, mode === "scene"))
    .child(handleButton("terminal-dock-restore", "Split", "Scene and terminal · Restore the last split", restoreWorkspaceSplit, t, mode === "split"))
    .child(handleButton("terminal-dock-expand", "Terminal", "Terminal only · Cycle view with ⌘E", () => showWorkspaceTerminal(), t, mode === "terminal"))
    .child(div().flex_1().min_w(0).truncate().text_size(10).text_color(t.muted)
      .child(pane?.title || "Select a terminal tab"));
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
