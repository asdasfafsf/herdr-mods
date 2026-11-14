import { overviewHeader } from "./overview-header.js";
// A quiet village: small status labels, speech bubbles only for unread work.
import { div, image, svg } from "gpui-kit";
import { h_flex, v_flex, Scrollbar } from "gpui-base";
import { run, focused } from "herdr";
import { button, statusColor, statusMark, statusInfo, statusLabel, statusNotice } from "./ui.js";
import { agentSprite } from "./agent-theme.js";
import { themeDefinition } from "./themes.js";
import { spriteLayout } from "./sprite-layout.js";
import { renderAgentEmptyState } from "./agent-empty-state.js";
import { selectVillageResident, renderVillageChat } from "./village-chat.js";
import { renderSessionControls } from "./session-controls.js";
import { inAgentMode } from "./agent-mode.js";
import { hasTerminalDock, noteSceneSize } from "./terminal-dock.js";
import { beginDrag, moveDrag, finishDrag, isDragging, consumeDragClick, clampPosition, normalizedPosition, restorePosition } from "./drag-layout.js";
import { movementFacing } from "./sprite-directions.js";

const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
export const villageNotice = statusNotice;

export function noticeBounds(actor, layout) {
  const width = Math.min(208, layout.width - 24);
  const left = clamp(actor.x + (layout.size + 16 - width) / 2, 12, layout.width - width - 12);
  return { left, top: actor.y - 102, width, height: 88,
    tail: clamp(actor.x + (layout.size + 16) / 2 - left - 8, 12, width - 28) };
}
function seed(text) {
  let n = 2166136261;
  for (let i = 0; i < text.length; i++) n = Math.imul(n ^ text.charCodeAt(i), 16777619) >>> 0;
  return n;
}
function random(actor) {
  actor.random = (Math.imul(actor.random, 1664525) + 1013904223) >>> 0;
  return actor.random / 4294967296;
}

export function villageLayout(width, viewportHeight, count, noticeCount = 0) {
  const size = count > 12 ? 82 : 108;
  const top = Math.min(260, Math.max(120, width * 0.19));
  const inset = Math.min(110, Math.max(20, width * 0.08));
  const columns = Math.max(1, Math.floor((width - inset * 2) / (noticeCount ? 230 : 150)));
  const height = Math.max(420, viewportHeight, top + count * 18000 / Math.max(280, width),
    noticeCount ? top + Math.ceil(count / columns) * (size + 118) + 64 : 0);
  return { width, height, size, left: inset, right: Math.max(inset, width - inset - size),
    top, bottom: Math.max(top, height - size - 64), columns, noticeCount };
}

