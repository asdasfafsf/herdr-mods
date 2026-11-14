"""Activity integration with synthetic files and transports, no terminal writes."""
from contextlib import ExitStack, redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("session_activity", ROOT / "mods/agents-plus/activity.py")
activity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(activity)


class ActivitySessionsTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "parent.jsonl"
        self.path.write_text("{}\n")
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.foregrounds, self.live_sessions = {}, {}
        self.probe = self.stack.enter_context(patch.object(activity.subprocess, "run", side_effect=self.foreground))
        self.resolve = self.stack.enter_context(patch.object(activity, "codex_live_session", side_effect=lambda pid, *args: self.live_sessions.get(pid)))
        self.codex_path = self.stack.enter_context(patch.object(activity, "codex_rollout", return_value=str(self.path)))
        self.claude_path = self.stack.enter_context(patch.object(activity, "claude_transcript", return_value=str(self.path)))
        self.codex_read = self.stack.enter_context(patch.object(activity, "read_codex", return_value={"doing": "Reading synthetic file", "said": None}))
        self.claude_read = self.stack.enter_context(patch.object(activity, "read_claude", return_value={"doing": None, "said": "Synthetic reply"}))
        self.saved = self.stack.enter_context(patch.object(activity, "save"))

    def foreground(self, command, **kwargs):
        address = command[2]
        if address not in self.foregrounds:
            raise OSError("synthetic unavailable host")
        return subprocess.CompletedProcess([], 0, json.dumps(self.foregrounds[address]))

    def run_activity(self, restore, cache=None, wanted=None):
        for pid, (address, row) in enumerate(restore.items(), 1):
            self.foregrounds[address] = {"foreground": {"pid": pid, "argv": row.get("argv") or [row.get("agent", "codex")]}}
            self.live_sessions[pid] = {"session": row["session"]}
        data = {activity.CACHE: cache or {}, activity.RESTORE: {"sessions": restore}}
        output = io.StringIO()
        with patch.object(activity, "load", side_effect=lambda path, default: data.get(path, default)), redirect_stdout(output):
            self.assertEqual(activity.main([json.dumps(wanted or [{"address": address} for address in restore])]), 0)
        return json.loads(output.getvalue())

    def test_cached_output_contains_only_terminal_summaries(self):
        stat = self.path.stat()
        cache = {"files": {str(self.path): {"mtime": stat.st_mtime, "size": stat.st_size,
                 "found": {"doing": "Cached summary", "said": None, "children": [{"id": "stale"}], "session_id": "stale"}}}}
        restore = {"t1": {"agent": "codex", "session": "parent"}}
        first = self.run_activity(restore, cache)
        second = self.run_activity(restore, self.saved.call_args.args[1])
        self.assertEqual(first, {"t1": {"doing": "Cached summary", "said": None}})
        self.assertEqual(second, first)
        self.codex_read.assert_not_called()
        self.assertEqual(self.saved.call_args.args[1]["files"][str(self.path)]["found"], {"doing": "Cached summary", "said": None})

    def test_missing_or_unreadable_terminal_record_is_omitted(self):
        restore = {"t1": {"agent": "codex", "session": "parent"}}
        for failure in ("unresolved", "missing", "unreadable"):
            with self.subTest(failure=failure):
                self.codex_path.return_value = None if failure == "unresolved" else str(self.path if failure == "unreadable" else self.path.with_name("missing.jsonl"))
                self.codex_read.side_effect = OSError("synthetic read failure")
                output = self.run_activity(restore)
                self.assertEqual(output, {})

    def test_claude_activity_keeps_summary_without_codex_lookup(self):
        output = self.run_activity({"t1": {"agent": "claude", "session": "claude-parent"}})
        self.codex_path.assert_not_called()
        self.assertEqual(output["t1"], {"doing": None, "said": "Synthetic reply"})

    def test_remote_and_unsupported_restore_records_never_use_local_codex_index(self):
        restore = {"vps/t1": {"agent": "codex", "session": "parent"},
                   "t2": {"agent": "codex", "session": "parent", "argv": ["codex", "--remote", "host"]},
                   "t3": {"agent": "codex", "session": "parent", "argv": ["codex", "--remote=host"]},
                   "t4": {"agent": "codex", "session": "parent", "machine": "vps"},
                   "t5": {"agent": "other", "session": "parent"}}
        self.assertEqual(self.run_activity(restore), {})
        self.codex_path.assert_not_called()
        self.probe.assert_not_called()

    def test_remote_foreground_ignores_stale_cached_session(self):
        self.probe.side_effect = None
        self.probe.return_value = subprocess.CompletedProcess([], 0, json.dumps({"foreground": {"pid": 123, "argv": ["codex", "--remote=host"]}}))
        with patch.object(activity, "codex_live_session") as resolve:
            result = self.run_activity({}, {"map": {"t1": {"agent": "codex", "session": "parent", "pid": 123}}}, [{"address": "t1"}])
        self.assertEqual(result, {})
        resolve.assert_not_called()
        self.codex_path.assert_not_called()

    def test_unverified_codex_cache_does_not_establish_locality(self):
        result = self.run_activity({}, {"map": {"t1": {"agent": "codex", "session": "parent", "pid": 123}}}, [{"address": "t1"}])
        self.assertEqual(result, {})
        self.codex_path.assert_not_called()

    def test_changed_foreground_does_not_reuse_cached_codex_identity(self):
        self.probe.side_effect = None
        self.probe.return_value = subprocess.CompletedProcess([], 0, json.dumps({"foreground": {"pid": 123, "argv": ["zsh"]}}))
        result = self.run_activity({}, {"map": {"t1": {"agent": "codex", "session": "parent", "pid": 123}}}, [{"address": "t1"}])
        self.assertEqual(result, {})
        self.codex_path.assert_not_called()

    def test_stale_restore_is_replaced_by_current_verified_parent(self):
        self.resolve.side_effect = None
        self.resolve.return_value = {"session": "new-parent"}
        result = self.run_activity({"t1": {"agent": "codex", "session": "old-parent"}})
        self.codex_path.assert_called_once_with("new-parent")
        self.assertEqual(result["t1"], {"doing": "Reading synthetic file", "said": None})

    def test_remote_foreground_overrides_stale_local_restore(self):
        self.probe.side_effect = None
        self.probe.return_value = subprocess.CompletedProcess([], 0, json.dumps({"foreground": {"pid": 123, "argv": ["codex", "--remote=host"]}}))
        result = self.run_activity({"t1": {"agent": "codex", "session": "old-parent"}})
        self.assertEqual(result, {})
        self.resolve.assert_not_called()
        self.codex_path.assert_not_called()

    def test_restore_without_current_identity_is_deferred(self):
        self.resolve.side_effect = None
        self.resolve.return_value = None
        result = self.run_activity({"t1": {"agent": "codex", "session": "old-parent"}})
        self.assertEqual(result, {})
        self.codex_path.assert_not_called()


if __name__ == "__main__":
    unittest.main()
