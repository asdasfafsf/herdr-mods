#!/usr/bin/env python3
"""How much of their plan's limits Claude Code and Codex have used, for the usage-bar mod.

    usage.py [--now] [claude-snapshot.json]      (--now: ask both agents now)

Prints one JSON object:
    { "claude": { "updated": unix s, "windows": [ { "name", "used" 0-100, "resets" unix s | null } ] } | null,
      "codex":  { "updated": unix s, "plan": str | null, "windows": [...] } | null }

Where it comes from (nothing here reads a login or talks to a server itself):
- Claude Code hands its status line the plan's rate limits on every refresh. hm-statusline, put
  in front of the status line command, keeps them as Claude Code sent them, every window
  (~/.herdr/usage/claude-raw.json); read that. Without it, ClaudeHUD's snapshot when
  display.externalUsageWritePath names one. Also ask Claude's structured get_usage control
  request every LIVE_EVERY seconds for model-scoped windows (Fable), which the status line
  omits. No prompt/model call, transcript scan, hooks, MCP servers or saved session. This is
  an experimental Claude interface; older clients fall back to the snapshots.
- Codex: asked of Codex itself, at most every LIVE_EVERY seconds: `codex app-server` (its
  JSON-RPC over stdio) answers account/rateLimits/read with its own login, as its /status
  does; only that read, nothing that spends or changes anything. The answer is kept in
  ~/.herdr/usage/codex.json between asks. Without it (no codex, offline, logged out), its
  session rollouts (~/.codex/sessions/YYYY/MM/DD/*.jsonl, event_msg token_count .rate_limits):
  the last one of the newest rollout that has one, which only moves while a turn runs (a
  limit reached stops turns, so a rollout can show an old, lower number).
With --now, `refresh` reports each direct query outcome even when stale fallback data
is returned (including transient Codex failures normally hidden in the bar).
"updated" says when the oldest displayed window was read; cached windows keep their age.
Claude's snapshot is written by every Claude Code session's statusline, so an idle one can
overwrite it with what it last heard. Within one window (the same reset time) a session's
older number is never higher, so a lower one than the last seen is taken as stale and the
last kept (~/.herdr/usage/seen.json): the bar doesn't jump back and forth. (A plan upgrade
does lower it for real; that shows once the window resets.) Codex's numbers aren't held:
asked of Codex they're the server's now, and a reset credit really lowers them. Claude's
direct answers also pass through unchanged.
"""

import json
import fcntl
import math
import os
import select
import shutil
import subprocess
import sys
import time
from datetime import datetime

sys.path[:0] = [os.path.dirname(os.path.abspath(__file__)),  # agentfiles.py, installed beside it
                os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "lib")]  # in the repo
from agentfiles import HOME, HERDR_STATE, load, save, json_lines, codex_rollouts  # noqa: E402

TAIL = 1024 * 1024  # bytes read from a rollout's end for its last rate limits
ROLLOUTS = 40  # newest rollouts looked through for one that has them
LIVE = os.path.join(HERDR_STATE, "usage", "codex.json")
CLAUDE_LIVE = os.path.join(HERDR_STATE, "usage", "claude-live.json")
LIVE_EVERY = 300  # seconds between asks of each agent
LIVE_WAIT = 12  # seconds an ask may take
SEEN = os.path.join(HERDR_STATE, "usage", "seen.json")


