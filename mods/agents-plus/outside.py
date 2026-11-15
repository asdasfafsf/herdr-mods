#!/usr/bin/env python3
"""Coding agents running outside Herdr (any app: Orca, iTerm, VS Code, a terminal), for agents-plus.

    outside.py

Prints JSON: [{ agent: "claude" | "codex", pid, session, cwd, title, status: "working" | "idle",
                argv, app, bundle }], newest first.

- Claude Code: every running claude keeps ~/.claude/sessions/<pid>.json (its session id, folder,
  name, status: busy / shell / idle). Those whose process is alive count.
- Codex: a TUI's open rollout or interactive parent sessions held by a server, excluding
  internal subagents and sessions already recorded in Herdr. Recorded desktop/editor/CLI
  origin is separate from ownership: "Codex server" does not identify the displaying UI.
Left out: agents under herdr-core (Herdr shows those itself) and Claude's desktop app's own.
`app` is the terminal the agent runs in (TERM_PROGRAM, else the app bundle), `bundle` its
bundle id, to bring that app forward. Reads files and `ps`/`lsof` only; which rollout a Codex
process has open is refreshed each poll because one TUI can switch sessions.
"""

import json
import os
import re
import subprocess
import sys

# Where Claude Code and Codex keep their records, and reading them: lib/agentfiles.py (copied
# beside this file by install.sh; from the repo, ../../lib).
sys.path[:0] = [os.path.dirname(os.path.abspath(__file__)), os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "lib")]
from agentfiles import HERDR_STATE, load, save, json_lines, claude_registry, codex_rollout_of, codex_session_id, codex_names, codex_metadata  # noqa: E402
from agentfiles import codex_session_meta, codex_session_kind


def out(*args):
    return subprocess.run(args, capture_output=True, text=True).stdout


def processes():
    """pid -> (ppid, command name) for every process, from one ps."""
    table = {}
    for line in out("ps", "-axo", "pid=,ppid=,comm=").splitlines():
        parts = line.split(None, 2)
        if len(parts) == 3:
            table[int(parts[0])] = (int(parts[1]), os.path.basename(parts[2]))
    return table


def ancestry(pid, table):
    names = []
    for _ in range(12):
        if pid not in table:
            break
        pid, name = table[pid]
        names.append(name)
        if pid <= 1:
            break
    return names


def environment(pids):
    """pid -> {TERM_PROGRAM, __CFBundleIdentifier} from one ps eww."""
    env = {}
    if not pids:
        return env
    for line in out("ps", "eww", "-o", "pid=,command=", "-p", ",".join(map(str, pids))).splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) < 2:
            continue
        e = {}
        for key in ("TERM_PROGRAM", "__CFBundleIdentifier"):
            m = re.search(rf"(?:^|\s){key}=(\S+)", parts[1])
            if m:
                e[key] = m.group(1)
        env[int(parts[0])] = e
    return env


def argvs(pids):
    """Each pid's command line, from one ps for all of them."""
    found = {}
    if not pids:
        return found
    for line in out("ps", "-o", "pid=,args=", "-p", ",".join(map(str, pids))).splitlines():
        parts = line.strip().split()
        if parts and parts[0].isdigit():
            found[int(parts[0])] = parts[1:]
    return found


# Process metadata is cached between runs: { "rollout": { pid: latest open rollout },
# "proc": { pid: { comm, app, bundle, argv } } }. Rollouts are refreshed every poll;
# app/environment metadata is read only for newly seen (or reused) process IDs.
CACHE = os.path.join(HERDR_STATE, "outside-cache.json")


def load_cache():
    c = load(CACHE, {})
    try:
        return {k: {int(pid): v for pid, v in (c.get(k) or {}).items()} for k in ("rollout", "proc")}
    except (AttributeError, ValueError):
        return {"rollout": {}, "proc": {}}


