// A quiet village: small status labels, speech bubbles only for unread work.
import { div, image, svg } from "gpui-kit";
import { h_flex, v_flex, Input, Scrollbar } from "gpui-base";
import { run } from "herdr";
import { button, statusColor, statusMark } from "./ui.js";
import { themeControls, agentSprite } from "./agent-theme.js";
import { selectVillageResident, renderVillageChat } from "./village-chat.js";

const ART = "mods/agents-plus/assets/chiikawa";
const SCENERY = `${ART}/village`;
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const STATUS = { working: "작업 중", blocked: "입력 대기", done: "완료", seen: "확인함", idle: "쉬는 중" };
export function villageNotice(row) {
  if (row.status !== "blocked" && row.status !== "done") return null;
  return { label: row.status === "blocked" ? "확인이 필요해요" : "새 답변이 있어요",
    text: row.activity?.trim() || (row.status === "blocked" ? "입력이나 승인을 기다리고 있어요." : "작업을 마쳤어요. 결과를 확인해주세요.") };
}

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
      actor.wait = random(actor) * 1.5;
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
    if (!dt || villageNotice(row) || view.villageSelected === row.id || view.villageHovered === row.id) continue;
    if (actor.wait > 0) { actor.wait -= dt; continue; }
    const dx = actor.tx - actor.x, dy = actor.ty - actor.y, distance = Math.hypot(dx, dy);
    if (distance < 2) {
      const angle = random(actor) * Math.PI * 2, travel = 80 + random(actor) * 190;
      actor.tx = clamp(actor.x + Math.cos(angle) * travel, layout.left, layout.right);
      actor.ty = clamp(actor.y + Math.sin(angle) * travel, layout.top, layout.bottom);
      actor.wait = 1.5 + random(actor) * 3;
      continue;
    }
    const step = Math.min(distance, actor.speed * dt);
    const x = actor.x + dx / distance * step, y = actor.y + dy / distance * step;
    // Let residents pause and choose another direction instead of piling up.
    const blocked = current.some(({ actor: other }) => other !== actor
      && Math.hypot(other.x - x, other.y - y) < layout.size * 0.72
      && Math.hypot(other.x - x, other.y - y) < Math.hypot(other.x - actor.x, other.y - actor.y));
    if (blocked) { actor.tx = actor.x; actor.ty = actor.y; actor.wait = 0.5; continue; }
    actor.x = x; actor.y = y; actor.moving = true;
  }
  return current;
}

function resident(view, row, actor, layout, t) {
  const sprite = agentSprite(view, row, true);
  const size = layout.size, scale = Math.min(size / sprite.height, (size + 16) / sprite.width);
  const width = sprite.width * scale, height = sprite.height * scale;
  const selected = view.villageSelected === row.id;
  const status = STATUS[row.status] || "상태 확인 중";
  const notice = villageNotice(row), color = statusColor(t, row.status) || t.muted;
  const identity = [row.title, `${row.project}${row.branch ? ` · ${row.branch}` : ""}`, `${row.agent} · ${row.address || row.sourceLabel}`].join("\n");
  return div().id(`overview-${row.id}`).absolute().left(actor.x).top(actor.y).w(size + 16).h(size + 44)
    .cursor_pointer().accessibility_label(`${row.agent}, ${status}, ${row.title}, ${row.project}`)
    .tooltip(identity)
    .on_hover((over, cx) => { view.villageHovered = over ? row.id : null; cx.notify(); })
    .on_click((_e, cx) => { cx.stop_propagation(); selectVillageResident(view, row, cx); })
    .when(selected, (el) => el.child(div().absolute().left(18).top(size + 2).w(size - 20).h(8).rounded(50)
      .bg(t.accent).opacity(0.2)))
    .when(!notice, (el) => el.child(h_flex().id(`village-status-${row.id}`).absolute().left((size + 16 - 84) / 2).top(-26)
      .w(84).h(22).gap(5).items_center().justify_center().rounded(11).bg(t.raised)
      .child(div().size(5).rounded(3).bg(color))
      .child(div().text_size(10).text_color(color).child(status))))
    .child(image(sprite.path).absolute().left((size + 16 - width) / 2).top(size - height).w(width).h(height))
    .child(v_flex().id(`village-name-${row.id}`).absolute().top(size + 12).left(-6).w(size + 28).gap(2)
      .child(div().truncate().text_center().text_size(11).font_semibold().text_color(t.foreground).child(row.title))
      .child(div().truncate().text_center().text_size(9).text_color(t.foreground).opacity(0.75).child(row.project)));
}