// Stable per-session state survives filtering and refreshes. Clock time is already
// frozen while the theme is paused/hidden, so returning never teleports residents.
export function advanceVillage(view, rows, layout) {
  const clock = view.themeClock || 0;
  const dt = clamp((clock - (view.villageClock ?? clock)) / 1000, 0, 0.16);
  view.villageClock = clock;
  const actors = view.villageActors ??= new Map();
  const columns = Math.min(layout.columns, Math.max(1, Math.ceil(Math.sqrt(rows.length * layout.width / layout.height))));
  const lines = Math.max(1, Math.ceil(rows.length / columns));
  const current = rows.map((row, i) => {
    let actor = actors.get(row.id);
    if (!actor) {
      actor = { random: seed(row.id), wait: 0, moving: false };
      const u = layout.noticeCount ? (columns > 1 ? (i % columns) / (columns - 1) : 0.5)
        : ((i % columns) + 0.25 + random(actor) * 0.5) / columns;
      const v = layout.noticeCount ? (lines > 1 ? Math.floor(i / columns) / (lines - 1) : 0.5)
        : (Math.floor(i / columns) + 0.25 + random(actor) * 0.5) / lines;
      actor.x = layout.left + u * (layout.right - layout.left);
      actor.y = layout.top + v * (layout.bottom - layout.top);
      actor.tx = actor.x; actor.ty = actor.y;
      actor.wait = random(actor) * 0.2;
      actor.speed = 23 + random(actor) * 12;
      actors.set(row.id, actor);
    }
    actor.x = clamp(actor.x, layout.left, layout.right);
    actor.y = clamp(actor.y, layout.top, layout.bottom);
    actor.tx = clamp(actor.tx, layout.left, layout.right);
    actor.ty = clamp(actor.ty, layout.top, layout.bottom);
    return { row, actor };
  });
  for (const { row, actor } of current) {
    actor.moving = false;
    // The inspected resident stays put until selection changes. Hover and
    // unread notices alone do not interrupt the other residents' roaming.
    if (!dt || row.id === view.villageSelected || isDragging(view, `resident-${row.id}`)) continue;
    if (actor.wait > 0) { actor.wait -= dt; continue; }
    const dx = actor.tx - actor.x, dy = actor.ty - actor.y, distance = Math.hypot(dx, dy);
    if (distance < 2) {
      const angle = random(actor) * Math.PI * 2, travel = 80 + random(actor) * 190;
      actor.tx = clamp(actor.x + Math.cos(angle) * travel, layout.left, layout.right);
      actor.ty = clamp(actor.y + Math.sin(angle) * travel, layout.top, layout.bottom);
      // At a corner an outward step can clamp back onto the resident. Choose a
      // point inside the field instead of repeatedly waiting on the same spot.
      if (Math.hypot(actor.tx - actor.x, actor.ty - actor.y) < 2) {
        actor.tx = layout.left + random(actor) * (layout.right - layout.left);
        actor.ty = layout.top + random(actor) * (layout.bottom - layout.top);
      }
      actor.wait = 0.1 + random(actor) * 0.25;
      continue;
    }
    const step = Math.min(distance, actor.speed * dt);
    const x = actor.x + dx / distance * step, y = actor.y + dy / distance * step;
    // Let residents pause and choose another direction instead of piling up.
    const blocked = current.some(({ actor: other }) => other !== actor
      && Math.hypot(other.x - x, other.y - y) < layout.size * 0.72
      && Math.hypot(other.x - x, other.y - y) < Math.hypot(other.x - actor.x, other.y - actor.y));
    if (blocked) { actor.tx = actor.x; actor.ty = actor.y; actor.wait = 0.1; continue; }
    actor.facing = movementFacing(x - actor.x, y - actor.y, actor.facing);
    actor.x = x; actor.y = y; actor.moving = true;
  }
  return current;
}

