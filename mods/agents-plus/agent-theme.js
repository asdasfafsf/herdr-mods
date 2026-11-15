// All resource packs share the overview's sessions, filters, pagination and actions.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { props, panes, focused, shared, setShared } from "herdr";
import { RESOURCE_PACKS, VIEW_LAYOUTS, packDefinition, residentPool, hasResidents, hasVillage } from "./resource-packs.js";
import { inAgentMode, agentViewVisible, standaloneOverviewCovered, workspaceTheme } from "./agent-mode.js";
import { finishDrag } from "./drag-layout.js";
import { frameFacing } from "./sprite-directions.js";
import { spriteMotion } from "./sprite-motion.js";
import { initResourcePack, selectedResourcePack, selectResourcePack } from "./resource-pack-state.js";

const preferredPresentation = (pack) => {
  const saved = inAgentMode() ? shared("ag.presentation")
    : localStorage.getItem("overview.presentation") || localStorage.getItem("overview.chiikawaLayout");
  return hasVillage(pack) ? (VIEW_LAYOUTS.some(([key]) => key === saved) ? saved : packDefinition(pack).layout || "cards") : "cards";
};

export function initAgentTheme(view, cx) {
  // Read the old theme-derived choice once, then own a separate persisted pack.
  initResourcePack(inAgentMode() ? workspaceTheme() : props()?.resourcePack || props()?.skin || localStorage.getItem("overview.theme"),
    inAgentMode() ? "native" : "overview");
  view.pack = selectedResourcePack();
  view.presentation = preferredPresentation(view.pack);
  view.themeClock = 0;
  // Motion is on whenever this view opens. A pause belongs to this view's
  // current interaction, not a hidden preference inherited from an old session.
  view.motionPaused = false;
  view.overviewTab = panes().find((pane) => pane.mod === "agents-plus")?.tab;
  let previous = Date.now();
  cx.timer.every(50, (cx) => {
    const now = Date.now(), elapsed = Math.min(160, now - previous);
    previous = now;
    const pack = selectedResourcePack();
    if (pack !== view.pack) { finishDrag(view, null, cx); view.pack = pack; cx.notify(); }
    const presentation = preferredPresentation(view.pack);
    if (view.presentation !== presentation) { finishDrag(view, null, cx); view.presentation = presentation; cx.notify(); }
    if (standaloneOverviewCovered() || (inAgentMode() && !agentViewVisible())) { finishDrag(view, null, cx); return; }
    // A slow render is not a hidden pane. In particular, typing or another
    // busy mod may leave a gap longer than 300ms while this tab is still shown.
    if (!inAgentMode()) {
      view.overviewTab ??= panes().find((pane) => pane.mod === "agents-plus")?.tab;
      if (view.overviewTab ? focused()?.tab !== view.overviewTab : now - (view.lastThemeRender ?? 0) > 300) { finishDrag(view, null, cx); return; }
    }
    if (!hasResidents(view.pack) || view.motionPaused) return;
    view.themeClock += elapsed;
    cx.notify();
  });
}

export function agentTheme(base) { return base; }

export function themeControls(view, t) {
  return h_flex().gap(4).items_center().flex_none().flex_wrap()
    .child(h_flex().gap(4).items_center()
      .child(div().text_size(11).text_color(t.muted).child("Pack"))
      .child(h_flex().flex_wrap().p(2).rounded(7).border(1).border_color(t.border)
        .children(Object.entries(RESOURCE_PACKS).map(([key, definition]) => div().id(`overview-pack-${key}`).px(9).py(5).rounded(5)
          .text_size(11).text_color(view.pack === key ? t.foreground : t.muted)
          .when(view.pack === key, (el) => el.bg(t.selected)).cursor_pointer().hover((el) => el.bg(t.hover))
          .on_click((_e, cx) => {
            finishDrag(view, null, cx); selectResourcePack(key); view.pack = selectedResourcePack();
            view.presentation = preferredPresentation(view.pack); cx.notify();
          }).child(definition.label)))))
    .when(hasVillage(view.pack), (el) => el.child(h_flex().gap(2).p(2).rounded(7).border(1).border_color(t.border)
      .children(VIEW_LAYOUTS.map(([key, label]) => div().id(`overview-layout-${key}`).px(8).py(5).rounded(5).text_size(11)
        .text_color(t.foreground).when(view.presentation === key, (el) => el.bg(t.selected)).cursor_pointer()
        .on_click((_e, cx) => { finishDrag(view, null, cx); view.presentation = key; if (inAgentMode()) setShared("ag.presentation", key); else localStorage.setItem("overview.presentation", key); cx.notify(); }).child(label)))));
}

