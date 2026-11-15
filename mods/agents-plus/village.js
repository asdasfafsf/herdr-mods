import { overviewHeader } from "./overview-header.js";
// A quiet village: small status labels, speech bubbles only for unread work.
import { div, image, svg } from "gpui-kit";
import { h_flex, v_flex, Scrollbar } from "gpui-base";
import { run, focused } from "herdr";
import { button, statusColor, statusMark, statusInfo, statusLabel, statusNotice } from "./ui.js";
import { agentResident, agentSprite } from "./agent-theme.js";
import { packDefinition, residentPool } from "./resource-packs.js";
import { spriteLayout } from "./sprite-layout.js";
import { spriteArt } from "./sprite-art.js";
import { renderAgentEmptyState } from "./agent-empty-state.js";
import { selectVillageResident, renderVillageChat } from "./village-chat.js";
import { renderSessionControls, renderInlinePermission, sessionState } from "./session-controls.js";
import { inAgentMode } from "./agent-mode.js";
import { hasTerminalDock, noteSceneSize } from "./terminal-dock.js";
import { beginDrag, moveDrag, finishDrag, isDragging, consumeDragClick, clampPosition, normalizedPosition, restorePosition } from "./drag-layout.js";
import { movementFacing, movementDirection } from "./sprite-directions.js";
import { residentGeometry, residentFootprint, residentBounds, noticeBounds, villageLayout, footprintOverlap, spacedStep, vacantPosition } from "./village-spacing.js";
export { noticeBounds, villageLayout } from "./village-spacing.js";