function resident(view, row, actor, layout, t, focusedAddress) {
  const sprite = agentSprite(view, row, true, actor.facing);
  const size = layout.size, art = spriteLayout(sprite, size + 16, size, true);
  const selected = view.villageSelected === row.id;
  const selectedLabel = row.address && row.address === focusedAddress ? "Active" : "Selected";
  const status = statusLabel(row.status);
  const notice = villageNotice(row), color = statusColor(t, row.status) || t.muted;
  const identity = [row.title, `${row.project}${row.branch ? ` · ${row.branch}` : ""}`, `${row.agent} · ${row.address || row.sourceLabel}`].join("\n");
  return div().id(`overview-${row.id}`).absolute().left(actor.x).top(actor.y).w(size + 16).h(size + 44)
    .cursor_pointer().accessibility_label(`${row.agent}, ${status}, ${row.title}, ${row.project}`)
    .tooltip(identity)
    .on_mouse_down("left", (e, cx) => beginDrag(view, `resident-${row.id}`, e, actor, () => view.villageBounds || layout, (point) => {
      actor.facing = movementFacing(point.x - actor.x, point.y - actor.y, actor.facing);
      actor.x = point.x; actor.y = point.y; actor.tx = point.x; actor.ty = point.y; actor.wait = 0;
    }, cx))
    .on_mouse_up("left", (e, cx) => finishDrag(view, e, cx))
    .on_hover((over, cx) => { view.villageHovered = over ? row.id : null; cx.notify(); })
    .on_click((_e, cx) => { finishDrag(view, null, cx); cx.stop_propagation(); if (!consumeDragClick(view, `resident-${row.id}`)) selectVillageResident(view, row, cx); })
    .when(selected, (el) => el.child(div().id(`village-selection-ring-${row.id}`).absolute().left(8).top(size).w(size).h(14).rounded(50)
      .border(2).border_color(t.accent).bg(t.selected).opacity(0.8)))
    .when(!notice, (el) => el.child(h_flex().id(`village-status-${row.id}`).absolute().left((size + 16 - 84) / 2).top(-26)
      .w(84).h(22).gap(5).items_center().justify_center().rounded(11).bg(t.raised)
      .child(div().size(5).rounded(3).bg(color))
      .child(div().text_size(10).text_color(color).child(status))))
    .child(image(sprite.path).absolute().left(art.left).top(art.top).w(art.width).h(art.height))
    .child(v_flex().id(`village-name-${row.id}`).absolute().top(size + 12).left(-6).w(size + 28).gap(2)
      .when(selected, (el) => el.px(5).py(3).rounded(7).border(1).border_color(t.accent).bg(t.raised))
      .child(div().truncate().text_center().text_size(11).font_semibold().text_color(t.foreground).child(row.title))
      .child(div().truncate().text_center().text_size(9).text_color(selected ? t.accent : t.foreground).opacity(selected ? 1 : 0.75)
        .child(selected ? `${selectedLabel} · ${row.project}` : row.project)));
}

function speechBubble(view, row, actor, layout, t) {
  const notice = villageNotice(row), box = noticeBounds(actor, layout);
  const color = statusColor(t, row.status) || t.accent;
  return div().id(`village-notice-${row.id}`).absolute().left(box.left).top(box.top).w(box.width).h(box.height + 12)
    .cursor_pointer().tooltip(`${row.project} · ${row.title}\n${notice.text}`)
    .accessibility_label(`${row.project}, ${notice.label}, ${notice.text}`)
    .on_click((_e, cx) => { finishDrag(view, null, cx); cx.stop_propagation(); if (!consumeDragClick(view)) selectVillageResident(view, row, cx); })
    .child(v_flex().w_full().h(box.height).p(11).gap(6).rounded(12).border(1).border_color(t.border).bg(t.raised)
      .hover((el) => el.border_color(color))
      .child(h_flex().gap(5).items_center()
        .child(div().size(5).rounded(3).bg(color))
        .child(div().text_size(10).font_semibold().text_color(color).child(notice.label))
        .child(div().flex_1().truncate().text_size(9).text_color(t.muted).child(row.project)))
      .child(div().text_size(11).line_height(1.4).text_color(t.foreground).whitespace_normal().h(32).overflow_hidden().child(notice.text)))
    .child(svg("mods/agents-plus/speech-tail.svg").absolute().left(box.tail).top(box.height - 1).w(16).h(10).text_color(t.raised));
}

export function scenery(layout, definition) {
  const scene = definition.scene, { width, height } = scene;
  return div().absolute().inset_0().overflow_hidden()
    .child(div().id("village-scenery").absolute().left((layout.width - width) / 2).top(0).w(width).h(height)
      .children((scene.layers || []).map((layer) => {
        const tile = div().absolute().left(layer.x).top(layer.y).w(layer.width).h(layer.clipHeight ?? layer.height);
        if (layer.clipHeight) tile.overflow_hidden();
        if (layer.color) tile.bg(layer.color);
        if (layer.path) tile.child(image(`${definition.art}/${layer.path}`).w(layer.width).h(layer.height));
        return tile;
      })));
}

