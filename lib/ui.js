// ui.js (herdr-mods lib): what our mods draw the same way: an agent's state, the buttons at
// the bottom of dialogs, and how long ago something was. One source of data (agents()'
// status), one look: change it here and the sidebar, the Agents list and ⌘P follow. install.sh copies it beside each mod that
// imports "./ui.js", as it does resume.js. Change it here, then run install.sh.

import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { shared } from "herdr";
import { REPO_COLORS, REPO_COLOR_NAMES } from "./state.js";
import { statusInfo, statusColor } from "./agent-status.js";
export { AGENT_STATUSES, STATUS_FILTERS, STATUS_RANK, STATUS_LABEL, normalizeStatus, statusInfo, statusLabel, statusRank, statusColor, statusNotice, shownStatus, seenFor } from "./agent-status.js";

// A button: `kind` "primary" (the dialog's action: ink on paper), "danger" (an action that
// deletes), or "plain" (Cancel, Close). Disabled, it's dimmed and does nothing.
// `onClick(cx)` gets the click's context.
export function button(id, label, onClick, t, { kind = "plain", disabled = false } = {}) {
  let el = div().id(id).h(30).px(kind === "plain" ? 12 : 14).flex().flex_none().items_center().rounded(6).text_size(13);
  if (kind === "primary") el = el.bg(t.solid).text_color(t.solid_foreground);
  else if (kind === "danger") el = el.bg(t.blocked).text_color("#ffffff");
  else el = el.text_color(t.muted);
  if (disabled) return el.opacity(0.5).child(label);
  return el.cursor_pointer()
    .hover((s) => (kind === "plain" ? s.bg(t.hover).text_color(t.foreground) : s.opacity(0.88)))
    .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); })
    .child(label);
}

// A dialog's bottom row: its keys, dim, on the left; its buttons on the right, the main
// one last. Falsy buttons are left out; an array of them counts as its buttons.
export function footer(hint, t, ...buttons) {
  return h_flex().gap(8).items_center()
    .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(hint ?? ""))
    .children(buttons.flat().filter(Boolean));
}

// How long ago a time was, short: "<1m", "12m", "3h", "2d", "3mo". Takes epoch seconds or ms.
export function ago(when) {
  const ms = when > 1e12 ? when : when * 1000;
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  const d = Math.floor(m / 1440);
  return d < 60 ? `${d}d` : `${Math.floor(d / 30)}mo`;
}

// The same, as words: "just now", "12m ago".
export const agoText = (when) => { const a = ago(when); return a === "<1m" ? "just now" : `${a} ago`; };

// An agent's state, the same mark everywhere (the sidebar's rows, the Agents list, ⌘P):
// working a spinner, blocked a red "!", done a green dot, idle a dim ring; null for none.
// Seen: an agent that finished and was looked at (Herdr turns its done into idle then) but
// wasn't answered, for seenFor() after that: what you saw and moved on from doesn't sink into
// Idle at once. agents-plus stamps when (shared ag.info[address].seen, ms); shownStatus says
// which state to draw from Herdr's and that. Any agent that reports a state, Claude, Codex or other.
// How long, ms: the seenMinutes option (default two hours: long enough for a meeting or lunch,
// short enough that half a day ago is gone); none when the seen option is off.
// An optional options snapshot lets one render use the same settings for every row.
export function statusMark(t, status) {
  const definition = statusInfo(status), color = statusColor(t, status);
  if (definition.mark === "spinner") return svg(definition.icon).size(12).flex_none().text_color(color).spin(900);
  if (definition.mark === "attention") return div().size(14).flex_none().rounded(4).bg(color + "26").text_size(10).font_bold().text_color(color).flex().items_center().justify_center().child("!");
  if (definition.mark === "dot") return div().size(7).mx(3).flex_none().rounded(4).bg(color);
  if (definition.mark === "ring") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(color);
  return null;
}

// Where there's room: the label in a pill tinted with its state's color, a spinner first
// while it works; idle (no label) its mark alone.
export function statusPill(t, status) {
  const definition = statusInfo(status);
  const label = definition.compact ? null : definition.label;
  if (!label) return statusMark(t, status);
  const color = statusColor(t, status);
  return tinted(color, h_flex().flex_none().h(20).px(8).gap(5).items_center().rounded(6))
    .when(definition.mark === "spinner", (el) => el.child(svg(definition.icon).size(11).flex_none().text_color(color).spin(900)))
    .child(div().text_size(11).font_semibold().text_color(color).child(label));
}

// A space color as paint: a theme color name ("ansi6") as the sidebar paints it, or #rrggbb.
// The same table as the sidebar's (spaces-plus and picker-plus keep theirs, from Herdr's code).
const SPACE_MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
export const spaceFill = (t, color = "ansi6") => (color.startsWith("#") ? color : SPACE_MARK[color] ?? t[color]);

// Repo colors (state.js's REPO_COLORS), from state.js's REPO_COLOR_NAMES: none of the states'
// (blocked red, working yellow, done green, seen purple), so a repo's color never reads as a state.
export const REPO_PALETTE = Object.values(REPO_COLOR_NAMES);
// A repo's color: the one spaces-plus gave it, else its anchor space's (repoOfSpace).
// colors, when supplied, is a per-render { repos, spaces } snapshot. Without it
// preserve live reads for other mods and event handlers.
export const repoFill = (t, repo, colors) =>
  (colors ? colors.repos : shared(REPO_COLORS) ?? {})[repo.key] ??
  spaceFill(t, (colors ? colors.spaces : shared("space.colors") ?? {})[repo.anchor]);

// A repo's name for rows that say which repo an agent works in (the Agents list, ⌘P): the name
// in its color (the sidebar's repo avatar's), no background, so it stands out and tells repos
// apart without a block of color competing with the states. `repo`: state.js's repoOfSpace.
export function repoTag(t, repo, max = 110, colors) {
  return div().flex_none().max_w(max).truncate().text_size(11).font_medium().text_color(repoFill(t, repo, colors)).child(repo.name);
}

// A label in a pill tinted with any color (⌘P's Active).
export function pill(color, label) {
  return tinted(color, h_flex().flex_none().h(20).px(8).items_center().rounded(6))
    .child(div().text_size(11).font_semibold().text_color(color).child(label));
}

// el with a faint layer of color under it (whatever form the theme gives the color in).
function tinted(color, el) {
  return el.relative().child(div().absolute().inset_0().rounded(6).bg(color).opacity(0.16));
}
