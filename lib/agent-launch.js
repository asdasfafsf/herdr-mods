// Defaults for herdr-mods launch paths, not a statement of effective permissions.
// Codex still enforces managed requirements and keeps already-loaded thread state.
// bin/hm has the standalone Python equivalent; shared fixtures test both adapters.
export const CODEX_YOLO = "--dangerously-bypass-approvals-and-sandbox";
export const CODEX_VALUE_FLAGS = new Set(["--model", "-m", "--sandbox", "-s", "--ask-for-approval", "-a", "--profile", "-p", "--cd", "-C", "-c", "--config", "--add-dir", "--image", "-i", "--local-provider", "--enable", "--disable", "--remote", "--remote-auth-token-env", "--permissions", "--permission-profile"]);
const choices = new Set([CODEX_YOLO, "--yolo", "--full-auto", "--approve-for-me", "--sandbox", "-s", "--ask-for-approval", "-a", "--profile", "-p", "--permissions", "--permission-profile", "--add-dir", "--remote", "--remote-auth-token-env"]);
const switches = new Set(["--oss", "--search", "--no-alt-screen", "--no-daemon", "--strict-config", "--dangerously-bypass-hook-trust", "--last", "--all", "--include-non-interactive", "--worktree"]);
const commands = new Set(["agents", "exec", "e", "review", "login", "logout", "mcp", "plugin", "app-server", "remote-control", "app", "completion", "update", "doctor", "sandbox", "debug", "apply", "a", "queue", "archive", "delete", "migrate-rollouts", "migrate-nfs-db", "unarchive", "cloud", "exec-server", "features", "help"]);
const policyKey = (value) => /^(?:approval_policy|approvals?_reviewer|sandbox_mode|sandbox_workspace_write|permissions|network|default_permissions|profile|config_profile(?:_v2)?)(?:\.|$)/.test(String(value).split("=")[0].trim().replace(/["']/g, ""));

export function agentLaunchArgv(agent, argv = [agent]) {
  // Wrapper commands own their options. Never inject a Codex flag into a shell.
  if (agent !== "codex" || !/^codex(?:\.exe)?$/.test(String(argv?.[0]).split("/").pop())) return argv;
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i], name = arg.split("=")[0];
    if (arg === "--") break; // Everything after this is positional data.
    if (choices.has(name) || /^-[sap].+/.test(arg)) return argv;
    const attachedConfig = arg.startsWith("-c") && !arg.startsWith("--") && arg.length > 2;
    if (name === "-c" || name === "--config" || attachedConfig) {
      const value = attachedConfig ? arg.slice(2).replace(/^=/, "") : arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[++i];
      if (value === undefined || policyKey(value)) return argv;
    } else if (CODEX_VALUE_FLAGS.has(name)) {
      if (!arg.includes("=")) { if (++i >= argv.length) return argv; }
    } else if (/^-[mCi].+/.test(arg)) {
      // clap accepts attached short values, e.g. -mMODEL and -C/path.
    } else if (arg.startsWith("-")) {
      if (!switches.has(name)) return argv; // Future/unknown options own their semantics.
    } else if (commands.has(arg)) return argv;
  }
  return [argv[0], CODEX_YOLO, ...argv.slice(1)];
}
