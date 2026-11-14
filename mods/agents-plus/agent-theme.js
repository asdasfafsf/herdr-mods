// Both themes share the overview's sessions, filters, pagination and actions.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { props, panes, focused } from "herdr";
import { SPRITES } from "./theme-assets.js";

const ART = "mods/agents-plus/assets/chiikawa";
const SKINS = [["default", "기본 테마"], ["chiikawa", "치이카와 마을"]];

export function initAgentTheme(view, cx) {
  const saved = props()?.skin || localStorage.getItem("overview.theme");
  view.skin = SKINS.some(([key]) => key === saved) ? saved : "default";
  view.themeClock = 0;
  view.motionPaused = localStorage.getItem("overview.motionPaused") === "true";
  view.overviewTab = panes().find((pane) => pane.mod === "agents-plus")?.tab;
  let previous = Date.now();
  cx.timer.every(50, (cx) => {
    const now = Date.now(), elapsed = Math.min(160, now - previous);
    previous = now;
    if (view.skin !== "chiikawa" || view.motionPaused) return;
    // A slow render is not a hidden pane. In particular, typing or another
    // busy mod may leave a gap longer than 300ms while this tab is still shown.
    view.overviewTab ??= panes().find((pane) => pane.mod === "agents-plus")?.tab;
    if (view.overviewTab ? focused()?.tab !== view.overviewTab : now - (view.lastThemeRender ?? 0) > 300) return;
    view.themeClock += elapsed;
    cx.notify();
  });
}

export function agentTheme(base, skin) {
  if (skin !== "chiikawa") return base;
  return { ...base, foreground: "#503c2e", muted: "#7b6957", dim: "#95816b",
    background: "#f8f5ec", raised: "#fffaf0", chrome: "#f4ecdb", border: "#d7c8ad",
    hover: "#f4ecd9", selected: "#f1dfbd", accent: "#8b6744",
    working: "#58764b", blocked: "#ba5b4a", done: "#488aa0", idle: "#a09680" };
}

export function themeControls(view, t) {
  return h_flex().gap(4).items_center().flex_none()
    .child(h_flex().p(2).rounded(7).border(1).border_color(t.border)
      .children(SKINS.map(([key, label]) => div().id(`overview-theme-${key}`).px(9).py(5).rounded(5)
        .text_size(11).text_color(view.skin === key ? t.foreground : t.muted)
        .when(view.skin === key, (el) => el.bg(t.selected)).cursor_pointer().hover((el) => el.bg(t.hover))
        .on_click((_e, cx) => { view.skin = key; localStorage.setItem("overview.theme", key); cx.notify(); }).child(label))))
    .when(view.skin === "chiikawa", (el) => el.child(div().id("overview-motion").px(8).py(5).rounded(5)
      .text_size(11).text_color(t.muted).cursor_pointer().hover((el) => el.bg(t.hover))
      .on_click((_e, cx) => { view.motionPaused = !view.motionPaused; localStorage.setItem("overview.motionPaused", String(view.motionPaused)); cx.notify(); })
      .child(view.motionPaused ? "움직임 켜기" : "움직임 끄기")));
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
  const name = roaming ? ["done", "hachiware", "idle"][seed(row.id) % 3] : row.status === "working" ? (clock % 12000 < 4000 ? "walk" : "study")
    : row.status === "blocked" ? "blocked" : row.status === "done" ? "done"
    : row.status === "seen" ? ["music", "idle", "done"][seed(row.id) % 3] : "idle";
  return { ...SPRITES[name], name, clock, path: spriteFrame(name, clock) };
}
