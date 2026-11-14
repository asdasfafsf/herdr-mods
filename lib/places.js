// places.js (herdr-mods lib): where things are, the same way in every mod that asks.
// install.sh copies it beside each mod that imports "./places.js".

import { panes } from "herdr";

// Whether path is dir or inside it.
export const inside = (path, dir) => Boolean(path) && Boolean(dir) && (path === dir || path.startsWith(`${dir}/`));

// Where a space is now: its first terminal's live folder, else where it was made. `ps`:
// panes(), when the caller has read them already (each read copies every pane).
export function placeOf(space, ps = panes()) {
  if (!space) return null;
  const tabs = new Set((space.tabs ?? []).map((tab) => tab.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || space.folder || null;
}
