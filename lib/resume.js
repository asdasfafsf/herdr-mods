// resume.js (herdr-mods lib): how a Claude Code or Codex session is found from a running
// process, and how it is started again. One copy here; install.sh puts it beside every mod
// that imports "./resume.js" (spaces-plus, wt-restore, agents-plus), since a mod can't
// import another mod's files. Change it here, then run install.sh.

import { exec, readTextFile, home, appHome } from "herdr";
// Python dependency copied beside this module by install.sh: "./codex_live.py".

// Per agent: its name and icon, the flags that take a value (kept with it when the agent is
// started again), the flags that pick a session (dropped: resuming picks it), and how it
// resumes a session, with an optional first message. Anything else that isn't a flag (a
// first prompt, a subcommand) is left out. fork: a new session from that one.
export const AGENTS = {
  claude: {
    name: "Claude Code",
    icon: "icons/claude.svg",
    valued: new Set(["--model", "--permission-mode", "--add-dir", "--agent", "--agents", "--settings", "--setting-sources", "--mcp-config", "--allowedTools", "--allowed-tools", "--disallowedTools", "--disallowed-tools", "--append-system-prompt", "--system-prompt", "--effort", "--fallback-model", "--plugin-dir"]),
    dropped: new Set(["--resume", "-r", "--continue", "-c", "--session-id", "--fork-session", "-p", "--print"]),
    droppedValued: new Set(["--resume", "-r", "--session-id"]),
    resume: (argv0, flags, id, prompt) => [argv0, ...flags, "--resume", id, ...(prompt ? [prompt] : [])],
    fork: (argv0, flags, id) => [argv0, ...flags, "--resume", id, "--fork-session"],
  },
  codex: {
    name: "Codex",
    icon: "icons/codex.svg",
    valued: new Set(["--model", "-m", "--sandbox", "-s", "--ask-for-approval", "-a", "--profile", "-p", "--cd", "-C", "-c", "--config", "--add-dir", "--image", "-i", "--local-provider", "--enable", "--disable", "--remote", "--remote-auth-token-env"]),
    dropped: new Set(["--last"]),
    droppedValued: new Set(),
    resume: (argv0, flags, id, prompt) => [argv0, "resume", ...flags, id, ...(prompt ? [prompt] : [])],
    fork: (argv0, flags, id) => [argv0, "fork", ...flags, id],
  },
};

const base = (p) => String(p ?? "").split("/").pop();

// Which agent an argv runs: "claude", "codex" or null.
export const agentKind = (argv) => (/^claude/.test(base(argv?.[0])) ? "claude" : /^codex/.test(base(argv?.[0])) ? "codex" : null);

// The argv that resumes rec ({ agent, session, argv }) as it was started: its flags, minus
// what picked its session and any prompt or subcommand; `prompt` becomes its first message.
export function resumeArgv(rec, prompt = null) {
  const how = AGENTS[rec.agent];
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
