// Shared session interaction for cards and village. Reading never sends keys;
// a choice is sent only by its button, to the request that button displayed.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec } from "herdr";
import { button } from "./ui.js";
import { inAgentMode, agentViewVisible } from "./agent-mode.js";
import { cleanScreen, numberedPermission, approvalAdapter } from "./approval-providers.js";

export const permissionChoices = (text) => numberedPermission(text)?.choices || [];

export function requestSnapshot(address, live, screen) {
  const text = cleanScreen(screen?.text).trimEnd();
  if (live?.state !== "live" || (live.address && live.address !== address) || live.status?.state !== "blocked" || live.status?.kind !== "permission"
      || screen?.complete !== true || !live.foreground?.pid || live.created_ms == null
      || live.turn == null || live.status_ms == null) return null;
  const adapter = approvalAdapter(live), parsed = adapter?.parse(text);
  if (!parsed?.choices?.length) return null;
  const identity = JSON.stringify([
    adapter.id, adapter.version, live.foreground.name,
    address, live.created_ms, live.foreground.pid, live.turn, live.status_ms,
    live.status.app, live.status.kind, live.status.msg,
  ]);
  return { ...parsed, address, text, provider: adapter.id, identity, fingerprint: JSON.stringify([identity, text]) };
}

async function readSession(address) {
  const [facts, screen] = await Promise.all([
    exec("hc", ["get", "--json", "--", address]),
    // Zero history never scrolls a full-screen CLI or changes its viewport.
    exec("hc", ["read", "--json", "--lines", "0", "--", address]),
  ]);
  if (facts.code !== 0 || screen.code !== 0) throw new Error("Session is unavailable.");
  return { live: JSON.parse(facts.stdout), screen: JSON.parse(screen.stdout) };
}

export function refreshSession(chat, cx) {
  if (chat.refreshing || chat.acting || Date.now() - (chat.refreshedAt || 0) < 1500) return;
  const generation = chat.requestGeneration || 0, address = chat.address;
  chat.refreshing = true;
  cx.spawn(async (cx) => {
    try {
      const { live, screen } = await readSession(address);
      if ((chat.requestGeneration || 0) !== generation || chat.address !== address) return;
      chat.screen = cleanScreen(screen.text).slice(-24000);
      const request = requestSnapshot(address, live, screen);
      chat.request = request?.identity === chat.attemptedRequest ? null : request;
      chat.requestKind = live.status?.state === "blocked" ? live.status.kind || "question" : null;
      chat.readError = "";
    } catch {
      if ((chat.requestGeneration || 0) !== generation || chat.address !== address) return;
      chat.request = null;
      chat.readError = "Could not read this session. Open its terminal to respond.";
    } finally {
      if ((chat.requestGeneration || 0) === generation) chat.refreshedAt = Date.now();
      chat.refreshing = false; cx.notify();
    }
  });
}

export function sessionState(view, row) {
  if (!row.address || row.external) return null;
  const chats = view.villageChats ??= new Map();
  if (chats.get(row.id)?.address !== row.address) chats.set(row.id, { address: row.address });
  return chats.get(row.id);
}

export function initSessionControls(view, cx, readSelected = () => true) {
  cx.timer.every(2000, (cx) => {
    if (inAgentMode() && !agentViewVisible()) return;
    for (const row of view.visibleOverviewRows || []) {
      if (row.status !== "blocked" && !(row.id === view.villageSelected && readSelected())) continue;
      const chat = sessionState(view, row);
      if (chat) refreshSession(chat, cx);
    }
  });
}

export function choosePermission(chat, displayed, choiceNumber, cx) {
  if (chat.acting || chat.sending || !displayed || chat.address !== displayed.address
      || chat.request?.fingerprint !== displayed.fingerprint || displayed.identity === chat.attemptedRequest) return;
  const choice = displayed.choices.find((item) => item.number === choiceNumber);
  if (!choice) return;
  chat.requestGeneration = (chat.requestGeneration || 0) + 1;
  chat.acting = true; chat.actionError = ""; chat.actionReceipt = "";
  cx.notify();
  cx.spawn(async (cx) => {
    let attempted = false;
    try {
      const { live, screen } = await readSession(displayed.address);
      const current = requestSnapshot(displayed.address, live, screen);
      if (!current || current.fingerprint !== displayed.fingerprint) {
        chat.request = current;
        throw new Error("The request changed. Review the current request before choosing.");
      }
      const keys = approvalAdapter(live)?.keys(current, choiceNumber);
      if (!Array.isArray(keys) || !keys.length || keys.length > 16
          || keys.some((key) => typeof key !== "string" || !key || /[\x00-\x1f]/.test(key)))
        throw new Error("This request needs the terminal controls.");
      attempted = true; chat.attemptedRequest = displayed.identity;
      const result = await exec("hc", ["keys", "--json", "--", displayed.address, ...keys], { timeout: 15000 });
      if (result.code !== 0) throw new Error("The result is uncertain. Check the session before trying again.");
      chat.actionReceipt = `Sent: ${choice.label}`;
      chat.request = null;
    } catch (error) {
      chat.actionError = attempted ? "The result is uncertain. Check the session before trying again." : error.message;
      if (attempted) chat.request = null;
    } finally {
      chat.acting = false; chat.refreshedAt = 0; cx.notify();
    }
  });
}