export function motionControl(view, t) {
  if (!hasResidents(view.pack)) return div();
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

export function spriteFrameIndex(sprite, clock) {
  let time = ((clock % sprite.duration) + sprite.duration) % sprite.duration;
  let frame = 0;
  while (frame < sprite.frames - 1 && time >= sprite.durations[frame]) time -= sprite.durations[frame++];
  return frame;
}

export function spriteFrame(pack, name, clock, facing) {
  const definition = packDefinition(pack), sprite = definition.sprites[name];
  return spriteFramePath(definition, name, spriteFrameIndex(sprite, clock), facing);
}

function spriteFramePath(definition, name, frame, facing) {
  const file = String(frame + 1).padStart(3, "0");
  const nativeFacing = frameFacing(definition, name, frame);
  return nativeFacing && (facing === -1 || facing === 1) && facing !== nativeFacing
    ? `${definition.art}/directional/${name}/${file}.svg` : `${definition.art}/${name}/${file}.png`;
}

export function agentResident(view, row, pool = residentPool(view.pack)) {
  if (!pool.length) return null;
  const assigned = view.residentAssignments?.get(row.id);
  return pool.includes(assigned) ? assigned : pool[seed(row.id) % pool.length];
}

export function agentSprite(view, row, roaming = false, facing, actor) {
  let clock = (view.themeClock ?? 0) + seed(row.id) % 12000;
  const definition = packDefinition(view.pack), resident = agentResident(view, row);
  if (resident == null) return null;
  const motion = spriteMotion(definition, resident, roaming ? actor : null);
  const name = motion.name;
  const sprite = definition.sprites[name];
  if (motion.frames) clock = Math.max(0, (view.themeClock ?? 0) - (actor?.motionSince ?? 0));
  const frame = motion.frames ? motion.frames[spriteFrameIndex({ frames: motion.frames.length, duration: motion.duration,
    durations: motion.frames.map((index) => sprite.durations[index]) }, clock)] : spriteFrameIndex(sprite, clock);
  const targetFacing = motion.facing ?? (roaming && (facing === -1 || facing === 1) ? facing : 0);
  // One native GIF resource keeps its loaded frames across redraws. Cycling
  // hundreds of PNG URLs evicts the native image cache and flashes on each lap.
  const direction = definition.facing?.[name];
  const directional = Array.isArray(direction) ? direction.some(Boolean) : Boolean(direction);
  const nativeAnimation = Boolean(sprite.animation && !directional && !motion.frames && !view.motionPaused);
  if (definition.frameAtlas && (!sprite.animation || directional || motion.frames)) {
    const nativeFacing = frameFacing(definition, name, frame);
    const columns = Math.ceil(Math.sqrt(sprite.frames));
    const suffix = directional && targetFacing ? targetFacing < 0 ? "-left" : "-right" : "";
    return { ...sprite, name: resident, resource: name, motion: motion.key, clock, path: `${definition.art}/${definition.frameAtlas}/${name}${suffix}.svg`,
      atlas: { frame, columns, rows: Math.ceil(sprite.frames / columns) }, nativeAnimation: false,
      mirrored: Boolean(nativeFacing && targetFacing && nativeFacing !== targetFacing) };
  }
  const path = nativeAnimation ? `${definition.art}/${sprite.animation}` : spriteFramePath(definition, name, frame, targetFacing);
  return { ...sprite, name: resident, resource: name, motion: motion.key, clock, path, nativeAnimation, mirrored: path.endsWith(".svg") };
}