const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
export function villageNotice(row) {
  const notice = statusNotice(row);
  return notice?.attention ? notice : null;
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

const geometryCaches = new WeakMap();
const smallNotice = { width: 208, height: 88 }, approvalNotice = { width: 208, height: 112 }, expandedNotice = { width: 320, height: 340 };
export function residentSpacing(view, row, size) {
  const definition = packDefinition(view.pack);
  let cache = geometryCaches.get(definition);
  if (!cache) { cache = { pool: residentPool(view.pack), shapes: new Map() }; geometryCaches.set(definition, cache); }
  const name = agentResident(view, row, cache.pool), key = `${name}:${size}`;
  let shape = cache.shapes.get(key);
  if (!shape) {
    const motions = definition.motions?.[name];
    const variants = [definition.sprites?.[name], ...Object.values(motions || {}).map((clip) => definition.sprites?.[clip?.sprite])].filter(Boolean);
    shape = { geometry: residentGeometry(variants.length ? variants : [{ width: size + 16, height: size }], size, definition.villageScale?.[name] ?? 1),
      directions: motions?.directions?.filter((direction) => ["left", "right", "up", "down"].includes(direction)) };
    cache.shapes.set(key, shape);
  }
  const approval = row.status === "blocked" && !row.external;
  const expanded = approval && view.villageChats?.get(row.id)?.request;
  const notice = villageNotice(row) ? expanded ? expandedNotice : approval ? approvalNotice : smallNotice : null;
  // Polling can expand a local request without a movement tick. Keep that
  // control area available even while its compact preview is displayed.
  const reservedNotice = notice && approval ? expandedNotice : notice;
  return { ...shape, notice, reservedNotice };
}
const locked = (view, row) => row.id === view.villageSelected || row.id === view.permissionHovered
  || view.villageChats?.get(row.id)?.acting || isDragging(view, `resident-${row.id}`);

// Stable per-session state survives filtering and refreshes. Clock time is already
// frozen while the theme is paused/hidden, so returning adds no elapsed-time jump.
export function advanceVillage(view, rows, layout) {
  const clock = view.themeClock || 0;
  const dt = clamp((clock - (view.villageClock ?? clock)) / 1000, 0, 0.16);
  view.villageClock = clock;
  const actors = view.villageActors ??= new Map();
  const restored = view.villageSpacingKey == null && actors.size > 0;
  const spacing = rows.map((row) => residentSpacing(view, row, layout.size));
  Object.assign(layout, villageLayout(layout.width, layout.viewportHeight ?? layout.height, rows.length,
    spacing.filter((spec) => spec.notice).length, {}, spacing.map((spec) => ({ ...spec, notice: spec.reservedNotice }))));
  const columns = layout.columns;
  const lines = Math.max(1, Math.ceil(rows.length / columns));
  const current = rows.map((row, i) => {
    const spec = spacing[i], bounds = residentBounds(layout, spec.geometry, spec.reservedNotice);
    let actor = actors.get(row.id);
    if (!actor) {
      actor = { random: seed(row.id), wait: 0, moving: false };
      const u = columns > 1 ? (i % columns) / (columns - 1) : 0.5;
      const v = lines > 1 ? Math.floor(i / columns) / (lines - 1) : 0.5;
      actor.x = layout.left + u * (layout.right - layout.left);
      actor.y = layout.top + v * (layout.bottom - layout.top);
      actor.tx = actor.x; actor.ty = actor.y;
      actor.wait = random(actor) * 0.2;
      actor.speed = 23 + random(actor) * 12;
      actors.set(row.id, actor);
    }
    // Pointer ownership wins over layout changes. Reachable locked residents
    // stay still; only an out-of-scene selection needs a resize correction.
    if (!isDragging(view, `resident-${row.id}`)) {
      actor.x = clamp(actor.x, bounds.left, bounds.right);
      actor.y = clamp(actor.y, bounds.top, bounds.bottom);
    }
    actor.tx = clamp(actor.tx, bounds.left, bounds.right);
    actor.ty = clamp(actor.ty, bounds.top, bounds.bottom);
    return { row, actor, ...spec, bounds, footprint: (point) => residentFootprint(point, layout, spec.geometry, spec.reservedNotice) };
  });
  const previous = view.villageSpacingKey;
  const changed = previous && (previous.width !== layout.width || previous.height !== layout.height || previous.size !== layout.size
    || previous.rows.size !== current.length || current.some(({ row, geometry, reservedNotice }) => {
      const old = previous.rows.get(row.id);
      return old?.geometry !== geometry || old?.reservedNotice !== reservedNotice;
    }));
  view.villageNeedsReflow ||= restored || changed
    || view.villageWasDragging && !isDragging(view);
  if (!previous || changed) view.villageSpacingKey = { width: layout.width, height: layout.height, size: layout.size,
    rows: new Map(current.map(({ row, geometry, reservedNotice }) => [row.id, { geometry, reservedNotice }])) };
  view.villageWasDragging = isDragging(view);
  // Initial/paused renders need geometry for painting, but no pairwise motion
  // work. Reuse static shape identities to detect layout changes without JSON.
  const boxes = dt ? current.map(({ actor, footprint }) => footprint(actor)) : null;
  if (dt && view.villageNeedsReflow) {
    // Resizing/filter return can trap a row between the edge and a locked
    // resident. Repair just the overlapping unlocked rows, once, on resume.
    for (const [index, { row, actor, bounds, footprint }] of current.entries()) {
      if (locked(view, row)) continue;
      const others = boxes.filter((_box, i) => i !== index);
      if (!others.some((box) => footprintOverlap(boxes[index], box) > 0.001)) continue;
      const point = vacantPosition(actor, bounds, footprint, others);
      if (!point) continue;
      actor.x = actor.tx = point.x; actor.y = actor.ty = point.y;
      actor.wait = 0.1; actor.moving = false;
      boxes[index] = footprint(actor);
    }
    view.villageNeedsReflow = false;
  }
  for (const [index, { row, actor, footprint, directions, bounds }] of current.entries()) {
    if (!dt && !locked(view, row)) continue;
    actor.moving = Boolean(isDragging(view, `resident-${row.id}`) && view.pointerDrag?.moved);
    // The inspected resident stays put until selection changes. Hover and
    // unread notices alone do not interrupt the other residents' roaming.
    if (!dt || locked(view, row)) continue;
    const others = boxes.filter((_box, i) => i !== index);
    const overlapping = others.some((box) => footprintOverlap(boxes[index], box) > 0);
    if (actor.wait > 0 && !overlapping) { actor.wait -= dt; continue; }
    const dx = actor.tx - actor.x, dy = actor.ty - actor.y, distance = Math.hypot(dx, dy);
    if (distance < 2 && !overlapping) {
      const angles = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };
      const direction = directions?.length ? directions[Math.floor(random(actor) * directions.length)] : null;
      const angle = direction ? angles[direction] : random(actor) * Math.PI * 2, travel = 80 + random(actor) * 190;
      actor.tx = clamp(actor.x + Math.cos(angle) * travel, bounds.left, bounds.right);
      actor.ty = clamp(actor.y + Math.sin(angle) * travel, bounds.top, bounds.bottom);
      // At a corner an outward step can clamp back onto the resident. Choose a
      // point inside the field instead of repeatedly waiting on the same spot.
      if (Math.hypot(actor.tx - actor.x, actor.ty - actor.y) < 2) {
        const reverse = { left: "right", right: "left", up: "down", down: "up" }[direction];
        if (direction && directions.includes(reverse)) {
          actor.tx = clamp(actor.x + Math.cos(angles[reverse]) * travel, bounds.left, bounds.right);
          actor.ty = clamp(actor.y + Math.sin(angles[reverse]) * travel, bounds.top, bounds.bottom);
        } else if (!direction) {
          actor.tx = bounds.left + random(actor) * (bounds.right - bounds.left);
          actor.ty = bounds.top + random(actor) * (bounds.bottom - bounds.top);
        }
      }
      actor.wait = 0.1 + random(actor) * 0.25;
      continue;
    }
    const step = Math.min(overlapping ? Infinity : distance, actor.speed * dt);
    const point = spacedStep(actor, { x: actor.tx, y: actor.ty }, step, bounds, footprint, others, directions);
    if (!point) {
      actor.spacingStalledFor = overlapping ? (actor.spacingStalledFor || 0) + dt : 0;
      // A saved overlap can also be trapped between the scenic floor and a
      // fixed bubble. Keep the floor: repair only that stalled unlocked row,
      // after normal escape attempts, rather than letting it walk into the sky.
      if (actor.spacingStalledFor >= 0.75) {
        const vacant = vacantPosition(actor, bounds, footprint, others);
        if (vacant) {
          actor.x = vacant.x; actor.y = vacant.y;
          boxes[index] = footprint(actor);
        }
        actor.spacingStalledFor = 0;
      }
      actor.tx = actor.x; actor.ty = actor.y; actor.wait = 0.1;
      continue;
    }
    actor.spacingStalledFor = 0;
    const { x, y } = point;
    // Follow an escape/slide for a while rather than retrying the obstructed
    // target every frame and oscillating between atlas directions.
    if (distance < 2 || Math.hypot(x - actor.x - dx / distance * step, y - actor.y - dy / distance * step) > 0.01) {
      actor.tx = clamp(x + (x - actor.x) / step * 100, bounds.left, bounds.right);
      actor.ty = clamp(y + (y - actor.y) / step * 100, bounds.top, bounds.bottom);
    }
    actor.facing = movementFacing(x - actor.x, y - actor.y, actor.facing);
    actor.direction = movementDirection(x - actor.x, y - actor.y, actor.direction);
    actor.x = x; actor.y = y; actor.moving = true;
    actor.wait = 0;
    boxes[index] = footprint(actor);
  }
  for (const { actor } of current) {
    const motion = actor.moving ? actor.direction || "down" : "idle";
    if (actor.motion !== motion) { actor.motion = motion; actor.motionSince = clock; }
  }
  return current;
}

