// Pure composer policy. Native text-state events own IME and cursor editing.
export const MAX_IMAGES = 6;
export const MESSAGE_LIMIT = 16000;
const IMAGE = /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i;

export function imagePath(value) {
  let path = String(value ?? "");
  if (/[\x00-\x1f\x7f]/.test(path)) throw new Error("Choose an image path without control characters.");
  path = path.trim();
  if ((path.startsWith('"') && path.endsWith('"')) || (path.startsWith("'") && path.endsWith("'"))) path = path.slice(1, -1);
  if (!path || /[\x00-\x1f\x7f]/.test(path)) throw new Error("Choose an image path without control characters.");
  if (!path.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(path)) throw new Error("Use the image's absolute file path.");
  if (!IMAGE.test(path)) throw new Error("Supported images: PNG, JPEG, WebP, GIF, BMP and TIFF.");
  return path;
}

export const imageName = (path) => path.split(/[\\/]/).pop();

// Match the host terminal's file-drop quoting; this is prompt text, never a shell command.
export function quoteImage(path) {
  if (/[\x00-\x1f\x7f]/.test(path)) throw new Error("The uploaded image path is invalid.");
  return /^[A-Za-z0-9/._\-+=:@%~,]+$/.test(path) ? path : `'${path.replace(/'/g, "'\\''")}'`;
}

export function imageMessage(text, paths) {
  return paths.length ? `${text}${text.trim() ? "\n\n" : ""}${paths.map(quoteImage).join(" ")}` : text;
}

export function recordComposerEdit(chat) {
  const next = chat.input.value();
  chat.lastEdit = { before: chat.draft ?? "", after: next };
  chat.draft = next;
  chat.version++;
  chat.error = "";
  chat.receipt = "";
}

// Current host Textarea emits Change, then Submit, after inserting Enter's
// newline. Use the preceding draft so Enter submits without deleting a
// selection or adding a line. Cmd/Shift+Enter keep native cursor-aware newline
// insertion. No raw key interception: confirming IME composition stays native.
export function prepareComposerSubmit(chat, event) {
  if (event?.secondary || event?.shift) return false;
  const current = chat.input.value(), edit = chat.lastEdit;
  if (edit?.after === current && edit.before !== current) {
    let prefix = 0, suffix = 0;
    while (prefix < edit.before.length && prefix < current.length && edit.before[prefix] === current[prefix]) prefix++;
    while (suffix < edit.before.length && suffix < current.length && edit.before[edit.before.length - suffix - 1] === current[current.length - suffix - 1]) suffix++;
    const newline = current.indexOf("\n", Math.max(0, current.length - suffix - 1));
    // Includes replacing a selection that already starts/ends with a newline.
    if (current.length - 1 <= edit.before.length && newline >= 0 && newline <= prefix) {
      chat.input.set_value(edit.before);
      chat.draft = edit.before;
    }
  }
  chat.lastEdit = null;
  return true;
}