export function renderInlinePermission(chat, t, id) {
  if (!chat) return null;
  const request = chat.request;
  return v_flex().id(`permission-${id}`).gap(5).flex_none()
    .when(Boolean(request), (el) => el
      .child(div().id(`permission-context-${id}`).max_h(88).overflow_y_scroll().p(6).rounded(5).bg(t.background)
        .font_family("JetBrains Mono").text_size(10).line_height(1.35).text_color(t.foreground).whitespace_normal()
        .tooltip(request.text).child(request.context || request.text))
      .child(permissionButtons(chat, t, id)))
    .when(!request, (el) => el.child(div().text_size(10).text_color(t.muted).whitespace_normal()
      .child(chat.refreshing || !chat.refreshedAt ? "Checking available actions…" : "Use the terminal for this request.")))
    .when(Boolean(chat.readError || chat.actionError || chat.actionReceipt || chat.acting), (el) => el.child(div()
      .id(`${id}-action-feedback`).text_size(10).text_color(chat.readError || chat.actionError ? t.blocked : t.muted).whitespace_normal()
      .child(chat.acting ? "Sending your choice…" : chat.actionError || chat.readError || chat.actionReceipt)));
}

function permissionButtons(chat, t, id) {
  const request = chat.request;
  return v_flex().gap(4).children(request.choices.map((choice) => div().id(`${id}-choice-${choice.number}`)
    .px(8).py(6).rounded(6).border(1).border_color(t.border).bg(t.background)
    .text_size(11).text_color(t.foreground).whitespace_normal().flex_none()
    .accessibility_label(choice.label)
    .when(!chat.acting && !chat.sending, (el) => el.cursor_pointer().hover((el) => el.bg(t.hover).border_color(t.accent))
      .on_click((_event, cx) => { cx.stop_propagation(); choosePermission(chat, request, choice.number, cx); }))
    .when(chat.acting || chat.sending, (el) => el.opacity(0.5)).child(choice.label)));
}

export function renderSessionControls(chat, t) {
  if (!chat) return null;
  const request = chat.request;
  return v_flex().id("session-controls").gap(9).flex_none()
    .child(h_flex().items_center().gap(8)
      .child(div().flex_1().text_size(12).font_semibold().text_color(t.foreground)
        .child(request ? "Approval request" : chat.requestKind ? "Needs you" : "Recent terminal output"))
      .child(button("session-refresh", chat.refreshing ? "Refreshing…" : "Refresh", (cx) => {
        chat.refreshedAt = 0; refreshSession(chat, cx);
      }, t, { disabled: chat.refreshing || chat.acting })))
    .child(div().id("session-screen").max_h(request ? 340 : 420).min_h(56).overflow_y_scroll()
      .p(10).rounded(7).border(1).border_color(t.border).bg(t.background)
      .child(div().font_family("JetBrains Mono").text_size(11).line_height(1.45).text_color(t.foreground).whitespace_normal()
        .child(request?.text || chat.screen || "Select Refresh to read the session.")))
    .when(Boolean(request), (el) => el.child(permissionButtons(chat, t, "session")))
    .when(Boolean(chat.requestKind && !request), (el) => el.child(div().text_size(11).text_color(t.muted).whitespace_normal()
      .child("This prompt needs the terminal controls. Open the session to respond.")))
    .when(Boolean(chat.readError || chat.actionError || chat.actionReceipt || chat.acting), (el) => el.child(div()
      .id("session-action-feedback").text_size(11).text_color(chat.readError || chat.actionError ? t.blocked : t.muted).whitespace_normal()
      .child(chat.acting ? "Sending your choice…" : chat.actionError || chat.readError || chat.actionReceipt)));
}
