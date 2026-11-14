// Both themes share the overview's sessions, filters, pagination and actions.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { props, panes, focused, shared } from "herdr";
import { SPRITES } from "./theme-assets.js";
import { THEMES, VIEW_LAYOUTS, themeTokens } from "./themes.js";
import { inAgentMode, agentViewVisible, applyModeTheme, workspaceTheme } from "./agent-mode.js";

const ART = "mods/agents-plus/assets/chiikawa";
const SKINS = Object.entries(THEMES).map(([key, value]) => [key, value.label]);
export const RESIDENTS = THEMES.chiikawa.residents;

export function initAgentTheme(view, cx) {
  const saved = inAgentMode() ? workspaceTheme() : props()?.skin || localStorage.getItem("overview.theme");
  view.skin = SKINS.some(([key]) => key === saved) ? saved : "default";
  view.presentation = (inAgentMode() ? shared("ag.presentation") : localStorage.getItem("overview.chiikawaLayout")) === "cards" ? "cards" : "village";
  view.themeClock = 0;
  // Motion is on whenever this view opens. A pause belongs to this view's
  // current interaction, not a hidden preference inherited from an old session.
  view.motionPaused = false;
  view.overviewTab = panes().find((pane) => pane.mod === "agents-plus")?.tab;
  let previous = Date.now();
  cx.timer.every(50, (cx) => {
    const now = Date.now(), elapsed = Math.min(160, now - previous);
    previous = now;
    const saved = inAgentMode() ? workspaceTheme() : localStorage.getItem("overview.theme");
    if (inAgentMode() && THEMES[saved] && saved !== view.skin) { view.skin = saved; cx.notify(); }
    const presentation = shared("ag.presentation") || "village";
    if (inAgentMode() && view.presentation !== presentation) { view.presentation = presentation; cx.notify(); }
    if (view.skin !== "chiikawa" || view.motionPaused) return;
    // A slow render is not a hidden pane. In particular, typing or another
    // busy mod may leave a gap longer than 300ms while this tab is still shown.
    if (inAgentMode()) { if (!agentViewVisible()) return; }
    else {
      view.overviewTab ??= panes().find((pane) => pane.mod === "agents-plus")?.tab;
      if (view.overviewTab ? focused()?.tab !== view.overviewTab : now - (view.lastThemeRender ?? 0) > 300) return;
    }
    view.themeClock += elapsed;
    cx.notify();
  });
}

export function agentTheme(base, skin) {
  return inAgentMode() ? base : themeTokens(base, skin);
}

export function themeControls(view, t) {
  return h_flex().gap(4).items_center().flex_none().flex_wrap()
    .when(!inAgentMode(), (el) => el.child(h_flex().p(2).rounded(7).border(1).border_color(t.border)
      .children(SKINS.map(([key, label]) => div().id(`overview-theme-${key}`).px(9).py(5).rounded(5)
        .text_size(11).text_color(view.skin === key ? t.foreground : t.muted)
        .when(view.skin === key, (el) => el.bg(t.selected)).cursor_pointer().hover((el) => el.bg(t.hover))
        .on_click((_e, cx) => { view.skin = key; localStorage.setItem("overview.theme", key); applyModeTheme(key); cx.notify(); }).child(label)))))
    .when(view.skin === "chiikawa" && !inAgentMode(), (el) => el.child(h_flex().gap(2).p(2).rounded(7).border(1).border_color(t.border)
      .children(VIEW_LAYOUTS.map(([key, label]) => div().id(`overview-layout-${key}`).px(8).py(5).rounded(5).text_size(11)
        .text_color(t.foreground).when(view.presentation === key, (el) => el.bg(t.selected)).cursor_pointer()
        .on_click((_e, cx) => { view.presentation = key; localStorage.setItem("overview.chiikawaLayout", key); cx.notify(); }).child(label)))))
    .when(view.skin === "chiikawa", (el) => el.child(div().id("overview-motion").px(8).py(5).rounded(5)
      .text_size(11).text_color(t.muted).cursor_pointer().hover((el) => el.bg(t.hover))
      .on_click((_e, cx) => { view.motionPaused = !view.motionPaused; cx.notify(); })
      .child(view.motionPaused ? "Resume motion" : "Pause motion")));
}

function seed(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) n = (n * 31 + text.charCodeAt(i)) >>> 0;
  return n;
}

export function spriteFrame(name, clock) {
  const sprite = SPRITES[name];
  let time = ((clock % sprite.duration) + sprite.duration) % sprite.duration;
  let frame = 0;
  while (frame < sprite.frames - 1 && time >= sprite.durations[frame]) time -= sprite.durations[frame++];
  return `${ART}/${name}/${String(frame + 1).padStart(3, "0")}.png`;
}

export function agentSprite(view, row, roaming = false) {
  const clock = (view.themeClock ?? 0) + seed(row.id) % 12000;
  const name = roaming ? RESIDENTS[seed(row.id) % RESIDENTS.length] : row.status === "working" ? (clock % 12000 < 4000 ? "walk" : "study")
    : row.status === "blocked" ? "blocked" : row.status === "done" ? "done"
    : row.status === "seen" ? ["music", "idle", "done"][seed(row.id) % 3] : "idle";
  return { ...SPRITES[name], name, clock, path: spriteFrame(name, clock) };
}