function speechBubble(view, row, actor, layout, t) {
  const notice = villageNotice(row), box = noticeBounds(actor, layout);
  const color = statusColor(t, row.status) || t.accent;
  return div().id(`village-notice-${row.id}`).absolute().left(box.left).top(box.top).w(box.width).h(box.height + 12)
    .cursor_pointer().tooltip(`${row.project} · ${row.title}\n${notice.text}`)
    .accessibility_label(`${row.project}, ${notice.label}, ${notice.text}`)
    .on_click((_e, cx) => { cx.stop_propagation(); selectVillageResident(view, row, cx); })
    .child(v_flex().w_full().h(box.height).p(11).gap(6).rounded(12).border(1).border_color(t.border).bg(t.raised)
      .hover((el) => el.border_color(color))
      .child(h_flex().gap(5).items_center()
        .child(div().size(5).rounded(3).bg(color))
        .child(div().text_size(10).font_semibold().text_color(color).child(notice.label))
        .child(div().flex_1().truncate().text_size(9).text_color(t.muted).child(row.project)))
      .child(div().text_size(11).line_height(1.4).text_color(t.foreground).whitespace_normal().h(32).overflow_hidden().child(notice.text)))
    .child(svg(`${SCENERY}/speech-tail.svg`).absolute().left(box.tail).top(box.height - 1).w(16).h(10).text_color(t.raised));
}

function scenery(layout) {
  const width = layout.width, height = layout.height;
  return div().absolute().inset_0()
    .child(div().absolute().left(0).top(0).w(width).h(width * 0.16).bg("#e8f5f8"))
    .child(image(`${SCENERY}/field.png`).absolute().left(0).top(0).w(width).h(width * 1492 / 3840))
    .child(image(`${SCENERY}/trees-left.png`).absolute().left(-32).top(height * 0.52).w(100).h(262))
    .child(div().absolute().right(-32).top(height * 0.32).w(100).h(264).overflow_hidden()
      .child(image(`${SCENERY}/trees-right.png`).w(100).h(100 * 8706 / 916)))
    .child(image(`${SCENERY}/stump.png`).absolute().left(width * 0.65).top(height * 0.72).w(64).h(25));
}

function details(view, row, t, states, width, openRow) {
  const panelWidth = Math.min(500, width - 32);
  const note = row.activity || (row.status === "working" ? "작업을 진행하고 있어요" : row.status === "blocked" ? "입력을 기다리고 있어요" : row.status === "done" ? "작업을 마쳤어요" : "다음 작업을 기다리고 있어요");
  return v_flex().id("village-details").absolute().left((width - panelWidth) / 2).bottom(20).w(panelWidth).p(16).gap(9)
    .max_h(Math.max(160, (view.villageHeight || 660) - 32)).overflow_y_scroll()
    .rounded(12).border(1).border_color(t.border).bg(t.raised).shadow_lg()
    .on_click((_e, cx) => cx.stop_propagation())
    .child(h_flex().gap(8).items_center()
      .child(statusMark(t, row.status))
      .child(div().text_size(11).text_color(statusColor(t, row.status)).child(STATUS[row.status] || "상태 확인 중"))
      .child(div().flex_1().truncate().text_size(11).text_color(t.muted).child(`${row.agent} · ${row.project}`))
      .child(button("village-close", "닫기", (cx) => { view.villageSelected = null; cx.notify(); }, t)))
    .child(div().truncate().text_size(14).font_semibold().text_color(t.foreground).tooltip(row.title).child(row.title))
    .child(div().id("village-activity").text_size(12).text_color(t.muted).whitespace_normal().max_h(52).overflow_y_scroll().child(note))
    .child(h_flex().gap(8).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted)
        .tooltip([row.cwd, row.context, row.address].filter(Boolean).join("\n"))
        .child(`${row.branch || row.sourceLabel} · ${row.address || "외부 세션"}`))
      .child(button("village-open-session", "세션 열기", () => openRow(view, row), t)))
    .child(renderVillageChat(view, row, t));
}

