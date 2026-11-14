"""Exercise UI error retention without opening, modifying or restarting Herdr."""

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("diagnostics", Path(__file__).resolve().parents[1] / "mods/agents-plus/diagnostics.py")
diagnostics = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnostics)


class DiagnosticsTests(unittest.TestCase):
    def render_batch(self):
        return {"schema": 1, "instance": "123-abc", "slow_ms": 25, "completed": 1,
                "slow": 1, "unfinished": 0, "invalid_clock": 0, "total_ms": 30,
                "max_ms": 30, "phases": {"rows": {"total_ms": 30, "max_ms": 30}},
                "samples": [{"outcome": "unfinished", "started_at_ms": 1,
                             "last_phase": "rows", "completed_phases": {"inputs": 3},
                             "counts": {"agents": 12, "sort": "priority", "collapsed": False},
                             "invalid_clock": False}], "worst": None}

    def test_render_payload_bounds_and_content(self):
        batch = self.render_batch()
        self.assertEqual(diagnostics.render_batch(json.dumps(batch)), batch)
        for mutate in (
            lambda b: b.update(title="private title"),
            lambda b: b.update(samples=[{}] * 9),
            lambda b: b.update(total_ms=-1),
            lambda b: b.update(total_ms=float("nan")),
            lambda b: b.update(instance="private/path"),
            lambda b: b.update(phases={"unknown": 3}),
        ):
            invalid = self.render_batch()
            mutate(invalid)
            with self.assertRaises(ValueError):
                diagnostics.render_batch(json.dumps(invalid))
        with self.assertRaises(ValueError):
            diagnostics.render_batch(" " * 16001)

    def test_render_writer_and_reader_use_separate_log_and_explicit_home(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            command = [sys.executable, "-I", diagnostics.__file__]
            written = subprocess.run([*command, "--app-home", directory, "--record-render",
                                      json.dumps(self.render_batch())], capture_output=True, text=True, timeout=8)
            self.assertEqual(written.returncode, 0, written.stderr)
            path = root / "diagnostics/render.jsonl"
            self.assertEqual(json.loads(path.read_text())["event"], "render_profile")
            self.assertFalse((root / "diagnostics/ui.jsonl").exists())
            read = subprocess.run([*command, "--render", "--json"],
                                  env={**os.environ, "HERDR_APP_HOME": directory},
                                  capture_output=True, text=True, timeout=8)
            self.assertEqual(read.returncode, 0, read.stderr)
            self.assertEqual(json.loads(read.stdout)["completed"], 1)
            # A second stream rotates without changing the UI error file.
            diagnostics.append_record(root / "diagnostics", {"event": "keep"})
            for i in range(7):
                diagnostics.append_record(root / "diagnostics", {"event": "test", "index": i},
                                          limit=100, filename="render.jsonl")
            self.assertTrue((root / "diagnostics/render.jsonl.3").exists())
            self.assertEqual(json.loads((root / "diagnostics/ui.jsonl").read_text())["event"], "keep")

    def test_error_dedup_recovery_and_recurrence(self):
        recorder = diagnostics.Recorder()
        healthy = {"errors": [], "layout": "test"}
        failed = {"errors": [{"message": "interrupted", "stack": "outsideRow:355"}]}
        self.assertEqual(recorder.observe(healthy, None, 100)["event"], "snapshot")
        event = recorder.observe(failed, None, 101)
        self.assertEqual(event["event"], "errors")
        self.assertIn("outsideRow:355", event["errors"])
        self.assertIsNone(recorder.observe(failed, None, 102))
        self.assertEqual(recorder.observe(failed, None, 161)["event"], "heartbeat")
        self.assertEqual(recorder.observe(healthy, None, 162)["event"], "recovered")
        self.assertEqual(recorder.observe(failed, None, 163)["event"], "errors")

    def test_unavailable_is_not_recovery(self):
        recorder = diagnostics.Recorder()
        failed = {"errors": ["interrupted"]}
        recorder.observe(failed, None, 100)
        self.assertEqual(recorder.observe(None, "timeout", 101)["event"], "status_unavailable")
        self.assertIsNone(recorder.observe(None, "timeout", 102))
        event = recorder.observe(failed, None, 103)
        self.assertTrue(event["reconnected"])
        self.assertEqual(event["error_count"], 1)
        self.assertNotEqual(event["event"], "recovered")

    def test_error_details_are_bounded(self):
        event = diagnostics.Recorder().observe({"errors": ["x" * 40000]}, None, 1)
        self.assertTrue(event["errors_truncated"])
        self.assertEqual(len(event["errors"]), 32000)

    def test_rotation_retains_recent_history(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for index in range(7):
                diagnostics.append_record(root, {"event": "test", "index": index}, limit=100)
            paths = [root / f"ui.jsonl.{i}" for i in range(3, 0, -1)] + [root / "ui.jsonl"]
            records = [json.loads(line) for path in paths for line in path.read_text().splitlines()]
            self.assertEqual([item["index"] for item in records], [3, 4, 5, 6])
            self.assertEqual((root / "ui.jsonl").stat().st_mode & 0o777, 0o600)

    def test_sample_timeout_and_invalid_response(self):
        with patch.object(diagnostics.subprocess, "run", side_effect=subprocess.TimeoutExpired("status", 5)):
            self.assertEqual(diagnostics.sample(), (None, "status timed out after 5 seconds"))
        with patch.object(diagnostics.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, '{}', '')):
            self.assertEqual(diagnostics.sample(), (None, "status did not contain an errors list"))

    def test_context_does_not_copy_user_content(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "shared.json").write_text(json.dumps({"wt.trees": {"private-repo": {"checkouts": [{"path": "/private"}]}}, "ag.info": {"t1": {"said": "private transcript"}}}))
            result = diagnostics.context(root)
            self.assertEqual(result["checkouts"], 1)
            self.assertEqual(result["agent_info"], 1)
            self.assertNotIn("private", json.dumps(result))

    def test_watcher_lock_stop_and_saved_stack(self):
        # A fake CLI isolates the whole process test from the user's running app.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cli = root / "herdr-app"
            cli.write_text('#!/bin/sh\nprintf \'%s\\n\' \'{"errors":["synthetic interrupted at outsideRow:355"]}\'\n')
            cli.chmod(0o700)
            env = {**os.environ, "PATH": str(root) + os.pathsep + os.environ["PATH"], "HERDR_APP_HOME": str(root)}
            command = [sys.executable, "-I", diagnostics.__file__]
            process = subprocess.Popen([*command, "--watch"], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                path = root / "diagnostics/ui.jsonl"
                deadline = time.monotonic() + 8
                while time.monotonic() < deadline:
                    if path.exists() and "outsideRow:355" in path.read_text():
                        break
                    if process.poll() is not None:
                        self.fail(f"Recorder exited: {process.communicate()}")
                    time.sleep(0.02)
                self.assertIn("outsideRow:355", path.read_text())
                duplicate = subprocess.run([*command, "--once"], env=env, capture_output=True, text=True, timeout=8)
                self.assertEqual(duplicate.returncode, 1)
                stopped = subprocess.run([*command, "--stop"], env=env, capture_output=True, text=True, timeout=8)
                self.assertEqual(stopped.returncode, 0)
                process.communicate(timeout=8)
                self.assertEqual(process.returncode, 0)
                self.assertIn('"event": "watch_stopped"', path.read_text())
                # A stale stop request must not stop a new execution or hold its lock.
                again = subprocess.run([*command, "--once"], env=env, capture_output=True, text=True, timeout=8)
                self.assertEqual(again.returncode, 0)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.communicate()


if __name__ == "__main__":
    unittest.main()
