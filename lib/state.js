// state.js (herdr-mods lib): the shared state the mods pass between them, in one place: the
// keys' names, what each holds, and the few helpers every user of one needs. A mod reads or
// writes these through the names here, never a string of its own, so a key or its shape
// changes in one file. install.sh copies it beside each mod that imports "./state.js".

import { shared, setShared } from "herdr";

// Per checkout, keyed by metaKey(machine, path): { name, branch, base, link, pr, comment,
// status, pinned, archived, unread, agent, created, newBranch }. Written by worktree-plus
// (creating), wt-menu (editing), spaces-plus (unread, removals); read by them and picker-plus.
export const META = "wt.meta";
// Every repo a space is in, from spaces-plus: { repo: { name, machine, checkouts: [{ path,
// branch, main, space, sleeping, pr }] } }. Read by picker-plus, agents-plus, worktree-plus, hm.
export const TREES = "wt.trees";
// Asleep worktrees and the sessions they resume on waking (spaces-plus, wt-menu).
export const SLEEP = "wt.sleep";
// How spaces-plus orders a repo's worktrees: activity | recent | name | created (wt-menu sets it).
export const SORT = "wt.sort";
// A link's address pattern the person sets, "https://tracker.example/browse/{key}" (spaces-plus).
export const LINK_TEMPLATE = "wt.linkTemplate";
// Session id -> the Herdr terminal running it, from wt-restore.
export const LIVE = "wt.live";
// When each space was last shown, { space id: ms }, from spaces-plus (⌘P's Recent order).
export const SEEN = "wt.seen";
// An agent's request (hm) and how it went: { request: { ok, path?, error?, at, ... } }.
export const RESULTS = "wt.results";
// Per repo (keyed by metaKey(machine, main checkout)): { setup, include } (worktree-plus).
export const REPOS = "wt.repos";
// The agents each machine reported last ({ machine or "": [program] }), and the one picked last.
export const KNOWN = "new-menu.agents";
export const LAST_AGENT = "wt.lastAgent";
// From agents-plus: per agent address { at (state changed, ms), doing, said }, and the order
// its list shows them in (addresses). Read by picker-plus's Agents view.
export const AGENT_INFO = "ag.info";
export const AGENT_ORDER = "ag.order";
// Done agents marked seen without being opened, { address: ms }: Herdr's done clears only by
// looking at the agent, and nothing outside it can clear it, so ours draw them as Seen
// (lib/ui.js's shownStatus) until the agent works again (agents-plus drops the mark).
export const ACKED = "ag.acked";
export const ackDone = (addresses) => {
  if (!addresses.length) return;
  const now = Date.now();
  setShared(ACKED, { ...(shared(ACKED) ?? {}), ...Object.fromEntries(addresses.map((a) => [a, now])) });
};
// The Markdown files md-view panes show, { pane id: { file, on } }: each copy writes its own
// (dropping panes that are gone), lib/docs.js notes one it opened and reads it so a file
// already shown isn't opened twice.
export const DOC_PANES = "md.panes";
// Each repo's color, { TREES key: "#rrggbb" }, from spaces-plus (lib/ui.js's REPO_PALETTE):
// given once and kept, the open repos all different while the palette lasts. The sidebar's
// repo avatar and the repo tags (Agents list, ⌘P) paint with it.
export const REPO_COLORS = "wt.repoColors";
// The person's choices for how things look, { name: value }. Every one is listed here with
// its default and what it does: the menus that show them (the Agents list's, the sidebar's
// repo avatar) and an agent (hm option, through spaces-plus's option@) set them the same way,
// and hm option with nothing lists this. A new choice is one line here and its use.
export const OPTIONS = "hm.options";
export const OPTION_DEFS = {
  // What shows is chosen per place (the Agents list, ⌘P); the colors are the same everywhere.
  agentsRepoNames: { default: true, was: "repoNames", group: "Agents list", label: "Repo names", about: "the repo's name, in its color, on each agent's row" },
  agentsNews: { default: true, was: "agentNews", group: "Agents list", label: "What each is doing", about: "the second line: what it's doing, what it asks, what it last said" },
  pickerRepoNames: { default: true, was: "repoNames", group: "⌘P", label: "Repo names", about: "the repo's name, in its color, on agent rows in the Agents view" },
  pickerNews: { default: true, was: "agentNews", group: "⌘P", label: "What each is doing", about: "what it's doing, asks or last said, on agent rows in the Agents view" },
  seen: { default: true, group: "Seen", label: "Seen", about: "an agent that finished and was looked at stays apart from Idle (purple), everywhere, for the time below" },
  seenMinutes: { default: 120, min: 5, max: 1440, steps: [30, 60, 120, 240, 480], group: "Seen", label: "Seen lasts", about: "how long Seen lasts, in minutes" },
  // The sidebar's worktrees as Orca's cards: compact (one line) or detailed (name and state;
  // then branch, ahead/behind and the badges; then each agent's activity), and which badges show.
  sidebarCards: { default: "compact", choices: ["compact", "detailed"], group: "Sidebar", label: "Card layout", about: "compact: a line per worktree; detailed: its branch and badges on a second line and what each agent is doing under it" },
  sidebarAgentNews: { default: true, group: "Sidebar", label: "Agent activity", about: "in the detailed layout: what each agent is doing, asks or last said, under its row" },
  prBadges: { default: true, group: "Sidebar", label: "Pull requests", about: "pull request state and checks on worktree rows" },
  linkBadges: { default: true, group: "Sidebar", label: "Tickets and links", about: "the linked ticket or URL on worktree rows" },
  noteBadges: { default: true, group: "Sidebar", label: "Notes", about: "the note (comment) on worktree rows" },
  portBadges: { default: true, group: "Sidebar", label: "Ports", about: "open ports on worktree rows" },
};
export const OPTION_DEFAULTS = Object.fromEntries(Object.entries(OPTION_DEFS).map(([k, d]) => [k, d.default]));
// `was`: the name before it was split per place. Pass a render snapshot to avoid
// reading/copying all settings per row; omitted means read the current shared value.
export const option = (name, set = shared(OPTIONS) ?? {}) => { return set[name] ?? set[OPTION_DEFS[name]?.was] ?? OPTION_DEFAULTS[name]; };
// Sets one; null back to its default. Returns what's wrong, or null.
export function setOption(name, value) {
  const d = OPTION_DEFS[name];
  if (!d) return `No option ${name}. Options: ${Object.keys(OPTION_DEFS).join(", ")}`;
  if (value !== null && d.choices && !d.choices.includes(value)) return `${name} takes ${d.choices.join(" or ")}`;
  if (value !== null && !d.choices && typeof value !== typeof d.default) return `${name} takes ${typeof d.default === "boolean" ? "on or off" : "a number"}`;
  const v = typeof value === "number" ? Math.min(d.max ?? Infinity, Math.max(d.min ?? -Infinity, Math.round(value))) : value;
  const { [name]: _old, ...rest } = shared(OPTIONS) ?? {};
  setShared(OPTIONS, v === null ? rest : { ...rest, [name]: v });
  return null;
}

