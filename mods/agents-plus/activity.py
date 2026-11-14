#!/usr/bin/env python3
"""What each agent terminal is doing now, and the first line of what it last said, read from
its own session record, for the agents-plus mod.

    activity.py '<json [{"address": "t9"}, ...]>'

Prints one JSON object: { "<address>": { "doing": str | null, "said": str | null } }.
- doing: the tool call it's in the middle of ("Editing main.py", "Running npm test"); between
  calls, the last thing it said this turn (its own word for what it's on), else its last
  step and "thinking…"; null once it has answered.
  While it waits on the person, that pending call is what it asks to run.
- said: the first line of its last answer.

Which session a terminal runs: Herdr's restore record (~/.herdr/restore/last.json, kept by
wt-restore), else the terminal's program (hc get): Claude Code names it in
~/.claude/sessions/<pid>.json; Codex uses an open rollout or a unique full title/cwd
match to a live daemon session. Records are read from
their end only, and a record that hasn't changed since the last run isn't read again
(~/.herdr/activity-cache.json). Everything stays on this computer; only short lines come out.
"""

import json
import os
import re
import subprocess
import sys

# Where Claude Code and Codex keep their records, and reading them: lib/agentfiles.py (copied
# beside this file by install.sh; from the repo, ../../lib).
sys.path[:0] = [os.path.dirname(os.path.abspath(__file__)), os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "lib")]
from agentfiles import HERDR_STATE, load, save, json_lines, claude_running, claude_transcript, codex_rollout_of, codex_rollout  # noqa: E402
from codex_live import resolve as codex_live_session  # noqa: E402

CACHE = os.path.join(HERDR_STATE, "activity-cache.json")
RESTORE = os.path.join(HERDR_STATE, "restore", "last.json")
TAIL = 512 * 1024
WIDTH = 90


def line(text):
    """The first line that says something, without markdown marks, at most WIDTH long."""
    for raw in str(text or "").splitlines():
        s = re.sub(r"^[\s#>*\-+`|]+", "", raw).strip()
        s = re.sub(r"[*`_]{1,3}", "", s)
        s = re.sub(r"\s+", " ", s)
        if s:
            return s if len(s) <= WIDTH else s[: WIDTH - 1] + "…"
    return None


def short(s, n=60):
    s = re.sub(r"\s+", " ", str(s or "")).strip()
    return s if len(s) <= n else s[: n - 1] + "…"


def claude_tool(name, args):
    a = args if isinstance(args, dict) else {}
    base = lambda p: os.path.basename(str(p or "").rstrip("/")) or str(p or "")
    if name == "Bash":
        return short(a.get("description")) or f"Running {short(a.get('command'), 50)}"
    if name in ("Edit", "MultiEdit", "Write", "NotebookEdit"):
        return f"Editing {base(a.get('file_path') or a.get('notebook_path'))}"
    if name == "Read":
        return f"Reading {base(a.get('file_path'))}"
    if name == "Grep":
        return f"Searching for {short(a.get('pattern'), 40)}"
    if name == "Glob":
        return f"Finding {short(a.get('pattern'), 40)}"
    if name in ("Task", "Agent"):
        return f"Agent: {short(a.get('description') or a.get('prompt'), 50)}"
    if name == "WebFetch":
        return f"Fetching {short(re.sub(r'^https?://', '', str(a.get('url') or '')).split('/')[0], 40)}"
    if name == "WebSearch":
        return f"Searching the web: {short(a.get('query'), 40)}"
    if name == "TodoWrite":
        return "Updating its plan"
    if name == "AskUserQuestion":
        return "Asking you a question"
    if name == "ExitPlanMode":
        return "Proposing a plan"
    if name == "Skill":
        return f"Using the {short(a.get('skill'), 30)} skill"
    return short(name, 40)


def codex_tool(name, args):
    try:
        a = json.loads(args) if isinstance(args, str) else (args or {})
    except ValueError:
        a = {}
    if name in ("shell", "local_shell", "container.exec"):
        cmd = a.get("command") or []
        if isinstance(cmd, list) and len(cmd) >= 3 and cmd[0].endswith(("bash", "sh", "zsh")) and cmd[1] in ("-lc", "-c"):
            cmd = cmd[2]
        return f"Running {short(' '.join(cmd) if isinstance(cmd, list) else cmd, 50)}"
    if name == "exec_command":
        return f"Running {short(a.get('cmd'), 50)}"
    if name == "apply_patch":
        return "Editing files"
    if name == "update_plan":
        return "Updating its plan"
    return short(name, 40)


def tail(path):
    return list(json_lines(path, tail=TAIL))


def between(pending, last, words, step):
    """What it's doing: the call it's in; between calls, what it last said this turn (its own
    word for what it's on), else its last step and that it's thinking; null once answered."""
    if pending:
        return list(pending.values())[-1]
    if last not in ("person", "tool"):
        return None
    return words or (f"{step} · thinking…" if step else "Thinking…")


