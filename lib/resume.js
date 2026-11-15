// resume.js (herdr-mods lib): how a Claude Code or Codex session is found from a running
// process, and how it is started again. One copy here; install.sh puts it beside every mod
// that imports "./resume.js" (spaces-plus, wt-restore, agents-plus), since a mod can't
// import another mod's files. Change it here, then run install.sh.

import { exec, readTextFile, home, appHome, shared, setShared, terminals, run } from "herdr";
// Python dependency copied beside this module by install.sh: "./codex_live.py".
// Python dependency copied beside this module by install.sh: "./session_handoff.py".

// Per agent: its name and icon, the flags that take a value (kept with it when the agent is
// started again), the flags that pick a session (dropped: resuming picks it), and how it
// resumes a session, with an optional first message. Anything else that isn't a flag (a
// first prompt, a subcommand) is left out. fork: a new session from that one.
export const AGENTS = {
  claude: {
    name: "Claude Code",
    matches: (command) => /^claude/.test(command),
    icon: "icons/claude.svg",
    valued: new Set(["--model", "--permission-mode", "--add-dir", "--agent", "--agents", "--settings", "--setting-sources", "--mcp-config", "--allowedTools", "--allowed-tools", "--disallowedTools", "--disallowed-tools", "--append-system-prompt", "--system-prompt", "--effort", "--fallback-model", "--plugin-dir"]),
    dropped: new Set(["--resume", "-r", "--continue", "-c", "--session-id", "--fork-session", "-p", "--print"]),
    droppedValued: new Set(["--resume", "-r", "--session-id"]),
    resume: (argv0, flags, id, prompt) => [argv0, ...flags, "--resume", id, ...(prompt ? [prompt] : [])],
    fork: (argv0, flags, id) => [argv0, ...flags, "--resume", id, "--fork-session"],
  },
  codex: {
    name: "Codex",
    matches: (command) => /^codex/.test(command),
    icon: "icons/codex.svg",
    valued: new Set(["--model", "-m", "--sandbox", "-s", "--ask-for-approval", "-a", "--profile", "-p", "--cd", "-C", "-c", "--config", "--add-dir", "--image", "-i", "--local-provider", "--enable", "--disable", "--remote", "--remote-auth-token-env"]),
    dropped: new Set(["--last"]),
    droppedValued: new Set(),
    resume: (argv0, flags, id, prompt) => [argv0, "resume", ...flags, id, ...(prompt ? [prompt] : [])],
    fork: (argv0, flags, id) => [argv0, "fork", ...flags, id],
    // Installed desktop route, local threads only. Opening is a separate action;
    // a link is not permission to stop the current writer or submit a prompt.
    nativeUrl: (id) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id ?? "") ? `codex://threads/${id}` : null,
  },
};

export function nativeSessionUrl(rec) {
  if ((rec.argv ?? []).some((a) => a === "--remote" || a.startsWith("--remote="))) return null;
  return AGENTS[rec.agent]?.nativeUrl?.(rec.session) ?? null;
}

const base = (p) => String(p ?? "").split("/").pop();

// Only registered providers can identify a process; future agents add their own matcher.
export const agentKind = (argv) => Object.entries(AGENTS).find(([, how]) => how.matches?.(base(argv?.[0])))?.[0] ?? null;

// The argv that resumes rec ({ agent, session, argv }) as it was started: its flags, minus
// what picked its session and any prompt or subcommand; `prompt` becomes its first message.
export function resumeArgv(rec, prompt = null) {
  const how = AGENTS[rec.agent];
  if (!how) throw new Error(`No session adapter is registered for ${rec.agent}.`);
  const args = (rec.argv ?? [rec.agent]).slice(1);
  const flags = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const [name] = a.split("=");
    if (how.dropped.has(name)) { if (how.droppedValued.has(name) && !a.includes("=")) i++; continue; }
    if (!a.startsWith("-")) continue;
    flags.push(a);
    if (how.valued.has(name) && !a.includes("=") && i + 1 < args.length) flags.push(args[++i]);
  }
  return how.resume(rec.argv?.[0] ?? rec.agent, flags, rec.session, prompt);
}