function resident(view, row, actor, layout, t, focusedAddress, geometry) {
  const sprite = agentSprite(view, row, true, actor.facing, actor);
  const size = layout.size, art = spriteLayout(sprite, size + 16, size, true, geometry.visualScale);
  const ring = geometry.selection;
  const selected = view.villageSelected === row.id;
  const selectedLabel = row.address && row.address === focusedAddress ? "Active" : "Selected";
  const status = statusLabel(row.status);
  const notice = villageNotice(row), color = statusColor(t, row.status) || t.muted;
  const identity = [row.title, `${row.project}${row.branch ? ` · ${row.branch}` : ""}`, `${row.agent} · ${row.address || row.sourceLabel}`].join("\n");
  return div().id(`overview-${row.id}`).absolute().left(actor.x).top(actor.y).w(size + 16).h(geometry.name.top + geometry.name.height)
    .cursor_pointer().accessibility_label(`${row.agent}, ${status}, ${row.title}, ${row.project}`)
    .tooltip(identity)
    .on_mouse_down("left", (e, cx) => beginDrag(view, `resident-${row.id}`, e, actor, () => {
      const area = view.villageBounds || layout, spec = residentSpacing(view, row, area.size);
      return residentBounds(area, spec.geometry, spec.reservedNotice);
    }, (point) => {
      actor.facing = movementFacing(point.x - actor.x, point.y - actor.y, actor.facing);
      actor.direction = movementDirection(point.x - actor.x, point.y - actor.y, actor.direction);
      actor.x = point.x; actor.y = point.y; actor.tx = point.x; actor.ty = point.y; actor.wait = 0;
    }, cx))
    .on_mouse_up("left", (e, cx) => finishDrag(view, e, cx))
    .on_hover((over, cx) => { view.villageHovered = over ? row.id : null; cx.notify(); })
    .on_click((_e, cx) => { finishDrag(view, null, cx); cx.stop_propagation(); if (!consumeDragClick(view, `resident-${row.id}`)) selectVillageResident(view, row, cx); })
    .when(selected, (el) => el.child(div().id(`village-selection-ring-${row.id}`).absolute().left(ring.left).top(ring.top).w(ring.width).h(ring.height).rounded(50)
      .border(2).border_color(t.accent).bg(t.selected).opacity(0.8)))
    .when(!notice, (el) => el.child(h_flex().id(`village-status-${row.id}`).absolute().left(geometry.status.left).top(geometry.status.top)
      .w(84).h(22).gap(5).items_center().justify_center().rounded(11).bg(t.raised)
      .child(div().size(5).rounded(3).bg(color))
      .child(div().text_size(10).text_color(color).child(status))))
    .child(spriteArt(sprite, `village-art-${row.id}-${sprite.name}`, art))
    .child(v_flex().id(`village-name-${row.id}`).absolute().top(geometry.name.top).left(geometry.name.left).w(geometry.name.width).h(geometry.name.height).gap(2)
      // Pack artwork has its own colors; keep labels on a palette-owned surface.
      .px(5).py(3).rounded(7).border(1).border_color(selected ? t.accent : t.border).bg(t.raised)
      .child(div().h(14).flex_none().line_height(14 / 11).truncate().text_center().text_size(11).font_semibold().text_color(t.foreground).child(row.title))
      .child(div().h(12).flex_none().line_height(12 / 9).truncate().text_center().text_size(9).text_color(selected ? t.accent : t.muted)
        .child(selected ? `${selectedLabel} · ${row.project}` : row.project)));
}