def read_claude(path):
    pending, said, last, words, step = {}, None, None, None, None
    for o in tail(path):
        if o.get("isSidechain") or o.get("isMeta"):
            continue
        kind, m = o.get("type"), o.get("message") or {}
        content = m.get("content")
        if kind == "assistant" and isinstance(content, list):
            for c in content:
                if c.get("type") == "tool_use":
                    pending[c.get("id")] = step = claude_tool(c.get("name"), c.get("input"))
                elif c.get("type") == "text" and line(c.get("text")):
                    said = words = line(c.get("text"))
            last = "assistant"
        elif kind == "user":
            items = content if isinstance(content, list) else [{"type": "text", "text": content}]
            results = [c for c in items if isinstance(c, dict) and c.get("type") == "tool_result"]
            for c in results:
                pending.pop(c.get("tool_use_id"), None)
            if results:
                last = "tool"
            if not results and any(isinstance(c, dict) and c.get("type") == "text" and line(c.get("text")) for c in items):
                pending, last, words, step = {}, "person", None, None
    return {"doing": between(pending, last, words, step), "said": said}


def read_codex(path):
    pending, said, last, words, step = {}, None, None, None, None
    for o in tail(path):
        p = o.get("payload") or {}
        kind = p.get("type")
        if o.get("type") != "response_item":
            continue
        if kind in ("function_call", "custom_tool_call", "local_shell_call"):
            pending[p.get("call_id") or p.get("id")] = step = codex_tool(p.get("name") or "shell", p.get("arguments") or p.get("input") or p.get("action"))
            last = "agent"
        elif kind in ("function_call_output", "custom_tool_call_output"):
            pending.pop(p.get("call_id"), None)
            last = "tool"
        elif kind == "message":
            text = " ".join(c.get("text", "") for c in (p.get("content") or []) if isinstance(c, dict))
            if p.get("role") == "assistant" and line(text):
                said = words = line(text)
                last = "agent"
            elif p.get("role") == "user" and line(text) and not text.lstrip().startswith("<"):
                pending, last, words, step = {}, "person", None, None
    return {"doing": between(pending, last, words, step), "said": said}


def session_of(address, restore, known):
    """{ agent, session, cwd, path? } for a terminal, or None."""
    r = (restore.get("sessions") or {}).get(address)
    if r and r.get("session"):
        return {"agent": r.get("agent"), "session": r["session"], "cwd": r.get("cwd")}
    k = known.get(address)
    try:
        t = json.loads(subprocess.run(["hc", "get", address, "--json"], capture_output=True, text=True, timeout=5).stdout or "{}")
    except (OSError, ValueError, subprocess.SubprocessError):
        return k
    fg = t.get("foreground") or {}
    pid, argv0 = fg.get("pid"), os.path.basename(str((fg.get("argv") or [""])[0]))
    if not pid:
        return k
    if k and k.get("pid") == pid and not argv0.startswith("codex"):
        return k
    if argv0.startswith("claude"):
        s = claude_running(pid)
        return {"pid": pid, "agent": "claude", "session": s.get("sessionId"), "cwd": s.get("cwd")} if s.get("sessionId") else None
    if argv0.startswith("codex"):
        live = codex_live_session(pid, fg.get("cwd") or t.get("cwd"), t.get("title"), fg.get("argv"))
        return {"pid": pid, "agent": "codex", "session": live["session"], "cwd": fg.get("cwd") or t.get("cwd")} if live else None
    return None


def record_path(s):
    if s.get("path"):
        return s["path"]
    sid = s.get("session")
    if not sid:
        return None
    return claude_transcript(sid, s.get("cwd")) if s.get("agent") == "claude" else codex_rollout(sid)


def main(argv):
    try:
        wanted = json.loads(argv[0]) if argv else []
    except ValueError:
        wanted = []
    cache = load(CACHE, {}) or {}
    known, files = cache.get("map") or {}, cache.get("files") or {}
    restore = load(RESTORE, {}) or {}
    out, new_map, new_files = {}, {}, {}
    for w in wanted:
        address = w.get("address")
        s = session_of(address, restore, known)
        path = s and record_path(s)
        if not path or not os.path.exists(path):
            continue
        new_map[address] = {**s, "path": path}
        st = os.stat(path)
        old = files.get(path)
        if old and old.get("mtime") == st.st_mtime and old.get("size") == st.st_size:
            found = old["found"]
        else:
            try:
                found = read_claude(path) if s.get("agent") == "claude" else read_codex(path)
            except (OSError, ValueError):
                continue
        new_files[path] = {"mtime": st.st_mtime, "size": st.st_size, "found": found}
        out[address] = found
    save(CACHE, {"map": new_map, "files": new_files})
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