// The repo colors by name (what a person or an agent says: "make owl blue"): eight that none
// of the states use, so a repo's color never reads as one. The first four are the sidebar's
// old teal, blue, orange and pink. lib/ui.js paints with them.
export const REPO_COLOR_NAMES = { teal: "#22a99a", blue: "#5b8def", orange: "#e3814f", pink: "#d9649a", cyan: "#36b5d8", brown: "#b48a5e", slate: "#8792a8", lime: "#8fbf3a" };
// Every repo's color back to automatic: spaces-plus gives the open ones different colors again
// on its next look (as many as the palette has; more repos than that share).
export const resetRepoColors = () => setShared(REPO_COLORS, {});

// Gives a repo (its TREES key) a color: a name above or #rrggbb; null: automatic again
// (spaces-plus gives it one on its next look). Returns what's wrong, or null.
export function setRepoColor(key, color) {
  const hex = color === null ? null : REPO_COLOR_NAMES[String(color).toLowerCase()] ?? (/^#[0-9a-f]{6}$/i.test(color) ? color : undefined);
  if (hex === undefined) return `No color ${color}: one of ${Object.keys(REPO_COLOR_NAMES).join(", ")}, #rrggbb or auto`;
  const { [key]: _old, ...rest } = shared(REPO_COLORS) ?? {};
  setShared(REPO_COLORS, hex === null ? rest : { ...rest, [key]: hex });
  return null;
}

// A checkout's key in META (and REPOS): its machine (null here) and path.
export const metaKey = (on, path) => JSON.stringify([on ?? null, path]);
export const metaOf = (on, path) => (shared(META) ?? {})[metaKey(on, path)] ?? {};
// Merges patch into a checkout's entry; key from metaKey.
export const setMeta = (key, patch) => {
  const all = shared(META) ?? {};
  setShared(META, { ...all, [key]: { ...(all[key] ?? {}), ...patch } });
};
// Drops a checkout's entry (its worktree is gone).
export const dropMeta = (key) => {
  const all = shared(META) ?? {};
  if (!(key in all)) return;
  const { [key]: _gone, ...rest } = all;
  setShared(META, rest);
};

// An agent's request (from hm) answered: RESULTS[request] = { ...result, at }, the last 20 kept.
export function answer(request, result) {
  if (!request) return;
  const kept = Object.entries(shared(RESULTS) ?? {}).sort(([, a], [, b]) => b.at - a.at).slice(0, 19);
  setShared(RESULTS, { ...Object.fromEntries(kept), [request]: { ...result, at: Date.now() } });
}

// The repo a space is in, from TREES: { key (its TREES key), name, branch, anchor }, anchor being the space the
// sidebar files the repo under (its primary checkout's, else the first open one's), whose
// color (shared "space.colors") is the repo's avatar color. null outside a repo the sidebar knows.
export function repoOfSpace(space) {
  for (const [key, r] of Object.entries(shared(TREES) ?? {})) {
    const cs = r.checkouts ?? [];
    const c = cs.find((x) => x.space === space);
    if (c) return { key, name: r.name, branch: c.branch ?? "detached", anchor: (cs.find((x) => x.main && x.space) ?? cs.find((x) => x.space))?.space ?? space };
  }
  return null;
}

// A shared value written only when it changed (a shared write makes every mod draw again).
// `last` holds what was written before: an object the caller keeps, { text }.
export function setIfChanged(key, value, last) {
  const text = JSON.stringify(value);
  if (text === last.text) return false;
  last.text = text;
  setShared(key, value);
  return true;
}