function speechBubble(view, row, actor, layout, t, spacing) {
  const approval = row.status === "blocked" && !row.external;
  const chat = approval ? sessionState(view, row) : null;
  const notice = villageNotice(row), box = noticeBounds(actor, layout, { ...spacing.notice, artTop: spacing.geometry.art.top });
  const color = statusColor(t, row.status) || t.accent;
  return div().id(`village-notice-${row.id}`).absolute().left(box.left).top(box.top).w(box.width).h(box.height + 12)
    .cursor_pointer().tooltip(`${row.project} · ${row.title}\n${notice.text}`)
    .accessibility_label(`${row.project}, ${notice.label}, ${notice.text}`)
    .on_hover((over, cx) => { if (approval) { view.permissionHovered = over ? row.id : null; cx.notify(); } })
    .on_click((_e, cx) => { finishDrag(view, null, cx); cx.stop_propagation(); if (!consumeDragClick(view)) selectVillageResident(view, row, cx); })
    .child(v_flex().w_full().h(box.height).p(11).gap(6).rounded(12).border(1).border_color(t.border).bg(t.raised)
      .hover((el) => el.border_color(color))
      .child(h_flex().gap(5).items_center()
        .child(div().size(5).rounded(3).bg(color))
        .child(div().text_size(10).font_semibold().text_color(color).child(notice.label))
        .child(div().flex_1().truncate().text_size(9).text_color(t.muted).child(row.project)))
      .child(div().text_size(11).line_height(1.4).text_color(t.foreground).whitespace_normal().h(32).flex_none().overflow_hidden().child(notice.text))
      .when(approval, (el) => el.child(div().flex_1().min_h(0).overflow_y_scroll()
        .child(renderInlinePermission(chat, t, `village-${row.id}`)))))
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
  const definition = packDefinition(view.pack);
  const layout = villageLayout(width, view.villageHeight || 660, visible.length, visible.filter(villageNotice).length,
    visible.some((row) => row.status === "blocked") ? { width: 320, height: 340 } : {});
  const selected = visible.find((row) => row.id === view.villageSelected);
  const focusedAddress = focused()?.terminal;
  const dragging = view.pointerDrag?.id;
  if (dragging && (dragging.startsWith("details-") ? dragging !== `details-${selected?.id}`
    : !visible.some((row) => dragging === `resident-${row.id}`))) finishDrag(view, null);
  if (!selected) view.villageSelected = null;
  if (!visible.some((row) => row.id === view.permissionHovered && row.status === "blocked")) view.permissionHovered = null;
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
          .children(residents.map(({ row, actor, geometry }) => resident(view, row, actor, layout, t, focusedAddress, geometry)))
          .children(residents.filter(({ row }) => villageNotice(row))
            .sort((a, b) => Number(a.row.id === view.permissionHovered) - Number(b.row.id === view.permissionHovered))
            .map((spacing) => speechBubble(view, spacing.row, spacing.actor, layout, t, spacing)))
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
