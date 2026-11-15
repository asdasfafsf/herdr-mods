import { nextCommand } from "herdr";
import { cycleWorkspacePresentation, restoreWorkspacePresentation, toggleTerminalDock, restoreWorkspaceSplit, adjustWorkspaceSplit, syncWorkspaceSplit } from "./terminal-dock.js";

export function workspaceCommand(command) {
  if (command === "toggle_view") cycleWorkspacePresentation();
  else if (command === "toggle_terminal") toggleTerminalDock();
  else if (command === "restore_split") restoreWorkspaceSplit();
  else if (command === "more_terminal") adjustWorkspaceSplit(-0.1);
  else if (command === "more_scene") adjustWorkspaceSplit(0.1);
}

// Commands are broadcast to every copy of a mod. Only the permanent split
// handle subscribes; it stays mounted even when scene or terminal reaches zero.
export function initWorkspaceControls(cx) {
  restoreWorkspacePresentation();
  cx.timer.every(120, syncWorkspaceSplit);
  cx.spawn(async (cx) => {
    for (;;) {
      const command = await nextCommand();
      workspaceCommand(command);
      cx.notify();
    }
  });
}
