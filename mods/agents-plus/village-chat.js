// One retained editor per resident. Selection, rendering and drafts never send.
import { div, image } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { agents, terminals, exec, run } from "herdr";
import { button } from "./ui.js";
import { inAgentMode, requestAgentSelection } from "./agent-mode.js";
import { hasTerminalDock, openTerminalDock } from "./terminal-dock.js";
import { MAX_IMAGES, MESSAGE_LIMIT, imagePath, imageName, imageMessage, recordComposerEdit, prepareComposerSubmit } from "./composer.js";

const BLOCKED = "Review the request above before sending another message.";
const UNAVAILABLE = "This session is unavailable. Open its terminal to check it.";
const UNCERTAIN = "Delivery could not be confirmed. Check the terminal before sending again.";

export function selectVillageResident(view, row, cx, focusSession = true) {
  view.villageSelected = row.id;
  const chats = view.villageChats ??= new Map();
  if (row.address && !row.external && !chats.get(row.id)?.input) {
    const input = TextareaState.new({ placeholder: "Message this agent…", rows: 3 });
    const attachmentInput = InputState.new({ placeholder: "Absolute image path" });
    const chat = Object.assign(chats.get(row.id) || {}, { address: row.address, input, attachmentInput, images: [], draft: "", sending: false, error: "", receipt: "", version: 0 });
    chats.set(row.id, chat);
    input.on("change", (_e, cx) => { recordComposerEdit(chat); cx.notify(); });
    input.on("submit", (e, cx) => { if (prepareComposerSubmit(chat, e)) sendVillageMessage(chat, cx); });
    input.on("paste_other", (_e, cx) => { chat.error = "Paste clipboard images in the terminal, or drop image files here."; cx.notify(); });
    attachmentInput.on("submit", (_e, cx) => addVillageImages(chat, [attachmentInput.value()], cx));
  }
  if (inAgentMode() && focusSession) {
    if (row.address) view.selectionSequence = requestAgentSelection(row.id, row.address);
    if (row.address && hasTerminalDock()) openTerminalDock(row.address);
    else if (row.pane) run("pane.focus", { pane: row.pane });
  }
  cx.notify();
}

export function addVillageImages(chat, paths, cx) {
  if (chat.sending) return;
  try {
    const additions = [...new Set(paths.map(imagePath))].filter((path) => !chat.images.some((item) => item.path === path));
    if (chat.images.length + additions.length > MAX_IMAGES) throw new Error(`Attach up to ${MAX_IMAGES} images per message.`);
    chat.images.push(...additions.map((path) => ({ path })));
    chat.version++; chat.error = ""; chat.receipt = ""; chat.showAttachmentInput = false;
    chat.attachmentInput.set_value("");
  } catch (error) { chat.error = error.message; }
  cx.notify();
}

function liveSession(chat) {
  const terminal = terminals().find((item) => item.address === chat.address);
  const agent = agents().find((item) => item.address === chat.address);
  const program = agent?.program ?? terminal?.program, status = agent?.status ?? terminal?.status;
  if (terminal?.state !== "live" || !program?.agent) throw new Error(UNAVAILABLE);
  if (status === "blocked" || status === "error") throw new Error(BLOCKED);
}

async function readSendState(chat) {
  const check = await exec("hc", ["get", "--json", "--", chat.address]);
  if (check.code !== 0) throw new Error(UNAVAILABLE);
  const live = JSON.parse(check.stdout), state = live.status?.state;
  const foreground = live.foreground?.name?.replace(/^-/, "");
  if (live.state !== "live" || !["idle", "working", "done", "blocked", "error"].includes(state)
      || ["sh", "bash", "zsh", "fish", "dash", "pwsh", "powershell", "cmd"].includes(foreground)) throw new Error(UNAVAILABLE);
  if (state === "blocked" || state === "error") throw new Error(BLOCKED);
  return state;
}