def epoch(v):
    """An ISO time, epoch seconds or milliseconds as epoch seconds; None if neither."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return int(v / 1000) if v > 1e12 else int(v)
    try:
        return int(datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp())
    except ValueError:
        return None


def window(name, w):
    if not isinstance(w, dict):
        return None
    used = w.get("utilization", w.get("used_percentage", w.get("used_percent")))
    if used is None:
        return None
    try:
        used = float(used)
    except (TypeError, ValueError):
        return None
    return {"name": name, "used": used, "resets": epoch(w.get("resets_at"))} if math.isfinite(used) else None


# A rate_limits key as a window's name: five_hour 5h, seven_day 7d, seven_day_<model> "7d <model>"
# (Claude Code may send one per model), anything else as it's called.
def window_name(key):
    if key == "five_hour":
        return "5h"
    if key == "seven_day":
        return "7d"
    if key.startswith("seven_day_"):
        return "7d " + key[len("seven_day_"):].replace("_", " ")
    if key.startswith("five_hour_"):
        return "5h " + key[len("five_hour_"):].replace("_", " ")
    return key.replace("_", " ")


def claude_windows(limits):
    """Generic and model-scoped windows, including valid zero-percent Fable readings."""
    if not isinstance(limits, dict):
        return []
    order = {"five_hour": 0, "seven_day": 1}
    wins = {w["name"]: w for k in sorted(limits, key=lambda k: (order.get(k, 2), k))
            if (k.startswith("five_hour") or k.startswith("seven_day"))
            and (w := window(window_name(k), limits[k]))}
    for scoped in limits.get("model_scoped") or []:
        if isinstance(scoped, dict) and scoped.get("display_name"):
            w = window(f"7d {scoped['display_name']}", scoped)
            if w:
                wins[w["name"]] = w
    return list(wins.values())


def claude_raw(path):
    """The limits Claude Code handed its status line, as hm-statusline kept them: every window
    it sent (5h, 7d, and one per model if it sends those), or None."""
    d = load(path)
    limits = d.get("rate_limits") if isinstance(d, dict) else None
    if not isinstance(limits, dict):
        return None
    wins = claude_windows(limits)
    return {"updated": epoch(d.get("updated_at")) or int(os.path.getmtime(path)), "windows": wins} if wins else None


def claude(path):
    """ClaudeHUD's snapshot (display.externalUsageWritePath), for when hm-statusline isn't in front
    of the status line: its 5h and 7d."""
    d = load(path)
    if not isinstance(d, dict):
        return None
    wins = [w for w in (window("5h", d.get("five_hour")), window("7d", d.get("seven_day"))) if w]
    for m in d.get("model_scoped") or []:
        w = window(f"7d {m.get('display_name', '')}".strip(), m)
        if w:
            wins.append(w)
    if not wins:
        return None
    return {"updated": epoch(d.get("updated_at")) or int(os.path.getmtime(path)), "windows": wins}


def last_limits(path):
    """The rollout's last rate limits and when they were recorded (epoch s), or (None, None)."""
    last, at = None, None
    for o in json_lines(path, tail=TAIL):
        p = o.get("payload") or {}
        if o.get("type") == "event_msg" and p.get("type") == "token_count" and p.get("rate_limits"):
            last, at = p["rate_limits"], epoch(o.get("timestamp"))
    return last, at


def codex():
    path, last, at = None, None, None
    for path in codex_rollouts(days=31)[:ROLLOUTS]:  # the newest few weeks, not the whole history
        last, at = last_limits(path)
        if last:
            break
    if not last:
        return None
    label = lambda w: "5h" if (w.get("window_minutes") or 0) <= 300 else "7d" if (w.get("window_minutes") or 0) >= 10000 else f"{round((w.get('window_minutes') or 0) / 60)}h"
    wins = [window(label(w), w) for w in (last.get("primary"), last.get("secondary")) if isinstance(w, dict)]
    wins = [w for w in wins if w]
    if not wins:
        return None
    return {"updated": at or int(os.path.getmtime(path)), "plan": last.get("plan_type"), "windows": wins}


def codex_bin():
    found = shutil.which("codex")
    for p in [found, os.path.join(HOME, ".local", "bin", "codex"), "/opt/homebrew/bin/codex", "/usr/local/bin/codex"]:
        if p and os.access(p, os.X_OK):
            return p
    return None


