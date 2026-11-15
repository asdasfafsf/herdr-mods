#!/usr/bin/env python3
"""Recent, resumable local Claude/Codex history, including sessions made outside Herdr.

Reads only metadata, bounded transcript excerpts and process ownership. No CLI is
launched and no session files are changed. `check JSON` rechecks a row before resume.
"""
import glob
import heapq
import json
import math
import os
import re
import subprocess
import sys

sys.path[:0] = [os.path.dirname(os.path.abspath(__file__)),
                os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "lib")]
from agentfiles import (CLAUDE_PROJECTS, CODEX_SESSIONS, claude_registry,
                        claude_transcript, codex_metadata, codex_names,
                        codex_session_id, json_lines, prompt_title, text_of)

LIMIT = 60
CANDIDATES = 300  # Per provider; never parse the full transcript history on a timer.
EXCERPT = 64 * 1024
UUID = re.compile(r"^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$")


def objects(path, **bounds):
    try:
        yield from (item for item in json_lines(path, **bounds) if isinstance(item, dict))
    except OSError:
        return  # Deleted or unreadable between discovery and reading.


def modified(path):
    try:
        return os.path.getmtime(path)
    except OSError:
        return 0


def newest(paths):
    return heapq.nlargest(CANDIDATES, paths, key=modified)


def live_sessions():
    """Batch ownership check, including Herdr and shared Codex servers.

    Unknown provider ownership is reported, never silently treated as stopped.
    Stale writer files alone are not evidence of a running process.
    """
    live, errors = set(), {}
    try:
        for pid, record in claude_registry():
            try:
                pid = int(pid)
                if not 0 < pid < 2**31:
                    raise ValueError("invalid PID")
                os.kill(pid, 0)
            except ProcessLookupError:
                continue
            except (PermissionError, ValueError, TypeError):
                errors["claude"] = "Could not check running Claude sessions."
                continue
            sid = record.get("sessionId")
            if sid:
                if isinstance(sid, str) and UUID.fullmatch(sid):
                    live.add(("claude", sid))
                else:
                    errors["claude"] = "Could not check running Claude sessions."
    except OSError:
        errors["claude"] = "Could not check running Claude sessions."
    try:
        result = subprocess.run(["lsof", "-n", "-P", "-c", "codex", "-Fn"],
                                capture_output=True, text=True, timeout=5)
        if result.returncode not in (0, 1) or result.stderr.strip():
            raise OSError("incomplete process lookup")
        for line in result.stdout.splitlines():
            if not line.startswith("n/"):
                continue
            path = line[1:]
            sid = (os.path.basename(path)[:-5] if "/thread-writer-locks/" in path
                   and path.endswith(".lock") else codex_session_id(path))
            if sid and UUID.fullmatch(sid):
                live.add(("codex", sid))
    except (OSError, subprocess.SubprocessError):
        errors["codex"] = "Could not check running Codex sessions."
    return live, errors


def row(agent, sid, cwd, title, updated):
    if not isinstance(sid, str) or not UUID.fullmatch(sid):
        return None
    if not isinstance(cwd, str) or not os.path.isabs(cwd) or re.search(r"[\x00-\x1f\x7f]", cwd) or not os.path.isdir(cwd):
        return None  # A removed checkout cannot be resumed there.
    title = prompt_title(title)
    if not title:
        return None
    if not isinstance(updated, (int, float)) or not math.isfinite(updated) or updated < 0:
        return None
    title = re.sub(r"[\x00-\x1f\x7f]", " ", title)
    return {"agent": agent, "session": sid, "cwd": cwd, "title": title,
            "updated": updated}


def claude_rows(paths=None):
    if paths is None:
        paths = newest(glob.iglob(os.path.join(CLAUDE_PROJECTS, "*", "*.jsonl")))
    for path in paths:
        sid = os.path.basename(path)[:-6]
        if not UUID.fullmatch(sid):
            continue  # Legacy agent-*.jsonl files and internal subagents.
        cwd, first, title, sidechain = None, None, None, False
        for item in objects(path, size=EXCERPT):
            cwd = cwd or item.get("cwd")
            if item.get("type") == "user":
                sidechain = bool(item.get("isSidechain"))
                if sidechain:
                    break
                message = item.get("message") or {}
                if isinstance(message, dict):
                    first = first or prompt_title(text_of(message.get("content")))
            if cwd and first:
                break
        if sidechain:
            continue
        for item in objects(path, tail=EXCERPT):
            if item.get("type") == "ai-title":
                title = item.get("aiTitle") or title
            elif item.get("type") == "custom-title":
                title = item.get("customTitle") or title
        found = row("claude", sid, cwd, title or first, modified(path))
        if found:
            yield found


