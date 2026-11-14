// The host owns rendering and input. This panel reuses the focused TerminalView;
// no screen scraping, duplicate session, or translated keystrokes are needed.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { layout, shared, setShared, run, focused, panes, agents, theme, window } from "herdr";
import { agentViewVisible, openAgentMode, leaveAgentMode, requestAgentSelection } from "./agent-mode.js";
import { button, statusMark, shownStatus, seenFor } from "./ui.js";
import { AGENT_INFO, ACKED, OPTIONS } from "./state.js";

export const DOCK = "agent-terminal-dock";
export const SURFACE = "agent-terminal-surface";
export const COMPOSER = "ag.composer";
const BAR_HEIGHT = 36;
function node(id, tree = layout()) {
  return tree?.id === id ? tree : tree?.children?.map((child) => node(id, child)).find(Boolean);
}
export const hasTerminalDock = () => Boolean(node(SURFACE));
export const terminalDockOpen = () => hasTerminalDock() && !node(SURFACE).hidden;

function focusTerminal(address = focused()?.terminal) {
  if (!address) return false;
  const pane = panes().find((pane) => pane.terminal === address);
  if (pane) run("pane.focus", { pane: pane.pane ?? pane.id });
  else run("agent.focus", { terminal: address });
  return true;
}

export function openTerminalDock(address = focused()?.terminal) {
  if (!hasTerminalDock() || !address) return false;
  if (!agentViewVisible()) openAgentMode();
  if (!terminalDockOpen()) {
    const height = Math.max(180, Math.min(Number(shared("ag.dockHeight")) || 320, (window()?.height || 1000) * 0.65));
    run("layout.resize", { id: DOCK, px: height });
    run("layout.show", { id: SURFACE });
  }
  focusTerminal(address);
  return true;
}

export function closeTerminalDock() {
  if (!terminalDockOpen()) return;
  const height = node(DOCK)?.size?.px;
  if (height > BAR_HEIGHT) setShared("ag.dockHeight", height);
  run("layout.hide", { id: SURFACE });
  run("layout.resize", { id: DOCK, px: BAR_HEIGHT });
}
export function toggleTerminalDock() {
  if (agentViewVisible() && terminalDockOpen()) closeTerminalDock();
  else openTerminalDock();
}

// Buttons delegate to the same native actions as the full Terminal presentation.
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

export function renderTerminalToolbar() {
  const t = theme(), address = focused()?.terminal, open = terminalDockOpen();
  const pane = panes().find((pane) => pane.terminal === address);
  const agent = agents().find((agent) => agent.address === address && !agent.parent);
  const info = shared(AGENT_INFO)?.[address];
  const status = shownStatus(agent?.status, { ...info, acked: shared(ACKED)?.[address] }, Date.now(), seenFor(shared(OPTIONS) ?? {}));
  return h_flex().id("terminal-dock-toolbar").size_full().px(10).gap(8).items_center()
    .border_t(1).border_color(t.border).bg(t.chrome)
    .child(button("terminal-dock-toggle", open ? "Collapse" : "Open terminal", () => toggleTerminalDock(), t)
      .tooltip("Show or collapse the terminal · ⌘⇧J"))
    .when(Boolean(agent), (el) => el.child(statusMark(t, status)))
    .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.foreground)
      .tooltip(`${pane?.title || "Terminal"} · ${address || "No session selected"}`)
      .child(address ? `${pane?.title || agent?.program?.name || "Terminal"} · ${address}` : "Select an agent to open its terminal"))
    .when(Boolean(address && open), (el) => el
      .child(button("terminal-dock-search", "Search", () => terminalAction("terminal.search", address), t).tooltip("Search terminal history · ⌘F"))
      .child(button("terminal-dock-image", "Paste image", () => terminalAction("terminal.paste_image", address), t).tooltip("Paste a copied image into this terminal · Ctrl+V. Files can also be dropped here."))
      .child(button("terminal-dock-compose", "Compose", () => showComposer(address), t).tooltip("Open a movable message draft"))
      .child(button("terminal-dock-expand", "Expand", () => { leaveAgentMode(); focusTerminal(address); }, t).tooltip("Open the full Terminal presentation · ⌘⇧E")));
}
