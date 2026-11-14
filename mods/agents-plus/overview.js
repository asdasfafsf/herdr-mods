import { overviewHeader } from "./overview-header.js";
// A full-width, searchable view of all live agents. The sidebar remains the owner
// of ordering/seen state; viewing this screen never rewrites those settings.
import { div, image, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Scrollbar } from "gpui-base";
import { agents, terminals, panes, spaces, focused, shared, theme, props, run, window } from "herdr";
import { AGENT_INFO, AGENT_ORDER, outsideAgentId, ACKED, OPTIONS, TREES, LIVE } from "./state.js";
import { shownStatus, seenFor, statusMark, statusColor, statusNotice, button, footer, agoText, STATUS_FILTERS, statusRank, statusInfo, statusLabel, normalizeStatus } from "./ui.js";
import { inside } from "./places.js";
import { initAgentTheme, agentTheme, agentSprite } from "./agent-theme.js";
import { renderVillage, villageDetails, dragViewport } from "./village.js";
import { openAgentMode, leaveAgentMode, inAgentMode, agentViewVisible, AGENT_SELECTION } from "./agent-mode.js";
import { selectVillageResident } from "./village-chat.js";
import { initSessionControls } from "./session-controls.js";
import { hasTerminalDock, openTerminalDock, COMPOSER } from "./terminal-dock.js";

const STATES = STATUS_FILTERS;
const SOURCES = [["all", "All sources"], ["herdr", "Herdr"], ["outside", "Outside Herdr"]];
const PAGE_SIZE = 24; // Divisible into 1–4 columns; bound native element creation.

export function openAgentView(outside = []) {
  openAgentMode();
}

function revealResident(view, row, cx) {
  const all = orderAgentRows(view.overviewRows).filter((item) => !statusInfo(item.status).quiet
    || item.address === focused()?.terminal || item.id === row.id);
  let matches = filterAgentRows(all, view.input.value(), view.statusFilter, view.sourceFilter);
  if (!matches.some((item) => item.id === row.id)) {
    view.input.set_value(""); view.statusFilter = "all"; view.sourceFilter = "all";
    matches = all;
  }
  view.page = Math.max(0, Math.floor(matches.findIndex((item) => item.id === row.id) / PAGE_SIZE));
  selectVillageResident(view, row, cx, false);
}

export function initAgentView(view, cx) {
  view.outside = props()?.outside ?? [];
  view.statusFilter = "all";
  view.sourceFilter = "all";
  view.page = 0;
  view.input = InputState.new({ placeholder: "Search agents, tasks, projects or branches…" });
  view.input.on("change", (_e, cx) => { view.page = 0; cx.notify(); });
  view.handle = cx.focus_handle();
  view.input.focus();
  initAgentTheme(view, cx);
  if (!inAgentMode() || !hasTerminalDock()) initSessionControls(view, cx);
  if (inAgentMode()) {
    view.selectionSequence = shared(AGENT_SELECTION)?.sequence;
    view.composerSequence = shared(COMPOSER)?.sequence;
    cx.timer.every(250, (cx) => {
      if (!agentViewVisible()) return;
      const address = focused()?.terminal;
      const composer = shared(COMPOSER);
      if (composer?.sequence !== view.composerSequence && composer?.address === address) {
        view.composerSequence = composer.sequence;
        view.composerOpen = true;
        view.detailCollapsed = false;
        cx.notify();
      }
      const requested = shared(AGENT_SELECTION);
      if (requested && requested.sequence !== view.selectionSequence) {
        if (Date.now() - requested.at > 5000) view.selectionSequence = requested.sequence;
        // Wait for the host focus and activity snapshot to catch up to a click.
        const row = requested.sequence !== view.selectionSequence && view.overviewRows?.find((row) => row.id === requested.id);
        if (row && address === requested.address) {
          view.selectionSequence = requested.sequence;
          view.focusedResident = address;
          revealResident(view, row, cx);
          openTerminalDock(row.address);
          return;
        }
      }
      if (view.focusedResident === address) return;
      const row = view.overviewRows?.find((row) => row.address === address);
      if (address && !row) return;
      view.focusedResident = address;
      if (row) revealResident(view, row, cx);
      else { view.villageSelected = null; cx.notify(); }
    });
  }
  view.readOutside(cx);
  cx.timer.every(10000, (cx) => { if (window().active) view.readOutside(cx); });
  cx.timer.every(3000, (cx) => cx.notify());
}