// Shared by hm, saved-session views and outside-session views. A result is a
// fresh preflight, not a lease: Codex's native writer lock still arbitrates races.
// Never pass a prompt during handoff. Fork is a separate, explicit user action.
export async function inspectSession(rec, owner = "spaces-plus") {
  if (!AGENTS[rec.agent]) return { state: "unsupported", reason: `No session adapter is registered for ${rec.agent}.` };
  if ((rec.argv ?? []).some((a) => a === "--remote" || a.startsWith("--remote=")))
    return { state: "unsupported", reason: "Remote session ownership cannot be checked locally." };
  try {
    const r = await exec("python3", ["-I", `${appHome()}/mods/${owner}/session_handoff.py`,
      JSON.stringify({ agent: rec.agent, session: rec.session })]);
    if (r.code !== 0) throw new Error(r.stderr?.trim() || "Session ownership check failed.");
    const result = JSON.parse(r.stdout);
    if (result.agent !== rec.agent || result.session !== rec.session) throw new Error("Session ownership response did not match the request.");
    return result;
  } catch (error) { return { state: "unknown", reason: String(error.message ?? error) }; }
}

function requireResumable(rec, result) {
  if (result.state !== "ready") throw new Error(result.reason || "Session ownership is not confirmed.");
  if (rec.cwd && (!result.cwd || result.cwd !== rec.cwd))
    throw new Error("This session's folder changed or could not be verified. Refresh sessions first.");
  return result;
}

export async function assertResumable(rec, owner = "spaces-plus") {
  return requireResumable(rec, await inspectSession(rec, owner));
}

// A terminal can stay live after its agent exits to a shell. Foreground argv
// takes precedence when available; otherwise use the host's current program.
export function liveSessionTerminal(rec, live = shared("wt.live") ?? {}, current = terminals()) {
  const address = live[rec.session];
  if (!address || !AGENTS[rec.agent]) return null;
  const term = current.find(term => term.address === address && term.state === "live");
  if (!term) return null;
  const argv = term.foreground?.argv;
  const provider = Array.isArray(argv) && argv.length
    ? agentKind(argv) : term.program?.agent ? term.program.key : null;
  return provider === rec.agent ? address : null;
}

export function focusSession(rec) {
  const address = liveSessionTerminal(rec);
  if (!address) return false;
  run("pane.focus", { terminal: address });
  return true;
}

// Shared across mod bundles. This reservation covers an in-flight check and the
// launch gap, not ownership in another app. Native writer locks arbitrate races.
export async function resumeSession(rec, launch, owner = "spaces-plus") {
  if (focusSession(rec)) return;
  const key = `${rec.agent}:${rec.session}`, now = Date.now();
  const pending = shared("sessions.pending-resumes") ?? {};
  if ((pending[key] ?? 0) > now) throw new Error("This session is already being opened in Herdr.");
  let until = now + 15000;
  setShared("sessions.pending-resumes", { ...Object.fromEntries(Object.entries(pending).filter(([, until]) => until > now)), [key]: until });
  const release = () => {
    const current = { ...(shared("sessions.pending-resumes") ?? {}) };
    if (current[key] === until) { delete current[key]; setShared("sessions.pending-resumes", current); }
  };
  try {
    const result = await inspectSession(rec, owner);
    // Another entry point can attach while the probe is running, even when the
    // helper reports an active writer. Focus wins over both refusal and launch.
    if (focusSession(rec)) { release(); return; }
    requireResumable(rec, result);
    if (shared("sessions.pending-resumes")?.[key] !== until) throw new Error("A newer session open request superseded this one.");
    until = Date.now() + 15000;
    setShared("sessions.pending-resumes", { ...(shared("sessions.pending-resumes") ?? {}), [key]: until });
    return await launch(resumeArgv(rec));
  } catch (error) { release(); throw error; }
}

// Claude publishes a PID registry. Codex's daemon client may not open a rollout;
// use the helper's conservative full-title/cwd match when process ownership is absent.
// owner is the calling mod (helpers are copied per bundle, no dependency on restore).
export async function sessionOf(kind, pid, term = null, owner = "wt-restore") {
  if (kind === "claude") {
    try { return JSON.parse((await readTextFile(`${home()}/.claude/sessions/${pid}.json`)) ?? "null")?.sessionId ?? null; } catch { return null; }
  }
  try {
    const r = await exec("python3", ["-I", `${appHome()}/mods/${owner}/codex_live.py`,
      JSON.stringify({ pid, cwd: term?.foreground?.cwd || term?.cwd, title: term?.title, argv: term?.foreground?.argv })]);
    return r.code === 0 ? JSON.parse(r.stdout)?.session ?? null : null;
  } catch { return null; }
}

// Whether the shown layout runs a mod (a command to it reaches only a shown copy).
export function runs(layoutTree, mod) {
  const walk = (n) => Boolean(n) && typeof n === "object" && ((n.content?.mod === mod) || (n.mod === mod) || Object.values(n).some((v) => (Array.isArray(v) ? v.some(walk) : typeof v === "object" && walk(v))));
  return walk(layoutTree);
}
