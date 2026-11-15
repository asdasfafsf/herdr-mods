#!/usr/bin/env python3
"""Claude Code and Codex sessions that ran in a folder, for the wt-sessions mod.

    sessions.py list <folder>...           every session whose cwd is a folder or under it
    sessions.py search <query> <folder>... the same, only those whose messages contain query
    sessions.py move <session> <folder> [--from CWD] [--keep]
                                           make one session belong to <folder> (hm resume --into)
    sessions.py copy <session> <folder> [--from CWD]
                                           ready a fork of it in <folder>, the original as it is
                                           (hm resume --into --fork)
    sessions.py drop-copy <copy> <session> <folder> <since ms> [--wait S]
                                           remove copy's Claude copy once the fork opened from it

Prints one JSON array, newest first:
    [{agent: "claude" | "codex", id, cwd, title, updated (unix s), snippet?}]

Where they are:
- Claude Code: ~/.claude/projects/<cwd with every non-alphanumeric as "-">/<id>.jsonl. Names
  collide (each Korean letter is one "-"), so the cwd recorded in the file decides. The title is
  the latest "ai-title" record, else the first prompt typed (not a <command> wrapper).
- Codex: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl ($CODEX_HOME/sessions when that's set; paths
  from lib/agentfiles.py), session_meta id and legacy cwd. The current SQLite index
  overrides cwd/name/update time after native resume --cd or renaming.

list and search only read. Message text goes no further than a title or a search snippet.

move (prints {agent, id, cwd}; refuses a session that is running):
- Claude Code: the transcript is rewritten into <folder>'s project folder with every "cwd" set to
  <folder> and a headless run's entrypoint "sdk-cli" as "cli" (so /resume there lists it). The old file
  (the one in --from's project folder, else wherever it is) is removed unless --keep: hm passes --from
  when it found the session in a checkout, --keep when only a copy outside every checkout has it.
- Codex: active rollout/writer locks block moving. Return deferred=true; hm launches
  native resume --cd <folder>, which owns metadata changes. Do not rewrite its history.

copy (prints {agent, id, cwd, copy}; a running session too, as the original is only read):
- Claude Code: `claude --resume ID` finds a transcript only in the project folder of the folder it
  runs in ("No conversation found" otherwise), so the transcript (--from's, else wherever it is) is
  written into <folder>'s project folder as move writes it, and the original stays byte for byte;
  copy is that new file's path. Then `claude --resume ID --fork-session` in <folder> makes the fork:
  a new id whose records carry cwd <folder>. Already in <folder>'s project folder: nothing is written
  (copy null). A running session's last line, if half written, is left out.
- Codex: nothing is written (copy null). `codex fork --cd <folder> ID` writes a new rollout with a new
  id, cwd <folder> and forked_from_id ID, and leaves the original's rollout and SQLite row as they are.
  Without --cd, run in another folder, it stops to ask which folder: hm always passes it.

drop-copy (prints {removed, fork?, why?}): the copy is removed, not kept, because it has the
original's id: left there, `hm sessions <folder>` and Claude's /resume would list the original as
<folder>'s, and hm resume ID (the newest of that id first) would open that stale copy in <folder>
while the original goes on elsewhere. It may go only after the fork read it: a fork writes nothing
until its first message, then writes the whole history it holds in memory, so after reading it the
copy isn't needed (checked with an 8,000-line transcript removed at once). The sign is Claude's own
record of the process (~/.claude/sessions/<pid>.json): started since <since ms>, cwd <folder>, a new
sessionId, and a status, which it gets only once the transcript is loaded (a resume that finds no
transcript exits without one). A process that ends first gets its copy removed too (no fork read it).
No such process in --wait seconds (60; e.g. a folder-trust prompt not answered yet): the copy stays
and why says so.
Nothing is printed from the messages.
"""

import json
import os
import subprocess
import sys
import time

sys.path[:0] = [os.path.dirname(os.path.abspath(__file__)),  # agentfiles.py, installed beside it
                os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "lib")]  # in the repo
from agentfiles import codex_session_kind
from agentfiles import (  # noqa: E402
    CLAUDE_PROJECTS,
    CODEX_SESSIONS,
    claude_registry,
    claude_transcript,
    codex_names,
    codex_rollout,
    codex_rollouts,
    codex_metadata,
    codex_running,
    json_lines,
    project_dir_name,
)

HEAD = 256 * 1024  # bytes read from the start for the cwd and first prompt
TAIL = 512 * 1024  # bytes read from the end for the latest ai-title


def inside(cwd, folders):
    return any(cwd == f or cwd.startswith(f.rstrip("/") + "/") for f in folders)


