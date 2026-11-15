"""Read-only session handoff adapters. No resume, stop, transcript or database writes.

CLI: session_handoff.py '{"agent":"codex","session":"UUID"}'
API: inspect_session(agent, session) -> {state, reason, origin, capabilities, ...}
States: ready, active, unknown, missing, unsupported. Only ready permits a new
local client; an already represented Herdr terminal should be focused first.

Add an adapter to PROVIDERS for a new agent and its launch flags to resume.js.
Never infer support from an executable name or silently fall back to a new chat.
"""
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from agentfiles import (CODEX_HOME, CLAUDE_SESSIONS, claude_registry, claude_transcript,
                        codex_metadata, codex_rollout, codex_session_meta, codex_session_kind)


def open_pids(paths):
    """No open handle is safe only when lsof completed without diagnostics."""
    pids = set()
    for path in paths:
        if not os.path.isfile(path):
            continue
        result = subprocess.run(["lsof", "-t", path], capture_output=True, text=True, timeout=3)
        if result.returncode not in (0, 1) or result.stderr.strip():
            raise RuntimeError("Could not verify session ownership")
        values = result.stdout.split()
        if any(not value.isdigit() for value in values):
            raise RuntimeError("Invalid session ownership response")
        pids.update(map(int, values))
    return sorted(pids)


def codex_inspect(session):
    record = codex_metadata(session).get(session, {})
    path = record.get("rollout_path") or codex_rollout(session)
    meta = codex_session_meta(path) if path else {}
    if not record and not meta:
        return {"state": "missing", "reason": "Codex session was not found in this CODEX_HOME."}
    origin = codex_session_kind(record, meta)
    if origin in ("subagent", "exec", "unknown"):
        return {"state": "unsupported", "origin": origin,
                "reason": "This is not a recognized interactive parent session."}
    if record.get("archived"):
        return {"state": "unsupported", "origin": origin, "reason": "Unarchive this session in Codex first."}
    if not path or not os.path.isfile(path):
        return {"state": "missing", "origin": origin, "reason": "The saved session metadata file is unavailable."}
    pids = open_pids([os.path.join(CODEX_HOME, "thread-writer-locks", session + ".lock"), path])
    return {"state": "active" if pids else "ready", "origin": origin, "pids": pids,
            "cwd": record.get("cwd") or meta.get("cwd"),
            "reason": "Release this session in its current Codex client before resuming here. Idle does not mean released." if pids else None}


def claude_inspect(session):
    if not claude_transcript(session):
        return {"state": "missing", "reason": "Claude Code transcript was not found."}
    if not os.path.isdir(CLAUDE_SESSIONS):
        return {"state": "unknown", "reason": "Claude Code process registry is unavailable."}
    pids = []
    for pid, record in claude_registry():
        if record.get("sessionId") != session:
            continue
        result = subprocess.run(["ps", "-p", str(pid), "-o", "comm="], capture_output=True, text=True, timeout=3)
        if result.returncode not in (0, 1) or result.stderr.strip():
            raise RuntimeError("Could not verify Claude Code ownership")
        if os.path.basename(result.stdout.strip()).startswith("claude"):
            pids.append(pid)
    return {"state": "active" if pids else "ready", "origin": "cli", "pids": pids,
            "reason": "Exit the existing Claude Code session before resuming here." if pids else None}


# Capabilities describe supported integration, not feature guesses for future agents.
PROVIDERS = {
    "codex": {"inspect": codex_inspect, "capabilities": {"resumeSameId": True, "fork": True,
              "desktopHistory": True, "automaticHandoff": False, "writerGuard": "native-lock"}},
    "claude": {"inspect": claude_inspect, "capabilities": {"resumeSameId": True, "fork": True,
               "desktopHistory": False, "automaticHandoff": False, "writerGuard": "process-registry"}},
}


def inspect_session(agent, session):
    provider = PROVIDERS.get(agent) if isinstance(agent, str) else None
    result = {"agent": agent, "session": session, "capabilities": provider["capabilities"] if provider else {}}
    if provider is None:
        return {**result, "state": "unsupported", "reason": "No session adapter is registered for this agent."}
    if not isinstance(session, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", session):
        return {**result, "state": "unsupported", "reason": "A concrete session ID is required."}
    try:
        return {**result, **provider["inspect"](session)}
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        return {**result, "state": "unknown", "reason": str(error)}


if __name__ == "__main__":
    request = json.loads(sys.argv[1])
    print(json.dumps(inspect_session(request.get("agent"), request.get("session"))))
