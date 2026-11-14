import { overviewHeader } from "./overview-header.js";
// A full-width, searchable view of all live agents. The sidebar remains the owner
// of ordering/seen state; viewing this screen never rewrites those settings.
import { div, image, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Scrollbar } from "gpui-base";
import { agents, terminals, panes, spaces, focused, shared, theme, props, run, window } from "herdr";
import { AGENT_INFO, ACKED, OPTIONS, TREES, LIVE } from "./state.js";
import { shownStatus, seenFor, statusMark, statusColor, button, footer, agoText, STATUS_FILTERS, statusRank, statusInfo, statusLabel, normalizeStatus } from "./ui.js";
import { inside } from "./places.js";
import { initAgentTheme, agentTheme, agentSprite } from "./agent-theme.js";
import { renderVillage, villageDetails } from "./village.js";
import { openAgentMode, leaveAgentMode, inAgentMode, agentViewVisible, AGENT_SELECTION } from "./agent-mode.js";
import { internalAgents } from "./internal-agents.js";
import { selectVillageResident } from "./village-chat.js";
import { initSessionControls } from "./session-controls.js";

const STATES = STATUS_FILTERS;
const SOURCES = [["all", "All sources"], ["herdr", "Herdr"], ["outside", "Outside Herdr"], ["child", "Sub-agents"]];
const PAGE_SIZE = 24; // Divisible into 1–4 columns; bound native element creation.

export function openAgentView(outside = []) {
  openAgentMode();
}

