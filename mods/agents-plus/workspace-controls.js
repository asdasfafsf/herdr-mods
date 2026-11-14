import { nextCommand } from "herdr";
import { agentViewVisible, setWorkspaceView } from "./agent-mode.js";
import { toggleTerminalDock } from "./terminal-dock.js";

export function workspaceCommand(command) {
  if (command === "toggle_view") setWorkspaceView(!agentViewVisible());
  else if (command === "toggle_terminal") toggleTerminalDock();
}

// Commands are broadcast to every visible copy of a mod. Only the permanent
// workspace toolbar subscribes; the sidebar, scene and dock never toggle twice.
export function initWorkspaceControls(cx) {
  cx.spawn(async (cx) => {
    for (;;) {
      const command = await nextCommand();
      cx.notify();
      workspaceCommand(command);
    }
  });
}