export function villageDetails(view, row, t, states, width, openRow) {
  const panelWidth = Math.min(760, width - 32);
  const viewport = (view.presentation === "cards" ? view.height : view.villageHeight) || 660;
  const height = view.detailCollapsed ? 54 : Math.min(inAgentMode() && hasTerminalDock() ? 320 : 740, Math.max(180, viewport - 32));
  const bounds = { left: 16, top: 8, right: Math.max(16, width - panelWidth - 16), bottom: Math.max(8, viewport - height - 12) };
  const anchors = { left: 16, top: 8, right: Math.max(16, width - 16), bottom: Math.max(8, viewport - 12) };
  view.detailDragBounds = bounds;
  const positions = view.detailPositions ??= new Map();
  const position = clampPosition(restorePosition(positions.get(row.id), anchors, { x: (width - panelWidth) / 2, y: bounds.bottom }), bounds);
  const note = row.activity || statusInfo(row.status).summary;
  return v_flex().id("village-details").absolute().left(position.x).top(position.y).w(panelWidth)
    .h(height).overflow_hidden()
    .rounded(12).border(1).border_color(t.border).bg(t.raised).shadow_lg()
    .on_click((_e, cx) => { finishDrag(view, null, cx); cx.stop_propagation(); })
    .child(v_flex().flex_1().min_h(0).min_w(0).p(16).gap(9)
    .child(h_flex().flex_none().gap(8).items_center()
      .child(statusMark(t, row.status))
      .child(div().text_size(11).text_color(statusColor(t, row.status)).child(statusLabel(row.status)))
      .child(div().id("village-detail-handle").flex_1().min_w(0).truncate().text_size(11).text_color(t.muted)
        .cursor_pointer().tooltip("Drag to move this conversation")
        .on_mouse_down("left", (e, cx) => beginDrag(view, `details-${row.id}`, e, position, () => view.detailDragBounds,
          (point) => positions.set(row.id, normalizedPosition(point, anchors)), cx))
        .on_mouse_up("left", (e, cx) => finishDrag(view, e, cx))
        .on_click((_e, cx) => { finishDrag(view, null, cx); consumeDragClick(view, `details-${row.id}`); cx.stop_propagation(); })
        .child(`${row.agent} · ${row.project}`))
      .child(button("village-detail-collapse", view.detailCollapsed ? "Expand" : "Collapse", (cx) => { view.detailCollapsed = !view.detailCollapsed; cx.notify(); }, t))
      .child(button("village-close", "Close", (cx) => { view.villageSelected = null; view.composerOpen = false; cx.notify(); }, t)))
    .when(!view.detailCollapsed, (el) => el.child(v_flex().id("session-detail-scroll").flex_1().min_h(0).overflow_y_scroll().gap(9)
    .child(div().flex_none().truncate().text_size(14).font_semibold().text_color(t.foreground).tooltip(row.title).child(row.title))
    .child(div().id("village-activity").flex_none().text_size(12).text_color(t.muted).whitespace_normal().max_h(52).overflow_y_scroll().child(note))
    .child(h_flex().flex_none().gap(8).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted)
        .tooltip([row.cwd, row.context, row.address].filter(Boolean).join("\n"))
        .child(`${row.branch || row.sourceLabel} · ${row.address || "Outside session"}`))
      .child(button("village-open-session", "Open session", () => openRow(view, row), t)))
    .when(Boolean(view.villageChats?.get(row.id)) && (!inAgentMode() || !hasTerminalDock()), (el) => el.child(renderSessionControls(view.villageChats.get(row.id), t)))
    .child(renderVillageChat(view, row, t)))));
}

export function dragViewport(element, view) {
  return element.on_mouse_move((e, cx) => moveDrag(view, e, cx))
    .on_mouse_up("left", (e, cx) => finishDrag(view, e, cx))
    .on_mouse_down_out((_e, cx) => finishDrag(view, null, cx))
    .on_hover((over, cx) => { if (!over) finishDrag(view, null, cx); });
}