def text_of(content):
    """A message's text: a string, or the text parts of a list of blocks."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") in ("text", "input_text", "output_text"))
    return ""


def prompt_title(text):
    """A typed prompt as a title, or None for wrappers (<command-name>, <environment_context>, ...)."""
    text = (text or "").strip()
    if not text or text.startswith("<") or text.startswith("# AGENTS.md"):
        return None
    line = text.splitlines()[0].strip()
    return line[:100]


def snippet(text, query):
    i = text.lower().find(query)
    if i < 0:
        return None
    s = text[max(0, i - 50): i + len(query) + 70].replace("\n", " ").strip()
    return ("…" if i > 50 else "") + s + "…"


def claude(folders, query):
    out = []
    if not os.path.isdir(CLAUDE_PROJECTS):
        return out
    prefixes = [project_dir_name(f) for f in folders]
    for d in os.listdir(CLAUDE_PROJECTS):
        if not any(d == p or d.startswith(p + "-") for p in prefixes):
            continue
        base = os.path.join(CLAUDE_PROJECTS, d)
        for name in os.listdir(base):
            if not name.endswith(".jsonl"):
                continue
            path = os.path.join(base, name)
            cwd, first, found = None, None, None
            for o in json_lines(path, size=HEAD):
                cwd = cwd or o.get("cwd")
                if first is None and o.get("type") == "user" and not o.get("isSidechain"):
                    first = prompt_title(text_of((o.get("message") or {}).get("content")))
                if cwd and first:
                    break
            if not cwd or not inside(cwd, folders):
                continue
            title = None
            for o in json_lines(path, tail=TAIL):
                if o.get("type") == "ai-title" and o.get("aiTitle"):
                    title = o["aiTitle"]
            if query:
                for o in json_lines(path):
                    if o.get("type") in ("user", "assistant"):
                        found = snippet(text_of((o.get("message") or {}).get("content")), query)
                        if found:
                            break
                if not found:
                    continue
            if not (title or first):
                continue  # opened and left without a word
            out.append({"agent": "claude", "id": name[:-6], "cwd": cwd, "title": title or first, "updated": int(os.path.getmtime(path)), **({"snippet": found} if found else {})})
    return out


def codex(folders, query):
    out = []
    if not os.path.isdir(CODEX_SESSIONS):
        return out
    names = codex_names()
    index = codex_metadata()
    for path in codex_rollouts():
        meta, first, found = None, None, None
        for o in json_lines(path, size=HEAD):
            if o.get("type") == "session_meta" and meta is None:
                # The first is this rollout's own: a fork's is followed by the original's, copied.
                meta = o.get("payload") or {}
            p = o.get("payload") or {}
            if first is None and o.get("type") == "response_item" and p.get("type") == "message" and p.get("role") == "user":
                first = prompt_title(text_of(p.get("content")))
            if meta and first:
                break
        sid = (meta or {}).get("id") or (meta or {}).get("session_id")
        current = index.get(sid, {})
        origin = codex_session_kind(current, meta)
        if origin in ("subagent", "exec") or current.get("archived"):
            continue
        if meta and current.get("cwd"):
            meta["cwd"] = current["cwd"]
        if not meta or not meta.get("cwd") or not inside(meta["cwd"], folders):
            continue
        sid = meta.get("id") or meta.get("session_id")
        if query:
            for o in json_lines(path):
                p = o.get("payload") or {}
                if o.get("type") == "response_item" and p.get("type") == "message":
                    found = snippet(text_of(p.get("content")), query)
                    if found:
                        break
            if not found:
                continue
        title = names.get(sid) or current.get("name") or first or current.get("title")
        if not title or not sid:
            continue
        out.append({"agent": "codex", "id": sid, "cwd": meta["cwd"], "title": title, "origin": origin, "updated": current.get("updated_at") or int(os.path.getmtime(path)), **({"snippet": found} if found else {})})
    return out


def rewrite(path, dst, fix):
    """Write `path`'s JSON lines through fix(record) to `dst` (a temp file, then renamed).
    A last line still being written (no newline, not JSON yet) is left out."""
    lines = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            try:
                o = json.loads(line)
            except ValueError:
                if line.endswith("\n"):
                    lines.append(line)
                continue
            lines.append(json.dumps(fix(o) if isinstance(o, dict) else o, ensure_ascii=False) + "\n")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    tmp = dst + ".moving"
    with open(tmp, "w", encoding="utf-8") as f:
        f.writelines(lines)
    os.replace(tmp, dst)


def move(session, folder, src_cwd=None, keep=False):
    folder = os.path.realpath(folder)
    if not os.path.isdir(folder):
        raise SystemExit(f"no folder {folder}")
    src = claude_transcript(session, src_cwd)
    if src:
        if any(d.get("sessionId") == session for _, d in claude_registry()):
            raise SystemExit(f"claude {session} is running: stop it first")

        dst = os.path.join(CLAUDE_PROJECTS, project_dir_name(folder), os.path.basename(src))
        rewrite(src, dst, belonging_to(folder))
        if not keep and os.path.realpath(src) != os.path.realpath(dst):
            os.remove(src)
        return {"agent": "claude", "id": session, "cwd": folder}
    rollout = codex_rollout(session)
    if rollout:
        if codex_running(session):
            raise SystemExit(f"codex {session} is running: stop it first")
        # Codex owns both SQLite metadata and paginated history. Its resume --cd
        # updates the working root; rewriting only JSONL leaves those inconsistent.
        return {"agent": "codex", "id": session, "cwd": folder, "deferred": True}
    raise SystemExit(f"no session {session}")


def belonging_to(folder):
    """A Claude record as if it ran in `folder`: every cwd, and a headless run's entrypoint as cli
    (so /resume there lists it)."""
    def fix(o):
        if "cwd" in o:
            o["cwd"] = folder
        if o.get("entrypoint") == "sdk-cli":
            o["entrypoint"] = "cli"
        return o
    return fix


def copy(session, folder, src_cwd=None):
    folder = os.path.realpath(folder)
    if not os.path.isdir(folder):
        raise SystemExit(f"no folder {folder}")
    src = claude_transcript(session, src_cwd)
    if src:
        dst = os.path.join(CLAUDE_PROJECTS, project_dir_name(folder), os.path.basename(src))
        if os.path.exists(dst):
            # It ran here (src is dst), or a move --keep already put <folder>'s own copy here:
            # Claude resumes that one, and it isn't ours to remove.
            return {"agent": "claude", "id": session, "cwd": folder, "copy": None}
        rewrite(src, dst, belonging_to(folder))
        return {"agent": "claude", "id": session, "cwd": folder, "copy": dst}
    if codex_rollout(session):
        return {"agent": "codex", "id": session, "cwd": folder, "copy": None}
    raise SystemExit(f"no session {session}")


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except PermissionError:
        return True
    except OSError:
        return False


def drop_copy(path, session, folder, since, wait=60):
    folder = os.path.realpath(folder)
    expected = os.path.join(CLAUDE_PROJECTS, project_dir_name(folder), f"{session}.jsonl")
    if os.path.realpath(path) != os.path.realpath(expected):
        raise SystemExit(f"{path} isn't {session}'s copy for {folder}")
    if not os.path.exists(path):
        return {"removed": False, "why": "already gone"}
    seen = set()
    deadline = time.time() + wait
    while time.time() < deadline:
        for pid, d in claude_registry():
            if (d.get("sessionId") in (None, session) or (d.get("startedAt") or 0) < since - 2000
                    or os.path.realpath(d.get("cwd") or "") != folder):
                continue
            seen.add(pid)
            if d.get("status") and alive(pid):
                os.remove(path)
                return {"removed": True, "fork": d["sessionId"]}
        if seen and not any(alive(p) for p in seen):
            os.remove(path)
            return {"removed": True, "why": "claude ended before opening the fork"}
        time.sleep(0.25)
    return {"removed": False, "why": f"no fork opened it in {wait:g} s; remove {path} once it has"}


def main(argv):
    if argv and argv[0] in ("move", "copy"):
        rest = [a for a in argv[1:] if a != "--keep"]
        src_cwd = None
        if "--from" in rest:
            i = rest.index("--from")
            src_cwd = rest[i + 1] if i + 1 < len(rest) else None
            del rest[i : i + 2]
        if len(rest) != 2:
            print(__doc__, file=sys.stderr)
            return 2
        done = move(rest[0], rest[1], src_cwd, keep="--keep" in argv) if argv[0] == "move" else copy(rest[0], rest[1], src_cwd)
        print(json.dumps(done, ensure_ascii=False))
        return 0
    if argv and argv[0] == "drop-copy":
        rest, wait = argv[1:], 60
        if "--wait" in rest:
            i = rest.index("--wait")
            wait = float(rest[i + 1])
            del rest[i : i + 2]
        if len(rest) != 4:
            print(__doc__, file=sys.stderr)
            return 2
        print(json.dumps(drop_copy(rest[0], rest[1], rest[2], int(rest[3]), wait), ensure_ascii=False))
        return 0
    if len(argv) < 2 or argv[0] not in ("list", "search") or (argv[0] == "search" and len(argv) < 3):
        print(__doc__, file=sys.stderr)
        return 2
    query = argv[1].lower() if argv[0] == "search" else None
    folders = [os.path.realpath(f) for f in (argv[2:] if query is not None else argv[1:])]
    found = claude(folders, query) + codex(folders, query)
    found.sort(key=lambda s: s["updated"], reverse=True)
    print(json.dumps(found, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