// Sidebar, activity polling and workspace views use the same parent-only list.
export function parentAgents(listed = agents(), all = terminals()) {
  const children = new Set(all.filter((terminal) => terminal.parent).map((terminal) => terminal.address));
  return listed.filter((agent) => !agent.parent && !children.has(agent.address));
}

// Index host snapshots once. Internal threads and native child terminals do not
// become independent sessions in the workspace.
export function agentViewRows(outside = []) {
  const listed = agents(), all = terminals(), paneList = panes(), spaceList = spaces();
  const byAddress = new Map(all.map((terminal) => [terminal.address, terminal]));
  const byPane = new Map(paneList.map((pane) => [pane.terminal, pane]));
  const bySpace = new Map(spaceList.map((space) => [space.id, space]));
  const tabs = new Map(spaceList.flatMap((space) => space.tabs ?? []).map((tab) => [tab.id, tab]));
  const info = shared(AGENT_INFO) ?? {}, acked = shared(ACKED) ?? {};
  const now = Date.now(), duration = seenFor(shared(OPTIONS) ?? {});
  const checkouts = Object.values(shared(TREES) ?? {}).flatMap((repo) => (repo.checkouts ?? []).map((checkout) => ({ ...checkout, repo: repo.name, machine: repo.machine ?? null })))
    .sort((a, b) => (b.path?.length ?? 0) - (a.path?.length ?? 0));
  const checkoutBySpace = new Map(checkouts.filter((checkout) => checkout.space).map((checkout) => [checkout.space, checkout]));
  const live = shared(LIVE) ?? {};
  const rows = [], seen = new Set();
  const add = (agent) => {
    const terminal = byAddress.get(agent.address);
    if (agent.parent || terminal?.parent || seen.has(agent.address)) return;
    seen.add(agent.address);
    const pane = byPane.get(agent.address);
    const space = bySpace.get(agent.space), tab = tabs.get(agent.tab ?? pane?.tab);
    const cwd = pane?.cwd || terminal?.cwd || space?.folder || "";
    const checkout = checkoutBySpace.get(agent.space) ?? checkouts.find((c) => (c.machine ?? null) === (space?.machine ?? null) && c.path && cwd && inside(cwd, c.path));
    const program = agent.program ?? terminal?.program;
    const name = (tab?.named && tab.name) || pane?.title || agent.title || terminal?.name || terminal?.template || program?.name || agent.address;
    const raw = normalizeStatus(agent.status);
    const activity = info[agent.address] ?? {};
    const status = shownStatus(raw, { ...activity, acked: acked[agent.address] }, now, duration);
    rows.push({ id: agent.address, address: agent.address, pane: agent.pane ?? pane?.pane ?? pane?.id,
      title: name, program, agent: program?.name || program?.key || "Agent", status,
      project: checkout?.repo || space?.name || agent.space_name || cwd.split("/").filter(Boolean).pop() || "No project",
      branch: checkout?.branch || "", cwd,
      source: "herdr", sourceLabel: space?.machine || "Herdr", context: "",
      activity: raw === "working" || raw === "blocked" ? activity.doing || "" : raw === "done" ? activity.said || "" : "",
      at: activity.at || 0 });
  };
  parentAgents(listed, all).forEach(add);
  all.filter((terminal) => terminal.state === "live" && terminal.program?.agent && !terminal.parent).forEach(add);
  for (const external of outside) {
    if (external.session && live[external.session] && seen.has(live[external.session])) continue;
    const id = outsideAgentId(external);
    if (seen.has(id)) continue;
    seen.add(id);
    const checkout = checkouts.find((c) => !c.machine && c.path && inside(external.cwd, c.path));
    rows.push({ id, external, title: external.title || external.agent, agent: external.agent === "codex" ? "Codex" : "Claude",
      program: { icon: `icons/${external.agent}.svg` }, status: normalizeStatus(external.status),
      project: checkout?.repo || (external.cwd ?? "").split("/").filter(Boolean).pop() || "No project",
      branch: checkout?.branch || "", cwd: external.cwd || "", source: "outside", sourceLabel: external.app || "Outside Herdr",
      activity: "", context: "Continue in Herdr", at: (external.updated || 0) * 1000 });
  }
  return orderAgentRows(rows);
}

export function orderAgentRows(rows) {
  const order = new Map((shared(AGENT_ORDER) ?? []).map((id, index) => [id, index]));
  return [...rows].sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity)
    || statusRank(b.status) - statusRank(a.status) || b.at - a.at || a.title.localeCompare(b.title));
}