def codex_rows(paths=None, index=None):
    names = codex_names(tail=EXCERPT)
    index = codex_metadata(limit=CANDIDATES) if index is None else index
    # The current index gives rename/resume --cd precedence over the original header.
    if paths is None:
        records = [record for record in index.values() if not record.get("archived")
                   and record.get("source") in (None, "cli")]
        indexed_paths = [record["rollout_path"] for record in records if isinstance(record.get("rollout_path"), str)]
        # Old CLI versions may have no SQLite index. This enumerates file names,
        # but parses at most CANDIDATES transcripts and bounded excerpts of each.
        legacy = glob.iglob(os.path.join(CODEX_SESSIONS, "*", "*", "*", "*.jsonl"))
        times = {record["rollout_path"]: record.get("updated_at") for record in records
                 if isinstance(record.get("rollout_path"), str)}
        def recency(path):
            value = times.get(path)
            return value if isinstance(value, (int, float)) and math.isfinite(value) else modified(path)
        paths = heapq.nlargest(CANDIDATES, set(indexed_paths + newest(legacy)), key=recency)
        # The limited recent query need not contain an older archived/renamed
        # legacy candidate. Resolve just those IDs before applying source rules.
        index.update(codex_metadata(sessions=[sid for path in paths
                                             if (sid := codex_session_id(path))]))
    for path in dict.fromkeys(paths):
        if not os.path.isfile(path):
            continue
        meta, first = None, None
        for item in objects(path, size=EXCERPT):
            payload = item.get("payload") or {}
            if not isinstance(payload, dict):
                continue
            if item.get("type") == "session_meta" and meta is None:
                meta = payload  # A fork's copied original header is not its identity.
            if item.get("type") == "response_item" and payload.get("role") == "user":
                first = first or prompt_title(text_of(payload.get("content")))
            if meta and first:
                break
        if not meta or meta.get("source") not in (None, "cli"):
            continue
        sid = meta.get("id") or meta.get("session_id")
        if not isinstance(sid, str) or not UUID.fullmatch(sid):
            continue
        current = index.get(sid, {})
        if current.get("archived") or current.get("source") not in (None, "cli"):
            continue
        found = row("codex", sid, current.get("cwd") or meta.get("cwd"),
                    names.get(sid) or current.get("name") or first or current.get("title"),
                    current.get("updated_at") or modified(path))
        if found:
            yield found


def recent():
    live, errors = live_sessions()
    rows = []
    for agent, discover in (("claude", claude_rows), ("codex", codex_rows)):
        if agent in errors:
            continue
        try:
            rows.extend(discover())
        except (OSError, ValueError, TypeError):
            errors[agent] = f"Could not read saved {agent} sessions."
    unique = {}
    for item in sorted(rows, key=lambda item: item["updated"], reverse=True):
        key = (item["agent"], item["session"])
        if key not in live:
            unique.setdefault(key, item)
    return {"rows": list(unique.values())[:LIMIT], "errors": list(errors.values())}


def check(record):
    if not isinstance(record, dict):
        raise ValueError("Invalid saved session.")
    agent, sid, cwd = record.get("agent"), record.get("session"), record.get("cwd")
    if agent not in ("claude", "codex") or not isinstance(sid, str) or not UUID.fullmatch(sid):
        raise ValueError("Invalid saved session.")
    if not isinstance(cwd, str) or not os.path.isabs(cwd) or re.search(r"[\x00-\x1f\x7f]", cwd) or not os.path.isdir(cwd):
        raise ValueError("This session's folder no longer exists.")
    index = codex_metadata(sessions=[sid]) if agent == "codex" else {}
    path = claude_transcript(sid, cwd) if agent == "claude" else index.get(sid, {}).get("rollout_path")
    if agent == "codex" and not path:
        path = next(glob.iglob(os.path.join(CODEX_SESSIONS, "*", "*", "*", f"rollout-*{sid}.jsonl")), None)
    if not path or not os.path.isfile(path):
        raise ValueError("This saved session no longer exists.")
    # Re-read identity and folder. Do not let stale UI data silently relocate a
    # conversation, and do not resume an archived/subagent/unsupported source.
    candidates = claude_rows([path]) if agent == "claude" else codex_rows([path], index)
    current = next((item for item in candidates if item["session"] == sid), None)
    if not current:
        raise ValueError("This saved session is no longer available to resume.")
    if current["cwd"] != cwd:
        raise ValueError("This session's folder changed. Refresh saved sessions first.")
    live, errors = live_sessions()
    if agent in errors:
        raise ValueError(errors[agent])
    return {"running": (agent, sid) in live, "record": current}


if __name__ == "__main__":
    try:
        result = check(json.loads(sys.argv[2])) if len(sys.argv) == 3 and sys.argv[1] == "check" else recent()
        print(json.dumps(result, ensure_ascii=False))
    except (OSError, ValueError, TypeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