def save_cache(cache):
    save(CACHE, cache)


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def codex_sessions(table, cache):
    names = codex_names()
    index = codex_metadata()
    represented = {r.get("session") for r in (load(os.path.join(HERDR_STATE, "restore", "last.json"), {}).get("sessions") or {}).values()}
    found = []
    for pid, (_ppid, name) in table.items():
        if name != "codex":
            continue
        command = out("ps", "-p", str(pid), "-o", "args=")
        if re.search(r"\bapp-server\b", command):
            # One daemon may own many sessions. Do not pretend its first rollout
            # is a single outside TUI, or include Herdr's own recorded sessions.
            opened = out("lsof", "-a", "-p", str(pid), "-Fn")
            ids = set(re.findall(r"/thread-writer-locks/([0-9a-f-]{36})\.lock$", opened, re.M))
            for sid in ids - represented:
                rec = index.get(sid)
                if not rec or rec.get("archived"):
                    continue
                path = rec.get("rollout_path")
                if not path or not os.path.isfile(path):
                    continue
                origin = codex_session_kind(rec, codex_session_meta(path))
                if origin not in ("cli", "desktop", "editor"):
                    continue
                state = "idle"
                for item in json_lines(path, tail=512 * 1024):
                    payload = item.get("payload") or {}
                    if item.get("type") == "event_msg":
                        if payload.get("type") == "task_started": state = "working"
                        elif payload.get("type") in ("task_complete", "task_completed", "turn_aborted"): state = "idle"
                found.append({"agent": "codex", "pid": pid, "session": sid, "cwd": rec["cwd"],
                              "title": names.get(sid) or rec.get("name") or rec["title"],
                              "status": state, "updated": rec["updated_at"], "_daemon": True,
                              "argv": ["codex"], "app": "Codex server", "bundle": None, "origin": origin})
            continue
        cache[pid] = codex_rollout_of(pid)
        path = cache[pid]
        if not path or not os.path.exists(path):
            continue
        sid = codex_session_id(path)
        if not sid:
            continue
        origin = codex_session_kind(index.get(sid), codex_session_meta(path))
        if origin not in ("cli", "desktop", "editor"):
            continue
        cwd, state = None, "idle"
        for o in json_lines(path, tail=512 * 1024):
            p = o.get("payload") or {}
            if o.get("type") in ("session_meta", "turn_context") and p.get("cwd"):
                cwd = p["cwd"]
            if o.get("type") == "event_msg" and p.get("type") == "task_started":
                state = "working"
            if o.get("type") == "event_msg" and p.get("type") in ("task_complete", "task_completed", "turn_aborted"):
                state = "idle"
        cwd = cwd or out("lsof", "-a", "-p", str(pid), "-d", "cwd", "-Fn").splitlines()[-1][1:]
        found.append({"agent": "codex", "pid": pid, "session": sid, "cwd": cwd, "title": names.get(sid) or os.path.basename(cwd),
                      "status": state, "updated": int(os.path.getmtime(path)), "origin": origin})
    return found


def main():
    table = processes()
    kept = load_cache()
    cache = {pid: path for pid, path in kept["rollout"].items() if pid in table}
    procs = {pid: v for pid, v in kept["proc"].items() if pid in table and v.get("comm") == table[pid][1]}
    found = []
    for pid, d in claude_registry():
        if not alive(pid) or not d.get("sessionId"):
            continue
        found.append({"agent": "claude", "pid": pid, "session": d["sessionId"], "cwd": d.get("cwd") or "", "title": d.get("name") or os.path.basename(d.get("cwd") or ""),
                      "status": "idle" if d.get("status") == "idle" else "working", "updated": int((d.get("statusUpdatedAt") or d.get("updatedAt") or 0) / 1000)})
    found += codex_sessions(table, cache)
    keep = []
    for x in found:
        chain = ancestry(x["pid"], table)
        if not x.get("_daemon") and any("herdr" in n for n in chain):  # Herdr's own TUI
            continue
        if "Claude" in chain or "disclaimer" in chain:  # Claude's desktop app's own sessions
            continue
        keep.append(x)
    new = [x["pid"] for x in keep if x["pid"] not in procs and not x.get("_daemon")]
    env, lines = environment(new), argvs(new)
    for pid in new:
        e = env.get(pid, {})
        procs[pid] = {"comm": table[pid][1] if pid in table else None,
                      "app": e.get("TERM_PROGRAM") or (e.get("__CFBundleIdentifier") or "").split(".")[-1] or "another app",
                      "bundle": e.get("__CFBundleIdentifier"), "argv": lines.get(pid)}
    for x in keep:
        if x.pop("_daemon", False):
            continue
        p = procs.get(x["pid"], {})
        x["app"], x["bundle"], x["argv"] = p.get("app") or "another app", p.get("bundle"), p.get("argv") or [x["agent"]]
    save_cache({"rollout": cache, "proc": {pid: v for pid, v in procs.items() if any(x["pid"] == pid for x in keep)}})
    keep.sort(key=lambda x: x["updated"], reverse=True)
    print(json.dumps(keep, ensure_ascii=False))


if __name__ == "__main__":
    main()