export function sendVillageMessage(chat, cx) {
  const text = chat.input.value();
  const attachments = [...(chat.images ?? [])];
  if (chat.sending || (!text.trim() && !attachments.length)) return;
  if (text.length > MESSAGE_LIMIT) { chat.error = "Messages can contain up to 16,000 characters."; cx.notify(); return; }
  // Never treat a shell (including a kept terminal after its agent exits) as an agent.
  try { liveSession(chat); } catch (error) { chat.error = error.message; cx.notify(); return; }
  const version = chat.version;
  chat.sending = true; chat.error = ""; chat.receipt = "";
  cx.notify();
  cx.spawn(async (cx) => {
    let attempted = false;
    try {
      let state = await readSendState(chat);
      const paths = [];
      for (const attachment of attachments) {
        if (!attachment.uploaded) {
          const result = await exec("hc", ["put", "--json", "--", chat.address, attachment.path], { timeout: 90000 });
          if (result.code !== 0) throw new Error(`Could not attach ${imageName(attachment.path)}. Your draft is saved.`);
          const path = JSON.parse(result.stdout).path;
          if (typeof path !== "string" || !path || /[\x00-\x1f\x7f]/.test(path)) throw new Error("The image upload returned an invalid path.");
          attachment.uploaded = path;
        }
        paths.push(attachment.uploaded);
      }
      // Uploading can take time. Re-check the exact target before delivery.
      if (attachments.length) { liveSession(chat); state = await readSendState(chat); }
      const message = imageMessage(text, paths);
      if (message.length > MESSAGE_LIMIT) throw new Error("Message and image paths exceed 16,000 characters. Shorten the message.");
      const args = ["send", "--json"];
      // Core checks these states again at delivery; done is not an --if value.
      if (state === "idle" || state === "working") args.push("--if", state);
      args.push("--", chat.address, message);
      attempted = true;
      // Core may wait up to 60s for an unfinished terminal draft. No --force,
      // no --wait for the entire agent turn, and no automatic retry.
      const result = await exec("hc", args, { timeout: 90000 });
      if (result.code !== 0) {
        chat.error = result.code === 9 ? BLOCKED : result.code === 10 ? "The agent's state changed. Check it before sending again."
          : result.code === 3 || result.code === 11 ? UNAVAILABLE : UNCERTAIN;
        return;
      }
      chat.receipt = "Delivered. New replies appear in the session.";
      // A late result must not erase another draft, even on the same resident.
      if (chat.version === version && chat.input.value() === text) {
        chat.input.set_value(""); chat.draft = ""; chat.lastEdit = null; chat.images = [];
      }
    } catch (error) {
      chat.error = attempted ? UNCERTAIN : error.message || UNAVAILABLE;
    } finally {
      chat.sending = false;
      cx.notify();
    }
  });
}

export function renderVillageChat(view, row, t) {
  const chat = view.villageChats?.get(row.id);
  if (!row.address || row.external) return div().text_size(11).text_color(t.muted).whitespace_normal()
    .child("Continue this session in Herdr to message it here.");
  if (!chat) return null;
  const blocked = row.status === "blocked";
  const images = chat.images ?? [];
  const disabled = chat.sending || blocked || (!chat.input.value().trim() && !images.length) || chat.input.value().length > MESSAGE_LIMIT;
  const note = chat.error || (chat.sending ? "Sending… Waiting for any unfinished terminal draft." : blocked ? BLOCKED : chat.receipt);
  return v_flex().id("village-chat").flex_none().gap(7).pt(3)
    .on_drop((event, cx) => { cx.stop_propagation(); addVillageImages(chat, event.paths, cx); })
    .when(images.length > 0, (el) => el.child(h_flex().id("village-images").gap(6).flex_wrap().max_h(96).overflow_y_scroll()
      .children(images.map((attachment, index) => h_flex().gap(5).items_center().p(4).rounded(6).border(1).border_color(t.border).bg(t.background)
        .child(image(attachment.path).w(32).h(32))
        .child(div().max_w(140).truncate().text_size(10).text_color(t.foreground).tooltip(attachment.path).child(imageName(attachment.path)))
        .child(button(`village-image-remove-${index}`, "Remove", (cx) => { chat.images.splice(index, 1); chat.version++; cx.notify(); }, t, { disabled: chat.sending }))))))
    .when(chat.showAttachmentInput, (el) => el.child(h_flex().items_center().gap(6)
      .child(Input.new(chat.attachmentInput).h(32).flex_1().min_w(0).px(8).rounded(6).border(1).border_color(t.border).bg(t.background).text_color(t.foreground))
      .child(button("village-image-add", "Add", (cx) => addVillageImages(chat, [chat.attachmentInput.value()], cx), t, { disabled: chat.sending }))))
    // Padding belongs to a separate frame: the native editor needs its full
    // three-line height for text, selection and the IME composition underline.
    .child(div().flex_none().p(10).rounded(8).border(1).border_color(t.border).bg(t.background)
      .child(Textarea.new(chat.input).id(`village-message-${row.id}`).w_full().h(72).min_h(72).flex_none()
        .text_size(12).line_height(1.5).text_color(t.foreground).accessibility_label(`Message ${row.agent}`)))
    .when(Boolean(note), (el) => el.child(div().id("village-chat-feedback").text_size(11).line_height(1.4)
      .text_color(chat.error ? t.blocked : t.muted).whitespace_normal().child(note)))
    .child(h_flex().flex_none().items_center().gap(8).flex_wrap()
      .child(button("village-attach-image", "Add image file", (cx) => { chat.showAttachmentInput = !chat.showAttachmentInput; if (chat.showAttachmentInput) chat.attachmentInput.focus(); cx.notify(); }, t, { disabled: chat.sending }))
      .child(div().flex_1().min_w(120).whitespace_normal().text_size(10).text_color(t.muted).child("Enter to send · ⌘Enter for a new line · Drop images here"))
      .child(button("village-send", chat.sending ? "Sending…" : "Send", (cx) => sendVillageMessage(chat, cx), t, { kind: "primary", disabled })))
    .when(images.length > 0, (el) => el.child(div().text_size(10).text_color(t.muted).whitespace_normal()
      .child("Images are sent as file references. Use terminal paste/drop for native attachments.")));
}