export function renderVillage(view, state) {
  const { t, all, scope, rows, visible, start, pages, back, canGoBack, states, sources, openRow } = state;
  const width = view.villageWidth || view.width || 1100, small = width < 840, narrow = width < 660;
  const layout = villageLayout(width, view.villageHeight || 660, visible.length, visible.filter(villageNotice).length);
  const selected = visible.find((row) => row.id === view.villageSelected);
  if (!selected) view.villageSelected = null;
  if (!visible.some((row) => row.id === view.villageHovered)) view.villageHovered = null;
  // Discard departed sessions, but keep off-page/filtered residents in place.
  if (view.villageActors) for (const id of view.villageActors.keys()) if (!all.some((row) => row.id === id)) view.villageActors.delete(id);
  const residents = advanceVillage(view, visible, layout);
  const filtering = Boolean(view.input.value().trim() || view.statusFilter !== "all" || view.sourceFilter !== "all");
  const scrollId = `overview-list-${view.page}`;
  return v_flex().id("agent-view").track_focus(view.handle).size_full().min_h(0).bg(t.background).text_size(12)
    .on_key_down((e, cx) => { if (e.key === "escape") { view.villageSelected = null; view.villageFilters = false; cx.notify(); } })
    .on_size_change((size, cx) => { if (view.width !== size.width) { view.width = size.width; cx.notify(); } })
    .child(v_flex().px(narrow ? 16 : 24).py(12).gap(10).flex_none().border_b(1).border_color(t.border)
      .child(h_flex().items_center().gap(12)
        .child(div().text_size(18).font_semibold().text_color(t.foreground).child("치이카와 마을"))
        .child(div().flex_1().text_size(11).text_color(t.muted).child(`${rows.length}명`))
        .child(button("village-filters", filtering ? "검색·필터 적용 중" : "검색·필터", (cx) => { view.villageFilters = !view.villageFilters; cx.notify(); }, t))
        .when(!narrow, (el) => el.child(themeControls(view, t))))
      .when(narrow, (el) => el.child(themeControls(view, t)))
      .when(view.villageFilters, (el) => el.child(v_flex().id("village-filter-panel").gap(10).pt(4)
        .child(Input.new(view.input).h(34).px(10).items_center().rounded(7).border(1).border_color(t.border).bg(t.raised).text_color(t.foreground))
        .child(h_flex().gap(5).flex_wrap().children(states.map(([key, label]) => {
          const count = key === "all" ? scope.length : scope.filter((row) => row.status === key).length;
          return div().id(`overview-status-${key}`).px(9).py(6).rounded(5).text_size(11).cursor_pointer()
            .bg(view.statusFilter === key ? t.selected : t.background).text_color(t.foreground).hover((el) => el.bg(t.hover))
            .on_click((_e, cx) => { view.statusFilter = key; view.page = 0; cx.notify(); }).child(`${label} ${count}`);
        })))
        .child(h_flex().gap(5).items_center().flex_wrap()
          .children(sources.map(([key, label]) => div().id(`overview-source-${key}`).px(9).py(5).rounded(5).cursor_pointer()
            .text_size(11).text_color(view.sourceFilter === key ? t.foreground : t.muted)
            .when(view.sourceFilter === key, (el) => el.bg(t.selected)).hover((el) => el.bg(t.hover))
            .on_click((_e, cx) => { view.sourceFilter = key; view.page = 0; cx.notify(); }).child(label)))
          .child(div().flex_1())
          .child(button("overview-refresh", view.readingOutside ? "Refreshing…" : "Refresh", (cx) => view.readOutside(cx), t, { disabled: view.readingOutside }))
          .when(canGoBack && !small, (el) => el.child(button("overview-back", "Back to work", () => run("pane.focus", { pane: back }), t))))))
      .when(Boolean(view.outsideError), (el) => el.child(div().text_size(11).text_color(t.blocked).child("Couldn't refresh outside agents. Showing the last available list."))))
    .child(div().relative().flex_1().min_h(0).overflow_hidden()
      .on_size_change((size, cx) => { if (view.villageWidth !== size.width || view.villageHeight !== size.height) { view.villageWidth = size.width; view.villageHeight = size.height; cx.notify(); } })
      .child(div().id(scrollId).size_full().overflow_y_scroll()
        .child(div().id("chiikawa-village").relative().w(layout.width).h(layout.height).overflow_hidden().bg("#c3dea0")
          .on_click((_e, cx) => { view.villageSelected = null; cx.notify(); })
          .child(scenery(layout))
          .children(residents.map(({ row, actor }) => resident(view, row, actor, layout, t)))
          .children(residents.filter(({ row }) => villageNotice(row)).map(({ row, actor }) => speechBubble(view, row, actor, layout, t)))
          .when(visible.length === 0, (el) => el.child(div().absolute().top(layout.height / 2).left(24).w(width - 48).text_center().text_size(13).text_color(t.foreground)
            .child(all.length ? "검색된 에이전트가 없어요. 검색어나 필터를 바꿔보세요." : "에이전트가 작업을 시작하면 이곳에 나타나요.")))))
      .child(Scrollbar.vertical(scrollId).absolute().inset_0())
      .when(Boolean(selected), (el) => el.child(details(view, selected, t, states, width, openRow)))
      .when(!selected && pages === 1, (el) => el.child(div().absolute().bottom(16).left(16).text_size(11).text_color(t.foreground).opacity(0.65).child("캐릭터를 눌러 작업을 보고 말을 걸어보세요"))))
    .when(pages > 1, (el) => el.child(h_flex().px(24).py(7).gap(12).items_center().border_t(1).border_color(t.border).flex_none()
      .child(div().text_size(11).text_color(t.muted).child(`${start + 1}–${start + visible.length} of ${rows.length} agents`))
      .child(div().flex_1())
      .child(button("overview-prev", "Previous", (cx) => { view.page--; cx.notify(); }, t, { disabled: view.page === 0 }))
      .child(button("overview-next", "Next", (cx) => { view.page++; cx.notify(); }, t, { disabled: view.page === pages - 1 }))));
}
