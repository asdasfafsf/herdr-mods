// Provider adapters return data and key plans; they never perform transport or
// own UI/state. Add a numbered profile here, or supply parse/keys for another UI.
export const cleanScreen = (text) => String(text ?? "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\r/g, "");

export function numberedPermission(text) {
  const lines = cleanScreen(text).split("\n");
  let choices = [], start = -1, ended = false, labelColumn = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/^(\s*)[│┃]\s?/, "$1").replace(/\s*[│┃]\s*$/, "");
    const match = line.match(/^(\s*)([›❯>●])?\s*([1-9])[.)]\s+(.+?)\s*$/);
    if (!match) {
      if (!choices.length || /^[\s─━┌┐└┘├┤┬┴┼╭╮╰╯│┃-]*$/.test(line)) continue;
      if (!ended && line.search(/\S/) >= labelColumn) {
        choices.at(-1).label += ` ${line.trim()}`;
      } else if (/^(?:press\s+)?(?:enter\b|esc\b|escape\b|use\s+[↑↓←→]|[↑↓←→])/i.test(line.trim())) {
        ended = true;
      } else {
        // A new prompt after an old menu must not inherit its choices.
        choices = []; start = -1; ended = true;
      }
      continue;
    }
    const number = Number(match[3]);
    if (number === 1) { choices = []; start = i; ended = false; }
    if (ended || number !== choices.length + 1) { choices = []; start = -1; continue; }
    labelColumn = line.indexOf(match[4]);
    choices.push({ number, label: match[4].trim(), selected: Boolean(match[2]) });
  }
  if (choices.length < 2 || choices.filter((choice) => choice.selected).length !== 1
      || !/^(yes|allow|approve|proceed)\b/i.test(choices[0].label)
      || !choices.some((choice) => /^(no\b|deny\b|reject\b|cancel\b)/i.test(choice.label))) return null;
  return { choices, context: lines.slice(Math.max(0, start - 16), start).join("\n").trim() };
}

export function numberedApprovalAdapter({ id, programs = [id] }) {
  return {
    id, version: 1,
    matches(live) {
      const app = String(live.status?.app || "").toLowerCase();
      const name = String(live.foreground?.name || "").split("/").pop().replace(/^-/, "").toLowerCase();
      const owns = (value) => programs.some((program) => value === program || value.startsWith(`${program}-`) || value.startsWith(`${program} `));
      // A stale status from a previous process must not target a shell or a
      // different CLI. Interpreter-hosted providers need their own adapter.
      return owns(name) && (!app || owns(app));
    },
    parse: numberedPermission,
    keys(request, number) {
      const selected = request.choices.findIndex((choice) => choice.selected);
      const target = request.choices.findIndex((choice) => choice.number === number);
      if (selected < 0 || target < 0) return null;
      const distance = target - selected;
      return [...Array(Math.abs(distance)).fill(distance < 0 ? "up" : "down"), "enter"];
    },
  };
}

export const APPROVAL_ADAPTERS = [
  numberedApprovalAdapter({ id: "codex" }),
  numberedApprovalAdapter({ id: "claude", programs: ["claude", "claude-code"] }),
  numberedApprovalAdapter({ id: "gemini", programs: ["gemini", "gemini-cli"] }),
];
export const approvalAdapter = (live) => APPROVAL_ADAPTERS.find((adapter) => adapter.matches(live));
