#!/usr/bin/env python3
"""Run the explicit agent-workspace fixture suite without installing a live mod.

Default: Node synthetic hosts, temporary installation homes, read-only generators.
--native: additionally check temporary synthetic mods with Herdr's native builder.
This does not launch a GUI, exercise live sessions, or discover unrelated tests.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
NODE_TESTS = (
    "theme-adapters.mjs", "agent-empty-states.mjs", "agents-render.mjs",
    "workspace-split.mjs", "village-motion.mjs", "drag-layout.mjs",
    "resident-assignment.mjs", "sprite-layout.mjs", "sprite-directions.mjs",
    "resident-assets.mjs", "theme-contrast.mjs", "village-composer.mjs",
    "session-controls.mjs", "sidebar-labels.mjs",
)
PYTHON_TESTS = (
    "test_agent_bundle_matrix.py", "test_agent_themes.py",
    "test_workspace_views.py", "test_install_recovery.py",
    "test_agent_workspace_runner.py",
)
GENERATORS = ("build-agent-themes.mjs", "build-sprite-directions.mjs")


def cases(node, native, seed):
    result = []
    for name in NODE_TESTS:
        args = [node, "--experimental-vm-modules", f"tests/{name}"]
        if name == "theme-adapters.mjs":
            args += ["--seed", str(seed)]
        if name == "agents-render.mjs" and native:
            args += ["--native", "--overview-only"]
        result.append((name, args, 120))
    for name in PYTHON_TESTS:
        result.append((name, [sys.executable, f"tests/{name}"], 90))
    for name in GENERATORS:
        result.append((name, [node, f"scripts/{name}", "--check"], 30))
    return result


def run_check(command, env, output, timeout):
    # A timed-out native fixture must not leave its checker child behind.
    with subprocess.Popen(command, cwd=ROOT, env=env, stdout=output,
                          stderr=subprocess.STDOUT, start_new_session=True) as process:
        try:
            return process.wait(timeout=timeout)
        except (subprocess.TimeoutExpired, KeyboardInterrupt) as error:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                pass
            # The parent may already have exited while a child ignored SIGTERM.
            # Finish the entire fixture group, not only the top-level process.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
            if isinstance(error, KeyboardInterrupt):
                raise
            output.write(f"\nTimed out after {timeout}s\n")
            return 124


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--native", action="store_true", help="also check native eager render descriptions; no GUI")
    parser.add_argument("--repeat", type=int, default=1, help="repeat the suite with successive stress seeds (1–20)")
    parser.add_argument("--seed", type=int, default=20261115, help="reproducible 32-bit transition-test seed")
    parser.add_argument("--list", action="store_true", help="list the exact checks without running them")
    args = parser.parse_args()
    if not 1 <= args.repeat <= 20 or not 0 <= args.seed <= 0xFFFFFFFF:
        parser.error("repeat must be 1–20 and seed must be an unsigned 32-bit integer")
    if args.list:
        for name, command, _ in cases("node", args.native, args.seed):
            print(f"{name}: {' '.join(command)}")
        return 0
    node = shutil.which("node")
    if not node:
        parser.error("Node.js is required")
    if args.native and not shutil.which("herdr-app"):
        parser.error("--native requires herdr-app on PATH; omit --native for synthetic checks")

    report_dir = Path(tempfile.mkdtemp(prefix="herdr-agent-workspace-report-"))
    revision = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True)
    status = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True)
    report = {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "revision": revision.stdout.strip() if revision.returncode == 0 else None,
        "working_tree_changes": status.stdout.splitlines() if status.returncode == 0 else None,
        "native_initial_render": args.native,
        "limits": "Synthetic sessions only. No GUI layout, GPU image decode, or real terminal integration verification.",
        "checks": [],
    }
    print(f"Report: {report_dir}", flush=True)
    # Do not repurpose HOME or load the real app's settings. Every run has a new
    # app home; the fixture installers additionally use their own temporary homes.
    with tempfile.TemporaryDirectory(prefix="herdr-agent-workspace-home-") as app_home:
        temp_dir = Path(app_home, "tmp")
        temp_dir.mkdir()
        env = {key: value for key, value in os.environ.items() if not key.startswith("HC_")}
        env.update(HERDR_APP_HOME=app_home, TMPDIR=str(temp_dir), PYTHONDONTWRITEBYTECODE="1")
        for iteration in range(args.repeat):
            seed = (args.seed + iteration) & 0xFFFFFFFF
            for name, command, timeout in cases(node, args.native, seed):
                log = report_dir / f"{iteration + 1:02}-{name}.log"
                started = time.monotonic()
                with log.open("w") as output:
                    try:
                        code = run_check(command, env, output, timeout)
                    except OSError as error:
                        output.write(f"\nCould not run check: {error}\n")
                        code = 125
                entry = {"name": name, "iteration": iteration + 1, "seed": seed,
                         "exit_code": code, "seconds": round(time.monotonic() - started, 3),
                         "command": command, "log": str(log)}
                report["checks"].append(entry)
                # Keep partial results even when a later check fails or is interrupted.
                (report_dir / "report.json").write_text(json.dumps(report, indent=2) + "\n")
                print(f"{'PASS' if code == 0 else 'FAIL'} [{iteration + 1}/{args.repeat}] {name} ({entry['seconds']}s)", flush=True)
                if code:
                    print("\n".join(log.read_text(errors="replace").splitlines()[-12:]), flush=True)
    failed = [entry for entry in report["checks"] if entry["exit_code"]]
    report["completed_at"] = datetime.now(timezone.utc).isoformat()
    report["passed"] = not failed
    (report_dir / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    summary = f"{len(report['checks']) - len(failed)} passed, {len(failed)} failed\n{report['limits']}\nReport: {report_dir / 'report.json'}\n"
    (report_dir / "summary.txt").write_text(summary)
    print(summary, end="", flush=True)
    return int(bool(failed))


if __name__ == "__main__":
    sys.exit(main())
