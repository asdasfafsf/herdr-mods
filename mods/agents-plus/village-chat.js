// One retained editor per resident. Selection, rendering and drafts never send.
import { div } from "gpui-kit";
import { h_flex, v_flex, TextareaState, Textarea } from "gpui-base";
import { agents, terminals, exec, run } from "herdr";
import { button } from "./ui.js";
import { inAgentMode } from "./agent-mode.js";

const BLOCKED = "Review the request above before sending another message.";
const UNAVAILABLE = "지금 대화할 수 없는 세션이에요. 세션을 열어 확인해주세요.";
const UNCERTAIN = "전송을 확인하지 못했어요. 세션에서 도착 여부를 확인한 뒤 다시 보내주세요.";
const LIMIT = 16000;

export function selectVillageResident(view, row, cx, focusSession = true) {
  view.villageSelected = row.id;
  const chats = view.villageChats ??= new Map();
  if (row.address && !row.external && !chats.has(row.id)) {
    const input = TextareaState.new({ placeholder: "이 에이전트에게 말 걸기…", rows: 3 });
    const chat = { address: row.address, input, sending: false, error: "", receipt: "", version: 0 };
    chats.set(row.id, chat);
    input.on("change", (_e, cx) => { chat.version++; chat.error = ""; chat.receipt = ""; cx.notify(); });
    // Plain Enter stays a newline; only the editor's secondary submit sends.
    input.on("submit", (e, cx) => { if (e?.secondary) sendVillageMessage(chat, cx); });
  }
  if (inAgentMode() && focusSession) {
    if (row.pane) run("pane.focus", { pane: row.pane });
  }
  cx.notify();
}

export function sendVillageMessage(chat, cx) {
  const text = chat.input.value();
  if (chat.sending || !text.trim()) return;
  if (text.length > LIMIT) { chat.error = "메시지는 16,000자까지 보낼 수 있어요."; cx.notify(); return; }
  // Never treat a shell (including a kept terminal after its agent exits) as an agent.
  const terminal = terminals().find((item) => item.address === chat.address);
  const agent = agents().find((item) => item.address === chat.address);
  const program = agent?.program ?? terminal?.program;
  const status = agent?.status ?? terminal?.status;
  if (terminal?.state !== "live" || !program?.agent) { chat.error = UNAVAILABLE; cx.notify(); return; }
  if (status === "blocked" || status === "error") { chat.error = BLOCKED; cx.notify(); return; }
  const version = chat.version;
  chat.sending = true; chat.error = ""; chat.receipt = "";
  cx.notify();
  cx.spawn(async (cx) => {
    let attempted = false;
    try {
      const check = await exec("hc", ["get", "--json", "--", chat.address]);
      if (check.code !== 0) throw new Error(UNAVAILABLE);
      const live = JSON.parse(check.stdout), state = live.status?.state;
      const foreground = live.foreground?.name?.replace(/^-/, "");
      if (live.state !== "live" || !["idle", "working", "done", "blocked", "error"].includes(state)
          || ["sh", "bash", "zsh", "fish", "dash", "pwsh", "powershell", "cmd"].includes(foreground)) throw new Error(UNAVAILABLE);
      if (state === "blocked" || state === "error") throw new Error(BLOCKED);
      const args = ["send", "--json"];
      // Core checks these states again at delivery; done is not an --if value.
      if (state === "idle" || state === "working") args.push("--if", state);
      args.push("--", chat.address, text);
      attempted = true;
      // Core may wait up to 60s for an unfinished terminal draft. No --force,
      // no --wait for the entire agent turn, and no automatic retry.
      const result = await exec("hc", args, { timeout: 90000 });
      if (result.code !== 0) {
        chat.error = result.code === 9 ? BLOCKED : result.code === 10 ? "에이전트 상태가 바뀌어 보내지 않았어요. 상태를 확인하고 다시 보내주세요."
          : result.code === 3 || result.code === 11 ? UNAVAILABLE : UNCERTAIN;
        return;
      }
      chat.receipt = "전달했어요. 새 답변은 말풍선에 표시돼요.";
      // A late result must not erase another draft, even on the same resident.
      if (chat.version === version && chat.input.value() === text) chat.input.set_value("");
    } catch (error) {
      chat.error = attempted ? UNCERTAIN : error.message === BLOCKED ? BLOCKED : UNAVAILABLE;
    } finally {
      chat.sending = false;
      cx.notify();
    }
  });
}

export function renderVillageChat(view, row, t) {
  const chat = view.villageChats?.get(row.id);
  if (!row.address || row.external) return div().text_size(11).text_color(t.muted).whitespace_normal()
    .child("세션을 Herdr에서 이어 열면 마을에서도 말을 걸 수 있어요.");
  if (!chat) return null;
  const blocked = row.status === "blocked";
  const disabled = chat.sending || blocked || !chat.input.value().trim() || chat.input.value().length > LIMIT;
  const note = chat.error || (chat.sending ? "전달 중이에요. 터미널에서 작성 중이면 기다려요." : blocked ? BLOCKED : chat.receipt);
  return v_flex().id("village-chat").flex_none().gap(7).pt(3)
    // Padding belongs to a separate frame: the native editor needs its full
    // three-line height for text, selection and the IME composition underline.
    .child(div().flex_none().p(10).rounded(8).border(1).border_color(t.border).bg(t.background)
      .child(Textarea.new(chat.input).id(`village-message-${row.id}`).w_full().h(72).min_h(72).flex_none()
        .text_size(12).line_height(1.5).text_color(t.foreground).accessibility_label(`${row.agent}에게 보낼 메시지`)))
    .when(Boolean(note), (el) => el.child(div().id("village-chat-feedback").text_size(11).line_height(1.4)
      .text_color(chat.error ? t.blocked : t.muted).whitespace_normal().child(note)))
    .child(h_flex().flex_none().items_center().gap(8)
      .child(div().flex_1().text_size(10).text_color(t.muted).child("⌘ Enter로 보내기"))
      .child(button("village-send", chat.sending ? "전달 중…" : "보내기", (cx) => sendVillageMessage(chat, cx), t, { kind: "primary", disabled })));
}