def ask_codex():
    """Codex's own rate limits now (account/rateLimits/read): (limits, None), or (None, why not)."""
    exe = codex_bin()
    if not exe:
        return None, "codex isn't installed"
    try:
        p = subprocess.Popen([exe, "app-server"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
    except OSError as e:
        return None, f"couldn't start codex app-server ({e.strerror or e})"
    try:
        for o in ({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"clientInfo": {"name": "herdr-usage-bar", "version": "1"}}},
                  {"jsonrpc": "2.0", "method": "initialized"},
                  {"jsonrpc": "2.0", "id": 2, "method": "account/rateLimits/read", "params": {"excludeResetCreditDetails": True}}):
            p.stdin.write(json.dumps(o) + "\n")
        p.stdin.flush()
        end = time.time() + LIVE_WAIT
        while time.time() < end:
            ready, _, _ = select.select([p.stdout], [], [], 0.5)
            if not ready:
                continue
            line = p.stdout.readline()
            if not line:
                return None, "codex app-server stopped before answering"
            try:
                o = json.loads(line)
            except ValueError:
                continue
            if o.get("id") == 2:
                if o.get("error"):
                    return None, f"Codex said: {(o['error'].get('message') or 'error')[:120]}"  # e.g. logged out, offline
                got = (o.get("result") or {}).get("rateLimits")
                return (got, None) if got else (None, "Codex answered without limits")
        return None, f"no answer in {LIVE_WAIT}s (offline?)"
    except OSError as e:
        return None, f"talking to codex failed ({e.strerror or e})"
    finally:
        p.kill()


def codex_live(now=False, status=None):
    """Cached Codex limits; optional status receives the outcome of this direct attempt."""
    kept = load(LIVE)
    if now or not kept or time.time() - kept.get("tried", 0) > LIVE_EVERY:
        got, why = ask_codex()
        if status is not None:
            status.update(ok=bool(got), error=why if not got else None)
        now = int(time.time())
        # A failed ask keeps the last answer. Why it failed is kept only when it won't pass by
        # itself (logged out, codex missing or crashing): an offline moment or a slow answer is
        # let go quietly, asked again next time, and the age of the numbers says the rest.
        quiet = not why or any(k in why.lower() for k in ("no answer", "offline", "network", "connect", "timed out", "timeout", "dns", "unreachable", "econn", "enotfound"))
        kept = {"tried": now, "updated": now, "limits": got} if got else {**{k: v for k, v in (kept or {}).items() if k != "error"}, "tried": now, **({} if quiet else {"error": why})}
        save(LIVE, kept)
    lim = kept.get("limits")
    if not lim:
        return None
    wins = []
    for w in (lim.get("primary"), lim.get("secondary")):
        if isinstance(w, dict) and w.get("usedPercent") is not None:
            mins = w.get("windowDurationMins") or 0
            name = "5h" if mins <= 300 else "7d" if mins >= 10000 else f"{round(mins / 60)}h"
            wins.append({"name": name, "used": float(w["usedPercent"]), "resets": epoch(w.get("resetsAt"))})
    if not wins:
        return None
    return {"updated": kept.get("updated"), "plan": lim.get("planType"), "windows": wins, "reached": bool(lim.get("rateLimitReachedType")), **({"error": kept["error"]} if kept.get("error") else {})}


def codex_now(now=False, status=None):
    """The newer of what Codex says and what its rollouts last recorded."""
    live, logged = codex_live(now, status), codex()
    if live and (not logged or live["updated"] >= logged["updated"]):
        return live
    return logged or live


def ask_claude():
    """Read structured /usage via Claude's control protocol; never send a user prompt.

    The CLI owns authentication. Only normalized usage is cached, no credentials or
    session details. Binary reads avoid readline blocking on partial protocol frames.
    """
    exe = next((p for p in [shutil.which("claude"), os.path.join(HOME, ".local/bin/claude"),
                           "/opt/homebrew/bin/claude", "/usr/local/bin/claude"] if p and os.access(p, os.X_OK)), None)
    if not exe:
        return None, "Claude Code isn't installed"
    p = None
    try:
        p = subprocess.Popen([exe, "-p", "--input-format", "stream-json", "--output-format", "stream-json",
                              "--verbose", "--no-session-persistence", "--setting-sources", "",
                              "--strict-mcp-config", "--settings", '{"disableAllHooks":true}'],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, cwd=HOME)

        def send(rid, request):
            p.stdin.write((json.dumps({"type": "control_request", "request_id": rid, "request": request}) + "\n").encode())
            p.stdin.flush()

        send("init", {"subtype": "initialize"})
        end, buf = time.monotonic() + LIVE_WAIT, b""
        while time.monotonic() < end:
            if not select.select([p.stdout], [], [], min(0.5, max(0, end - time.monotonic())))[0]:
                continue
            chunk = os.read(p.stdout.fileno(), 65536)
            if not chunk:
                return None, "Claude Code stopped before answering (update Claude Code if needed)"
            buf += chunk
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                try:
                    o = json.loads(line)
                except ValueError:
                    continue
                if not isinstance(o, dict) or o.get("type") != "control_response":
                    continue
                r = o.get("response") or {}
                if r.get("request_id") not in ("init", "usage"):
                    continue
                if r.get("subtype") != "success":
                    return None, "Claude Code couldn't read usage (check login or update Claude Code)"
                if r["request_id"] == "init":
                    send("usage", {"subtype": "get_usage", "skip_behaviors": True})
                else:
                    data = r.get("response") or {}
                    wins = claude_windows(data.get("rate_limits"))
                    if wins:
                        return {"updated": int(time.time()), "windows": wins}, None
                    return None, "Claude Code answered without plan limits"
        return None, f"Claude Code didn't answer in {LIVE_WAIT}s"
    except (OSError, ValueError, TypeError):
        return None, "Couldn't read Claude Code usage"
    finally:
        if p is not None:
            p.kill()
            p.wait()
            p.stdin.close()
            p.stdout.close()


def claude_live(now=False, status=None):
    """Cache direct readings for five minutes; failed reads retain their original age.

    A nonblocking file lock prevents duplicate clients. Optional status reports this attempt,
    including a busy lock, independently of returned fallback usage.
    """
    kept = load(CLAUDE_LIVE, {}) or {}
    os.makedirs(os.path.dirname(CLAUDE_LIVE), exist_ok=True)
    with open(CLAUDE_LIVE + ".lock", "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            if status is not None:
                status.update(ok=False, error="Another usage read is in progress")
            return kept.get("usage")
        kept = load(CLAUDE_LIVE, {}) or {}
        if now or time.time() - kept.get("tried", 0) > LIVE_EVERY:
            got, why = ask_claude()
            if status is not None:
                status.update(ok=bool(got), error=why if not got else None)
            kept = {"tried": int(time.time()), "usage": got or kept.get("usage")}
            if why:
                kept["error"] = why
            save(CLAUDE_LIVE, kept)
    usage = kept.get("usage")
    return {**usage, **({"error": kept["error"]} if kept.get("error") else {})} if usage else None


def steady(found):
    """Claude's windows never below the last seen for the same window and reset time (see
    the top). Direct Claude readings and Codex's pass as they are."""
    seen = load(SEEN, {})
    for agent, u in found.items():
        if agent != "claude":
            continue
        for w in (u or {}).get("windows", []):
            if w.get("source") == "live":
                continue
            key = f"{agent}/{w['name']}"
            last = seen.get(key)
            if last and last.get("resets") == w.get("resets") and last.get("used", 0) > w["used"]:
                w["used"] = last["used"]
            seen[key] = {"used": w["used"], "resets": w.get("resets")}
    save(SEEN, seen)
    return found


def claude_now(snapshot, now=False, status=None):
    """Newest reading per window; a newer generic snapshot must not erase Fable."""
    raw, hud = claude_raw(os.path.join(HERDR_STATE, "usage", "claude-raw.json")), claude(snapshot)
    live = claude_live(now, status)
    wins = {}
    for u in sorted((u for u in (hud, raw, live) if u), key=lambda u: u["updated"]):
        for w in u["windows"]:
            wins[w["name"]] = {**w, "updated": u["updated"], "source": "live" if u is live else "snapshot"}
    if not wins:
        return None
    return {"updated": min(w["updated"] for w in wins.values()), "windows": list(wins.values()),
            **({"error": live["error"]} if live and live.get("error") else {})}


def main(argv):
    now = "--now" in argv
    rest = [a for a in argv if a != "--now"]
    snapshot = rest[0] if rest else os.path.join(HERDR_STATE, "usage", "claude.json")
    # Explicit outcomes distinguish cached fallback data from a successful manual refresh.
    outcomes = {"claude": {}, "codex": {}}
    found = steady({"claude": claude_now(snapshot, now, outcomes["claude"]),
                    "codex": codex_now(now, outcomes["codex"])})
    if now:
        found["refresh"] = outcomes
    print(json.dumps(found))


if __name__ == "__main__":
    main(sys.argv[1:])