function revealResident(view, row, cx) {
  const all = view.overviewRows.filter((item) => !statusInfo(item.status).quiet
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
  initSessionControls(view, cx);
  if (inAgentMode()) {
    view.selectionSequence = shared(AGENT_SELECTION)?.sequence;
    cx.timer.every(250, (cx) => {
      if (!agentViewVisible()) return;
      const address = focused()?.terminal;
      const requested = shared(AGENT_SELECTION);
      if (requested && requested.sequence !== view.selectionSequence) {
        if (Date.now() - requested.at > 5000) view.selectionSequence = requested.sequence;
        // Wait for the host focus and activity snapshot to catch up to a click.
        const row = requested.sequence !== view.selectionSequence && view.overviewRows?.find((row) => row.id === requested.id);
        if (row && address === requested.address) {
          view.selectionSequence = requested.sequence;
          view.focusedResident = address;
          revealResident(view, row, cx);
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

// Index host snapshots once, including children without a visible pane. Shared
// Codex daemons are keyed by session, never PID; a resumed session appears once.
export function agentViewRows(outside = []) {
  const listed = agents(), all = terminals(), paneList = panes(), spaceList = spaces();
  const byAddress = new Map(all.map((terminal) => [terminal.address, terminal]));
  const byAgent = new Map(listed.map((agent) => [agent.address, agent]));
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
    if (seen.has(agent.address)) return;
    seen.add(agent.address);
    const terminal = byAddress.get(agent.address);
    let parent = terminal?.parent, ancestor = null;
    const visited = new Set([agent.address]);
    while (parent && !visited.has(parent)) {
      visited.add(parent);
      ancestor = byAgent.get(parent) ?? ancestor;
      if (ancestor) break;
      parent = byAddress.get(parent)?.parent;
    }
    const pane = byPane.get(agent.address), owner = agent.space ? agent : ancestor;
    const space = bySpace.get(owner?.space), tab = tabs.get(agent.tab ?? pane?.tab);
    const cwd = pane?.cwd || terminal?.cwd || space?.folder || "";
    const checkout = checkoutBySpace.get(owner?.space) ?? checkouts.find((c) => (c.machine ?? null) === (space?.machine ?? null) && c.path && cwd && inside(cwd, c.path));
    const program = agent.program ?? terminal?.program;
    const name = (tab?.named && tab.name) || pane?.title || agent.title || terminal?.name || terminal?.template || program?.name || agent.address;
    const child = Boolean(terminal?.parent);
    const raw = normalizeStatus(agent.status, child);
    const activity = info[agent.address] ?? {};
    const status = shownStatus(raw, { ...activity, acked: acked[agent.address] }, now, duration);
    rows.push({ id: agent.address, address: agent.address, pane: agent.pane ?? pane?.pane ?? pane?.id,
      title: name, program, agent: program?.name || program?.key || "Agent", status,
      project: checkout?.repo || space?.name || agent.space_name || cwd.split("/").filter(Boolean).pop() || "No project",
      branch: checkout?.branch || "", cwd,
      source: child ? "child" : "herdr", sourceLabel: child ? "Sub-agent" : space?.machine || "Herdr",
      context: child ? `Child of ${ancestor?.title || ancestor?.space_name || terminal.parent}` : "",
      activity: raw === "working" || raw === "blocked" ? activity.doing || "" : raw === "done" ? activity.said || "" : "",
      at: activity.at || 0 });
  };
  listed.forEach(add);
  all.filter((terminal) => terminal.state === "live" && (terminal.program?.agent || terminal.parent)).forEach(add);
  const parents = new Map(rows.map((row) => [row.address, row]));
  for (const child of internalAgents(listed, info)) {
    const parent = parents.get(child.parentAddress);
    if (!parent) continue;
    rows.push({ ...child, pane: parent.pane, title: child.name,
      agent: parent.agent, project: parent.project, branch: parent.branch,
      cwd: child.cwd || parent.cwd, source: "child", sourceLabel: "Internal sub-agent",
      context: `Managed by ${parent.title}`, activity: "" });
  }
  for (const external of outside) {
    if (external.session && live[external.session] && seen.has(live[external.session])) continue;
    const id = `outside-${external.agent}-${external.session ?? external.pid}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const checkout = checkouts.find((c) => !c.machine && c.path && inside(external.cwd, c.path));
    rows.push({ id, external, title: external.title || external.agent, agent: external.agent === "codex" ? "Codex" : "Claude",
      program: { icon: `icons/${external.agent}.svg` }, status: normalizeStatus(external.status),
      project: checkout?.repo || (external.cwd ?? "").split("/").filter(Boolean).pop() || "No project",
      branch: checkout?.branch || "", cwd: external.cwd || "", source: "outside", sourceLabel: external.app || "Outside Herdr",
      activity: "", context: "Continue in Herdr", at: (external.updated || 0) * 1000 });
  }
  return rows.sort((a, b) => statusRank(b.status) - statusRank(a.status) || b.at - a.at || a.title.localeCompare(b.title));
}

export function filterAgentRows(rows, query, status = "all", source = "all") {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((row) => (status === "all" || row.status === status)
    && (source === "all" || (source === "herdr" ? row.source !== "outside" : row.source === source))
    && words.every((word) => [row.title, row.agent, row.project, row.branch, row.cwd, row.sourceLabel, row.activity, row.context].join(" ").toLowerCase().includes(word)));
}

function openRow(view, row) {
  if (inAgentMode()) leaveAgentMode();
  if (row.external) view.resume(row.external);
  else if (row.pane) run("pane.focus", { pane: row.pane });
  else if (row.internal) run("pane.focus", { terminal: row.parentAddress });
  else view.peek(row.address);
}

function agentCard(view, row, t) {
  const pic = row.program?.icon;
  const note = row.activity || statusInfo(row.status).summary;
  const color = statusColor(t, row.status) ?? t.dim;
  const themed = view.skin === "chiikawa", sprite = themed ? agentSprite(view, row, true) : null;
  return v_flex().id(`overview-${row.id}`).flex_1().min_w(0).h(232).rounded(10).border(1).border_color(t.border).bg(t.raised ?? t.chrome).overflow_hidden().cursor_pointer()
    .hover((style) => style.border_color(color).bg(t.hover)).tooltip([row.title, row.cwd, row.context, row.activity].filter(Boolean).join("\n"))
    .on_click((_e, cx) => { cx.stop_propagation(); if (themed || inAgentMode()) selectVillageResident(view, row, cx); else openRow(view, row); })
    .child(div().h(3).flex_none().bg(color))
    .child(v_flex().flex_1().min_h(0).p(16).gap(12)
      .child(h_flex().gap(8).items_center()
        .when(Boolean(pic), (el) => el.child(row.program.tint ? svg(pic).size(18).text_color(t.foreground) : image(pic).size(18).flex_none()))
        .child(div().flex_1().truncate().text_size(12).text_color(t.muted).child(row.agent))
        .child(statusMark(t, row.status))
        .child(div().text_size(11).text_color(color).child(statusLabel(row.status))))
      .child(div().truncate().text_size(15).font_semibold().text_color(t.foreground).child(row.title))
      .child(h_flex().flex_1().min_h(0).gap(8).items_start().overflow_hidden()
        .when(themed, (el) => el.child(image(sprite.path).w(82 * sprite.width / sprite.height).h(82).flex_none()))
        .child(div().flex_1().min_w(0).overflow_hidden().whitespace_normal().text_size(12).text_color(t.muted).child(note)))
      .child(h_flex().min_w(0).gap(6).items_center()
        .child(svg("mods/workspace-chrome/layers.svg").size(12).flex_none().text_color(t.dim))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child(`${row.project}${row.branch ? ` · ${row.branch}` : ""}`)))
      .child(h_flex().gap(8).items_center().pt(9).border_t(1).border_color(t.border)
        .child(div().flex_1().truncate().text_size(10.5).text_color(t.dim).child(`${row.sourceLabel}${row.at ? ` · ${agoText(row.at)}` : ""}`))
        .child(div().text_size(11).text_color(t.accent).child(row.internal ? "Open parent session →" : "Open session →"))));
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
  const columns = Math.max(1, Math.min(4, Math.floor(((view.width ?? 1100) - 48) / 310)));
  const cardRows = [];
  for (let i = 0; i < visible.length; i += columns) {
    const chunk = visible.slice(i, i + columns);
    cardRows.push(h_flex().gap(14).flex_none().children(chunk.map((row) => agentCard(view, row, t)))
      .children(Array.from({ length: columns - chunk.length }, () => div().flex_1().min_w(0))));
  }
  return v_flex().id("agent-view").track_focus(view.handle).relative().size_full().bg(t.background).text_size(12.5)
    .on_size_change((size, cx) => { if (view.width !== size.width) { view.width = size.width; cx.notify(); } })
    .child(overviewHeader(view, { t, rows, scope, states: STATES, sources: SOURCES }))
    .child(div().relative().flex_1().min_h(0).p(16)
      .child(v_flex().id(`overview-list-${view.page}`).size_full().overflow_y_scroll().gap(14)
        .children(cardRows)
        .when(rows.length === 0, (el) => el.child(v_flex().p(28).gap(8).items_center()
          .child(div().font_medium().text_color(t.foreground).child(all.length ? "No matching agents" : "No agents running yet"))
          .child(div().text_size(12).text_color(t.muted).child(all.length ? "Try another search, status or source." : "Agents appear here when Herdr or a supported local app reports them.")))))
      .child(Scrollbar.vertical(`overview-list-${view.page}`).absolute().inset_0()))
    .child(footer(rows.length ? `${start + 1}–${start + visible.length} of ${rows.length} agents · Activity updates automatically` : "Activity updates automatically", t,
      ...(pages > 1 ? [button("overview-prev", "Previous", (cx) => { view.page--; cx.notify(); }, t, { disabled: view.page === 0 }),
        button("overview-next", "Next", (cx) => { view.page++; cx.notify(); }, t, { disabled: view.page === pages - 1 })] : [])))
    .when(Boolean(visible.find((row) => row.id === view.villageSelected)), (el) => el.child(villageDetails(view, visible.find((row) => row.id === view.villageSelected), t, STATES, view.width || 1100, openRow)));
}