export function renderVillage(view, state) {
  const { t, all, rows, visible, start, pages, states, openRow, empty, emptyActions } = state;
  const width = view.villageWidth || view.width || 1100;
  const definition = themeDefinition(view.skin);
  const layout = villageLayout(width, view.villageHeight || 660, visible.length, visible.filter(villageNotice).length);
  const selected = visible.find((row) => row.id === view.villageSelected);
  const focusedAddress = focused()?.terminal;
  const dragging = view.pointerDrag?.id;
  if (dragging && (dragging.startsWith("details-") ? dragging !== `details-${selected?.id}`
    : !visible.some((row) => dragging === `resident-${row.id}`))) finishDrag(view, null);
  if (!selected) view.villageSelected = null;
  if (!visible.some((row) => row.id === view.villageHovered)) view.villageHovered = null;
  // Discard departed sessions, but keep off-page/filtered residents in place.
  if (view.villageActors) for (const id of view.villageActors.keys()) if (!all.some((row) => row.id === id)) view.villageActors.delete(id);
  view.villageBounds = layout;
  const residents = advanceVillage(view, visible, layout);
  const scrollId = `overview-list-${view.page}`;
  return dragViewport(v_flex().id("agent-view").track_focus(view.handle).size_full().min_h(0).bg(t.background).text_size(12), view)
    .on_key_down((e, cx) => { if (e.key === "escape") { finishDrag(view, null, cx); view.villageSelected = null; view.villageFilters = false; cx.notify(); } })
    .on_size_change((size, cx) => { if (inAgentMode()) noteSceneSize(size.height, cx); if (view.width !== size.width) { view.width = size.width; cx.notify(); } })
    .child(overviewHeader(view, state))
    .child(div().relative().flex_1().min_h(0).overflow_hidden()
      .on_size_change((size, cx) => { if (view.villageWidth !== size.width || view.villageHeight !== size.height) { view.villageWidth = size.width; view.villageHeight = size.height; cx.notify(); } })
      .child(div().id(scrollId).size_full().overflow_y_scroll()
        .child(div().id("agent-village").relative().w(layout.width).h(layout.height).overflow_hidden().bg(definition.scene.background || t.background)
          .on_mouse_down("left", () => { if (!isDragging(view)) view.suppressedDragClick = null; })
          .on_click((_e, cx) => { finishDrag(view, null, cx); if (!consumeDragClick(view)) view.villageSelected = null; cx.notify(); })
          .child(scenery(layout, definition))
          .children(residents.map(({ row, actor }) => resident(view, row, actor, layout, t, focusedAddress)))
          .children(residents.filter(({ row }) => villageNotice(row)).map(({ row, actor }) => speechBubble(view, row, actor, layout, t)))
          .when(Boolean(empty), (el) => el.child(div().absolute().top(layout.height / 2 - 70).left(Math.max(16, (width - 440) / 2))
            .w(Math.min(440, width - 32)).rounded(12).bg(t.raised).border(1).border_color(t.border)
            .child(renderAgentEmptyState(empty, t, emptyActions))))))
      .child(Scrollbar.vertical(scrollId).absolute().inset_0())
      .when(Boolean(selected) && (!inAgentMode() || !hasTerminalDock() || view.composerOpen || selected.external),
        (el) => el.child(villageDetails(view, selected, t, states, width, openRow)))
      .when(!selected && visible.length > 0 && pages === 1, (el) => el.child(div().absolute().bottom(16).left(16).text_size(11).text_color(t.foreground).opacity(0.65).child("Select a character to inspect the session and send a message"))))
    .when(pages > 1, (el) => el.child(h_flex().px(24).py(7).gap(12).items_center().border_t(1).border_color(t.border).flex_none()
      .child(div().text_size(11).text_color(t.muted).child(`${start + 1}–${start + visible.length} of ${rows.length} agents`))
      .child(div().flex_1())
      .child(button("overview-prev", "Previous", (cx) => { view.page--; cx.notify(); }, t, { disabled: view.page === 0 }))
      .child(button("overview-next", "Next", (cx) => { view.page++; cx.notify(); }, t, { disabled: view.page === pages - 1 }))));
}