export function filterAgentRows(rows, query, status = "all", source = "all") {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((row) => (status === "all" || row.status === status)
    && (source === "all" || (source === "herdr" ? row.source !== "outside" : row.source === source))
    && words.every((word) => [row.title, row.agent, row.project, row.branch, row.cwd, row.sourceLabel, row.activity, row.context].join(" ").toLowerCase().includes(word)));
}

function openRow(view, row) {
  if (inAgentMode() && !row.external && openTerminalDock(row.address)) return;
  if (inAgentMode()) leaveAgentMode();
  if (row.external) view.resume(row.external);
  else if (row.pane) run("pane.focus", { pane: row.pane });
  else view.peek(row.address);
}

function agentCard(view, row, t, focusedAddress) {
  const pic = row.program?.icon;
  const notice = statusNotice(row);
  const note = notice?.text || row.activity?.trim() || statusInfo(row.status).summary;
  const color = statusColor(t, row.status) ?? t.dim;
  const selected = view.villageSelected === row.id;
  const active = Boolean(row.address && row.address === focusedAddress);
  const marker = active ? "Active" : selected ? "Selected" : null;
  const themed = view.skin === "chiikawa", sprite = themed ? agentSprite(view, row, true) : null;
  const scale = sprite ? Math.min(64 / sprite.width, 64 / sprite.height) : 1;
  const identity = `${row.agent} · ${row.address || row.sourceLabel}`;
  return v_flex().id(`overview-${row.id}`).flex_1().min_w(0).min_h(246).p(12).gap(8)
    .rounded(12).border(1).border_color(marker ? t.accent : t.border).bg(selected ? t.selected : t.raised ?? t.chrome).cursor_pointer()
    .accessibility_label(`${row.title}, ${row.project}, ${identity}, ${statusLabel(row.status)}${marker ? `, ${marker}` : ""}`)
    .hover((style) => style.border_color(marker ? t.accent : color).bg(selected ? t.selected : t.hover))
    .tooltip([row.title, row.cwd, row.context, row.activity].filter(Boolean).join("\n"))
    .on_click((_e, cx) => { cx.stop_propagation(); if (themed || inAgentMode()) selectVillageResident(view, row, cx); else openRow(view, row); })
    .child(h_flex().h(20).flex_none().min_w(0).gap(6).items_center()
      .when(Boolean(pic), (el) => el.child(row.program.tint ? svg(pic).size(14).flex_none().text_color(t.foreground) : image(pic).size(14).flex_none()))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).tooltip(identity).child(identity))
      .child(h_flex().h(20).px(7).gap(4).flex_none().items_center().rounded(6).bg(t.background)
        .tooltip(`${statusLabel(row.status)}${row.at ? ` · State changed ${agoText(row.at)}` : ""}`)
        .child(statusMark(t, row.status))
        .child(div().text_size(11).font_medium().text_color(color).child(statusLabel(row.status)))))
    .child(h_flex().min_h(68).flex_none().min_w(0).gap(10).items_center()
      .when(themed, (el) => el.child(div().id(`overview-resident-${row.id}`).size(64).flex_none().rounded(12).bg(t.chrome)
        .flex().items_center().justify_center()
        .child(image(sprite.path).w(sprite.width * scale).h(sprite.height * scale).flex_none())))
      .child(v_flex().flex_1().min_w(0).gap(3)
        .child(div().id(`overview-title-${row.id}`).h(36).flex_none().overflow_hidden().whitespace_normal().text_size(15).line_height(1.2)
          .font_semibold().text_color(t.foreground).tooltip(row.title).child(row.title))
        .child(div().truncate().text_size(11).text_color(t.foreground).tooltip(row.project).child(row.project))
        .child(div().truncate().text_size(10).text_color(t.muted).tooltip(row.branch || row.cwd || row.sourceLabel)
          .child(row.branch || row.sourceLabel))))
    .child(v_flex().id(`overview-preview-${row.id}`).flex_none().min_w(0).p(8).gap(4).rounded(8)
      .border(1).border_color(notice ? color : t.border).bg(t.background)
      .child(div().text_size(10).line_height(1.2).font_semibold().text_color(notice ? color : t.muted)
        .child(notice ? "Read required" : row.activity?.trim() ? "Latest activity" : "Session status"))
      .child(div().h(51).flex_none().overflow_hidden().whitespace_normal().text_size(12).line_height(1.4)
        .text_color(t.foreground).tooltip(note).child(note)))
    .child(h_flex().flex_none().min_w(0).gap(6).items_center().flex_wrap()
      .when(Boolean(marker), (el) => el.child(div().id(`overview-selected-${row.id}`).flex_none()
        .text_size(10).font_semibold().text_color(t.accent).child(marker)))
      .child(div().flex_1().min_w(0))
      .child(button(`overview-details-${row.id}`, "View details", (cx) => { view.composerOpen = true; selectVillageResident(view, row, cx); }, t).h(28).px(8).text_size(11))
      .child(button(`overview-open-${row.id}`, row.external ? "Open in Herdr" : "Open terminal", () => openRow(view, row), t)
        .h(28).px(8).text_size(11).border(1).border_color(t.border).bg(t.background).text_color(t.foreground)));
}

