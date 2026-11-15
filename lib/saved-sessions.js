import { SAVED_HISTORY } from "./agent-status.js";

// Saved history is a source of resumable sessions, never a fabricated live status.
// It sits after every live group (including Idle) and never populates the village.
export const SAVED_SESSIONS = { ...SAVED_HISTORY, pageSize: 8, limit: 60 };
export const savedSessionKey = (row) => `${row.agent}:${row.session}`;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

export const validSavedSession = (row) => Boolean(row && ["claude", "codex"].includes(row.agent)
  && typeof row.session === "string" && uuid.test(row.session)
  && typeof row.cwd === "string" && row.cwd.startsWith("/") && !/[\x00-\x1f\x7f]/.test(row.cwd)
  && typeof row.title === "string" && row.title.trim()
  && Number.isFinite(row.updated) && row.updated >= 0);

export function savedLiveTerminal(row, live, terminals) {
  const address = live[row.session];
  return terminals.some((term) => term.state === "live" && term.address === address) ? address : null;
}

export function savedSessionRows(rows, live, outside, terminals, pending, now) {
  if (!rows.length) return [];
  const attached = new Set(terminals.filter((term) => term.state === "live").map((term) => term.address));
  const represented = new Set(Object.entries(live).filter(([, address]) => attached.has(address)).map(([id]) => id));
  const external = new Set(outside.filter((row) => row.session).map(savedSessionKey));
  const seen = new Set();
  return rows.filter(validSavedSession).sort((a, b) => b.updated - a.updated || savedSessionKey(a).localeCompare(savedSessionKey(b))).filter((row) => {
    const key = savedSessionKey(row);
    if (represented.has(row.session) || external.has(key) || seen.has(key) || (pending.get(key) ?? 0) > now) return false;
    seen.add(key);
    return true;
  }).slice(0, SAVED_SESSIONS.limit);
}

// Only installed launch settings may contribute argv. History is data, not a command.
// Keep this payload compatible with spaces-plus.resume and the standalone fallback.
export function savedResumeRecord(row, known = []) {
  if (!validSavedSession(row)) throw new Error("Invalid saved session.");
  const configured = known.find((item) => item.key === row.agent && item.installed);
  const launch = configured?.run ?? [row.agent];
  if (!Array.isArray(launch) || !launch.length || launch.some((part) => typeof part !== "string" || !part || part.includes("\0")))
    throw new Error("Invalid agent launch settings.");
  const argv = [launch[0]];
  for (let i = 1; i < launch.length; i++) {
    const [name] = launch[i].split("=");
    if (row.agent === "codex" && ["--remote", "--remote-auth-token-env"].includes(name))
      throw new Error("A local saved session cannot use a remote Codex launch setting.");
    // The saved folder wins; starting images and print/exec/fork options must not
    // submit another turn or select/create a different conversation.
    if (row.agent === "codex" && ["--cd", "-C", "--image", "-i"].includes(name)) {
      if (!launch[i].includes("=")) i++;
      continue;
    }
    if (row.agent === "codex" && /^-(?:C|i).+/.test(launch[i])) continue;
    argv.push(launch[i]);
  }
  return { agent: row.agent, session: row.session, cwd: row.cwd,
    title: row.title.trim().slice(0, 100), argv };
}
