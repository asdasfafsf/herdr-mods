"""Read-only cProfile of existing Codex identity lookup; no session input/launch.

Run with python3 -B scripts/profile-restore-discovery.py. Output contains only
counts, function names and timings, never titles, cwd, argv or session IDs.
"""
import cProfile
import importlib.util
import json
from contextlib import closing
from pathlib import Path
import pstats
import sqlite3
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / "lib"))
spec = importlib.util.spec_from_file_location("audit_codex_live", ROOT / "lib/codex_live.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


def hc(*args):
    result = subprocess.run(["hc", *args, "--json"], check=True, capture_output=True,
                            text=True, timeout=10)
    return json.loads(result.stdout)


with closing(sqlite3.connect(f"file:{helper.CODEX_HOME}/state_5.sqlite?mode=ro", uri=True, timeout=1)) as connection:
    index_counts = {
        "total": connection.execute("SELECT COUNT(*) FROM threads").fetchone()[0],
        "unarchived": connection.execute("SELECT COUNT(*) FROM threads WHERE archived=0").fetchone()[0],
        "distinct_unarchived_cwd": connection.execute(
            "SELECT COUNT(DISTINCT cwd) FROM threads WHERE archived=0").fetchone()[0],
    }

reports = []
for entry in hc("ls").get("terminals", []):
    if entry.get("state") != "live" or not (entry.get("agent") or "").startswith("codex"):
        continue
    term = hc("get", entry["address"])
    foreground = term.get("foreground") or {}
    if not foreground.get("pid"):
        continue
    profile = cProfile.Profile()
    start = time.perf_counter()
    result = profile.runcall(helper.resolve, foreground["pid"],
                            foreground.get("cwd") or term.get("cwd"),
                            term.get("title"), foreground.get("argv"))
    elapsed = time.perf_counter() - start
    stats = pstats.Stats(profile)
    rows = []
    for (filename, line, name), (primitive, calls, own, cumulative, _callers) in stats.stats.items():
        rows.append({"file": Path(filename).name, "line": line, "function": name,
                     "calls": calls, "self_ms": round(own * 1000, 3),
                     "cumulative_ms": round(cumulative * 1000, 3)})
    rows.sort(key=lambda row: row["cumulative_ms"], reverse=True)
    reports.append({"source": result.get("source") if result else "unresolved",
                    "elapsed_ms": round(elapsed * 1000, 3), "top_functions": rows[:15]})

print(json.dumps({"measurement": "cProfile overhead included; current read-only discovery, not restart",
                  "at_unix": time.time(), "index_counts": index_counts,
                  "sessions": len(reports), "profiles": reports}, indent=2))
