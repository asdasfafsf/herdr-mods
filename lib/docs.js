// docs.js (herdr-mods lib): Markdown files shown in md-view's pane, one way for every opener
// (⌘P's Docs view in picker-plus, an agent's `hm md` through spaces-plus): the rule for
// where one opens, and the list of a folder's Markdown files. install.sh copies it beside
// each mod that imports "./docs.js".

import { run, panes, focused, shared, setShared, exec } from "herdr";
import { DOC_PANES } from "./state.js";

export const MD_VIEW = "md-view";
// What counts as Markdown, by name.
export const MARKDOWN = /\.(md|markdown|mdx)$/i;

// Shows a file (absolute path; `on`: its machine, null here) in an md-view pane: the one in
// that tab already showing it, else a new one to the right of `pane` (a pane id; the focused
// one when not given). `focus`: the person picked it (⌘P), so it gets the keyboard; an
// agent's (hm md) leaves the keyboard where it is, since the person may be typing to that
// agent, and doesn't bring its tab to the front (pane.focus would). Returns
// { how: "focused" | "shown", pane } (already there) or { how: "opened", tab, before } (for noteOpened).
export function openDoc({ file, on = null, pane = null, focus = true }) {
  const all = panes();
  const at = pane ? all.find((p) => p.pane === pane) : all.find((p) => p.focused);
  const shown = shared(DOC_PANES) ?? {};
  const same = all.find((p) => p.mod === MD_VIEW && p.tab === at?.tab && shown[p.pane]?.file === file && (shown[p.pane]?.on ?? null) === (on ?? null));
  if (same) {
    if (focus) run("pane.focus", { pane: same.pane });
    return { how: focus ? "focused" : "shown", pane: same.pane };
  }
  const had = focused()?.pane ?? null;
  run("pane.split", { direction: "right", ...(at ? { pane: at.pane } : {}), mod: MD_VIEW, props: { file, on: on ?? null } });
  // If the split took the keyboard to the new pane, give it back.
  if (!focus && had) run("pane.focus", { pane: had });
  return { how: "opened", tab: at?.tab ?? null, before: all.filter((p) => p.mod === MD_VIEW).map((p) => p.pane) };
}

// The pane openDoc just opened, noted in DOC_PANES: its copy starts only once its tab is
// shown (an agent's often isn't), and asking for the file again before that should find it.
// Herdr adds the pane after run returns, so try a moment later, again until it's there.
// Returns its id, or null while it isn't.
export function noteOpened({ tab, before }, file, on = null) {
  const made = panes().filter((p) => p.mod === MD_VIEW && p.tab === tab && !before.includes(p.pane));
  if (made.length !== 1) return null;
  setShared(DOC_PANES, { ...(shared(DOC_PANES) ?? {}), [made[0].pane]: { file, on: on ?? null } });
  return made[0].pane;
}

// The Markdown files of the repo `folder` is in (Git's tracked and untracked ones, not the
// ignored), or of the folder itself outside a repo (5 levels down, no hidden folders or
// node_modules): { root, files: [{ path (from root), at (modified, s) }] }, newest first.
// `on`: that machine.
const LIST = `cd "$1" 2>/dev/null || exit 3
top=$(git rev-parse --show-toplevel 2>/dev/null) && cd "$top"
pwd
if [ -n "$top" ]; then git -c core.quotePath=false ls-files -co --exclude-standard -- '*.md' '*.MD' '*.markdown' '*.mdx'
else find . -maxdepth 5 \\( -name node_modules -o -name '.?*' \\) -prune -o -type f \\( -iname '*.md' -o -iname '*.markdown' -o -iname '*.mdx' \\) -print | sed 's|^\\./||'
fi | head -n 3000 | tr '\\n' '\\0' | { if stat -f %m . >/dev/null 2>&1; then xargs -0 -r stat -f '%m %N'; else xargs -0 -r stat -c '%Y %n'; fi; } 2>/dev/null
exit 0`;
export async function listDocs(folder, on = null) {
  const r = await exec("sh", ["-c", LIST, "docs", folder], { on });
  if (r.code !== 0) throw new Error(r.code === 3 ? `${folder} isn't there` : r.stderr.trim() || "Couldn't list the files");
  const [root, ...lines] = r.stdout.split("\n");
  const files = [];
  for (const line of lines) {
    const i = line.indexOf(" ");
    if (i > 0) files.push({ path: line.slice(i + 1), at: Number(line.slice(0, i)) || 0 });
  }
  files.sort((a, b) => b.at - a.at || a.path.localeCompare(b.path));
  return { root, files };
}
