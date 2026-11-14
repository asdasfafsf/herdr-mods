// Both themes share the overview's sessions, filters, pagination and actions.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { props, panes, focused, shared, setShared } from "herdr";
import { THEMES, VIEW_LAYOUTS, themeTokens, themeDefinition, residentPool, hasResidents, hasVillage } from "./themes.js";
import { inAgentMode, agentViewVisible, applyModeTheme, workspaceTheme } from "./agent-mode.js";
import { finishDrag } from "./drag-layout.js";
import { frameFacing } from "./sprite-directions.js";

const SKINS = Object.entries(THEMES).map(([key, value]) => [key, value.label]);
const preferredPresentation = (skin) => (inAgentMode() ? shared("ag.presentation")
  : localStorage.getItem("overview.presentation") || localStorage.getItem("overview.chiikawaLayout")) || themeDefinition(skin).layout || "cards";

export function initAgentTheme(view, cx) {
  const saved = inAgentMode() ? workspaceTheme() : props()?.skin || localStorage.getItem("overview.theme");
  view.skin = SKINS.some(([key]) => key === saved) ? saved : "default";
  view.presentation = preferredPresentation(view.skin);
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
    if (inAgentMode() && THEMES[saved] && saved !== view.skin) { finishDrag(view, null, cx); view.skin = saved; cx.notify(); }
    const presentation = shared("ag.presentation") || themeDefinition(view.skin).layout || "cards";
    if (inAgentMode() && view.presentation !== presentation) { finishDrag(view, null, cx); view.presentation = presentation; cx.notify(); }
    if (inAgentMode() && !agentViewVisible()) { finishDrag(view, null, cx); return; }
    // A slow render is not a hidden pane. In particular, typing or another
    // busy mod may leave a gap longer than 300ms while this tab is still shown.
    if (!inAgentMode()) {
      view.overviewTab ??= panes().find((pane) => pane.mod === "agents-plus")?.tab;
      if (view.overviewTab ? focused()?.tab !== view.overviewTab : now - (view.lastThemeRender ?? 0) > 300) { finishDrag(view, null, cx); return; }
    }
    if (!hasResidents(view.skin) || view.motionPaused) return;
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
        .on_click((_e, cx) => { finishDrag(view, null, cx); view.skin = key; view.presentation = preferredPresentation(key); localStorage.setItem("overview.theme", key); applyModeTheme(key); cx.notify(); }).child(label)))))
    .when(hasVillage(view.skin), (el) => el.child(h_flex().gap(2).p(2).rounded(7).border(1).border_color(t.border)
      .children(VIEW_LAYOUTS.map(([key, label]) => div().id(`overview-layout-${key}`).px(8).py(5).rounded(5).text_size(11)
        .text_color(t.foreground).when(view.presentation === key, (el) => el.bg(t.selected)).cursor_pointer()
        .on_click((_e, cx) => { finishDrag(view, null, cx); view.presentation = key; if (inAgentMode()) setShared("ag.presentation", key); else localStorage.setItem("overview.presentation", key); cx.notify(); }).child(label)))));
}

export function motionControl(view, t) {
  if (!hasResidents(view.skin)) return div();
  return div().id("overview-motion").px(9).py(6).rounded(6).text_size(11)
    .text_color(t.foreground).cursor_pointer().hover((el) => el.bg(t.hover))
    .on_click((_e, cx) => { view.motionPaused = !view.motionPaused; cx.notify(); })
    .child(view.motionPaused ? "Resume animation" : "Pause animation");
}

function seed(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) n = (n * 31 + text.charCodeAt(i)) >>> 0;
  return n;
}

export function spriteFrame(skin, name, clock, facing) {
  const definition = themeDefinition(skin), sprite = definition.sprites[name];
  let time = ((clock % sprite.duration) + sprite.duration) % sprite.duration;
  let frame = 0;
  while (frame < sprite.frames - 1 && time >= sprite.durations[frame]) time -= sprite.durations[frame++];
  const file = String(frame + 1).padStart(3, "0");
  const nativeFacing = frameFacing(definition, name, frame);
  return nativeFacing && (facing === -1 || facing === 1) && facing !== nativeFacing
    ? `${definition.art}/directional/${name}/${file}.svg` : `${definition.art}/${name}/${file}.png`;
}

export function agentSprite(view, row, roaming = false, facing) {
  const clock = (view.themeClock ?? 0) + seed(row.id) % 12000;
  const definition = themeDefinition(view.skin), pool = residentPool(view.skin);
  if (!pool.length) return null;
  const assigned = view.residentAssignments?.get(row.id);
  const name = pool.includes(assigned) ? assigned : pool[seed(row.id) % pool.length];
  const sprite = definition.sprites[name];
  // One native GIF resource keeps its loaded frames across redraws. Cycling
  // hundreds of PNG URLs evicts the native image cache and flashes on each lap.
  const direction = definition.facing?.[name];
  const directional = Array.isArray(direction) ? direction.some(Boolean) : Boolean(direction);
  const nativeAnimation = Boolean(sprite.animation && !directional && !view.motionPaused);
  const path = nativeAnimation ? `${definition.art}/${sprite.animation}` : spriteFrame(view.skin, name, clock, roaming ? facing : undefined);
  return { ...sprite, name, clock, path, nativeAnimation, mirrored: path.endsWith(".svg") };
}