export function renderAgentView(view) {
  const t = agentTheme(theme(), view.skin), now = Date.now();
  // Repainting GIFs must not reread every live session on every animation frame.
  if (view.skin !== "chiikawa" || !view.overviewRows || now - view.overviewRowsAt > 2000 || view.overviewOutside !== view.outside) {
    view.overviewRows = agentViewRows(view.outside);
    view.overviewRowsAt = now;
    view.overviewOutside = view.outside;
  }
  const focusedAddress = focused()?.terminal;
  // Focus, pinning and sidebar sort changes must reach even cached Chiikawa rows.
  view.overviewRows = orderAgentRows(view.overviewRows);
  const all = inAgentMode() ? view.overviewRows.filter((row) => !statusInfo(row.status).quiet || row.address === focusedAddress
    || row.id === view.villageSelected) : view.overviewRows;
  view.lastThemeRender = now;
  const scope = filterAgentRows(all, view.input.value(), "all", view.sourceFilter);
  const rows = filterAgentRows(scope, "", view.statusFilter);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  view.page = Math.min(view.page ?? 0, pages - 1);
  const start = view.page * PAGE_SIZE;
  const visible = rows.slice(start, start + PAGE_SIZE);
  const back = props()?.returnPane;
  const canGoBack = Boolean(back && panes().some((pane) => pane.pane === back));
  if (view.skin === "chiikawa" && view.presentation !== "cards") return renderVillage(view, { t, all, scope, rows, visible, start, pages, back, canGoBack, states: STATES, sources: SOURCES, openRow });
  const columns = Math.max(1, Math.min(4, Math.floor(((view.width ?? 1100) - 32 + 12) / (300 + 12))));
  const cardRows = [];
  for (let i = 0; i < visible.length; i += columns) {
    const chunk = visible.slice(i, i + columns);
    cardRows.push(h_flex().gap(12).flex_none().children(chunk.map((row) => agentCard(view, row, t, focusedAddress)))
      .children(Array.from({ length: columns - chunk.length }, () => div().flex_1().min_w(0))));
  }
  return dragViewport(v_flex().id("agent-view").track_focus(view.handle).relative().size_full().bg(t.background).text_size(12.5), view)
    .on_size_change((size, cx) => { if (view.width !== size.width || view.height !== size.height) { view.width = size.width; view.height = size.height; cx.notify(); } })
    .child(overviewHeader(view, { t, rows, scope, states: STATES, sources: SOURCES }))
    .child(div().relative().flex_1().min_h(0).p(16)
      .child(v_flex().id(`overview-list-${view.page}`).size_full().overflow_y_scroll().gap(12)
        .children(cardRows)
        .when(rows.length === 0, (el) => el.child(v_flex().p(28).gap(8).items_center()
          .child(div().font_medium().text_color(t.foreground).child(all.length ? "No matching agents" : "No agents running yet"))
          .child(div().text_size(12).text_color(t.muted).child(all.length ? "Try another search, status or source." : "Agents appear here when Herdr or a supported local app reports them.")))))
      .child(Scrollbar.vertical(`overview-list-${view.page}`).absolute().inset_0()))
    .child(footer(rows.length ? `${start + 1}–${start + visible.length} of ${rows.length} agents · Activity updates automatically` : "Activity updates automatically", t,
      ...(pages > 1 ? [button("overview-prev", "Previous", (cx) => { view.page--; cx.notify(); }, t, { disabled: view.page === 0 }),
        button("overview-next", "Next", (cx) => { view.page++; cx.notify(); }, t, { disabled: view.page === pages - 1 })] : [])))
    .when(Boolean(visible.find((row) => row.id === view.villageSelected))
      && (!inAgentMode() || !hasTerminalDock() || view.composerOpen || visible.find((row) => row.id === view.villageSelected)?.external),
      (el) => el.child(villageDetails(view, visible.find((row) => row.id === view.villageSelected), t, STATES, view.width || 1100, openRow)));
}
