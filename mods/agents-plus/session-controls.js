// Shared session interaction for cards and village. Reading never sends keys;
// a choice is sent only by its button, to the request that button displayed.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec } from "herdr";
import { button } from "./ui.js";
import { inAgentMode, agentViewVisible } from "./agent-mode.js";

const cleanScreen = (text) => String(text ?? "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\r/g, "");
export function permissionChoices(text) {
  let choices = [];
  for (const line of cleanScreen(text).split("\n")) {
    const match = line.replace(/^[\s│┃]+/, "").match(/^([›❯>●])?\s*([1-9])[.)]\s+(.+)$/);
    if (!match) continue;
    const number = Number(match[2]);
    if (number === 1) choices = [];
    if (number !== choices.length + 1) { choices = []; continue; }
    choices.push({ number, label: match[3].trim(), selected: Boolean(match[1]) });
  }
  if (choices.length < 2 || choices.filter((choice) => choice.selected).length !== 1) return [];
  if (!/^(yes|allow|approve|proceed)\b/i.test(choices[0].label)
      || !choices.some((choice) => /^(no\b|deny\b|reject\b|cancel\b)/i.test(choice.label))) return [];
  return choices;
}

export function requestSnapshot(address, live, screen) {
  const text = cleanScreen(screen?.text).trimEnd();
  const app = `${live?.status?.app ?? ""} ${live?.foreground?.name ?? ""}`;
  if (live?.state !== "live" || live.status?.state !== "blocked" || live.status?.kind !== "permission"
      || !/codex|claude/i.test(app) || screen?.complete !== true || !live.foreground?.pid
      || live.turn == null || live.status_ms == null) return null;
  const choices = permissionChoices(text);
  if (!choices.length) return null;
  return { address, text, choices, fingerprint: JSON.stringify([
    address, live.created_ms, live.foreground.pid, live.turn, live.status_ms,
    live.status.app, live.status.kind, live.status.msg, text,
  ]) };
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
  chat.refreshing = true;
  cx.spawn(async (cx) => {
    try {
      const { live, screen } = await readSession(chat.address);
      chat.screen = cleanScreen(screen.text).slice(-24000);
      chat.request = requestSnapshot(chat.address, live, screen);
      chat.requestKind = live.status?.state === "blocked" ? live.status.kind || "question" : null;
      chat.readError = "";
    } catch {
      chat.request = null;
      chat.readError = "Could not refresh this session. Use Refresh to try again.";
    } finally {
      chat.refreshedAt = Date.now(); chat.refreshing = false; cx.notify();
    }
  });
}

export function initSessionControls(view, cx) {
  cx.timer.every(2000, (cx) => {
    if (inAgentMode() && !agentViewVisible()) return;
    const chat = view.villageChats?.get(view.villageSelected);
    if (chat) refreshSession(chat, cx);
  });
}

export function choosePermission(chat, displayed, choiceNumber, cx) {
  if (chat.acting || chat.sending || !displayed || chat.request?.fingerprint !== displayed.fingerprint) return;
  const choice = displayed.choices.find((item) => item.number === choiceNumber);
  if (!choice) return;
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
      const selected = current.choices.findIndex((item) => item.selected);
      const target = current.choices.findIndex((item) => item.number === choiceNumber);
      const distance = target - selected;
      const keys = [...Array(Math.abs(distance)).fill(distance < 0 ? "up" : "down"), "enter"];
      attempted = true;
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
    .when(Boolean(request), (el) => el.child(v_flex().gap(6)
      .children(request.choices.map((choice) => div().id(`session-choice-${choice.number}`).px(12).py(9).rounded(7)
        .border(1).border_color(t.border).bg(t.background).text_size(12).text_color(t.foreground).whitespace_normal()
        .when(!chat.acting && !chat.sending, (el) => el.cursor_pointer().hover((el) => el.bg(t.hover).border_color(t.accent))
          .on_click((_event, cx) => { cx.stop_propagation(); choosePermission(chat, request, choice.number, cx); }))
        .when(chat.acting || chat.sending, (el) => el.opacity(0.5)).child(`${choice.number}. ${choice.label}`)))))
    .when(Boolean(chat.requestKind && !request), (el) => el.child(div().text_size(11).text_color(t.muted).whitespace_normal()
      .child("This prompt needs the terminal controls. Open the session to respond.")))
    .when(Boolean(chat.readError || chat.actionError || chat.actionReceipt || chat.acting), (el) => el.child(div()
      .id("session-action-feedback").text_size(11).text_color(chat.readError || chat.actionError ? t.blocked : t.muted).whitespace_normal()
      .child(chat.acting ? "Sending your choice…" : chat.actionError || chat.readError || chat.actionReceipt)));
}
