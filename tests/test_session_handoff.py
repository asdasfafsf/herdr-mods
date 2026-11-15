"""Synthetic fixtures only: classification, provider dispatch and ownership preflight."""
import importlib.util
import ast
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "lib"))
import agentfiles
import session_handoff as handoff


class HandoffTests(unittest.TestCase):
    def test_origins_do_not_confuse_desktop_editor_and_internal_children(self):
        classify = agentfiles.codex_session_kind
        self.assertEqual(classify({"source": "cli", "originator": "codex-tui"}), "cli")
        self.assertEqual(classify({"source": "vscode"}), "editor")
        for name in ("Codex Desktop", "codex_work_desktop"):
            self.assertEqual(classify({"source": "vscode", "originator": name}), "desktop")
        child = {"subagent": {"thread_spawn": {"parent_thread_id": "parent"}}}
        for source in (child, json.dumps(child)):
            self.assertEqual(classify({"source": source, "originator": "Codex Desktop"}), "subagent")
            self.assertEqual(classify({"source": "cli"}, {"source": source}), "subagent")
        self.assertEqual(classify({"source": "exec"}), "exec")
        self.assertEqual(classify({"source": "exec", "originator": "codex_work_desktop"}), "exec")
        self.assertEqual(classify({"source": "future-format", "originator": "Codex Desktop"}), "unknown")
        self.assertEqual(classify({"source": "vscode", "attached_thread_parent_id": "parent"}), "subagent")

    def test_metadata_reads_old_and_new_schemas_without_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / "state_5.sqlite"
            with closing(sqlite3.connect(db)) as c, c:
                c.execute("CREATE TABLE threads(id TEXT PRIMARY KEY,cwd TEXT,source TEXT)")
                c.execute("INSERT INTO threads VALUES('one','/work','vscode')")
                c.execute("INSERT INTO threads VALUES('two','/work','cli')")
            original = db.read_bytes()
            with patch.object(agentfiles, "CODEX_HOME", directory):
                self.assertEqual(agentfiles.codex_metadata("one"), {"one": {"id": "one", "cwd": "/work", "source": "vscode"}})
            self.assertEqual(db.read_bytes(), original)
            with closing(sqlite3.connect(db)) as c, c:
                c.execute("ALTER TABLE threads ADD COLUMN originator TEXT")
                c.execute("UPDATE threads SET originator='codex_work_desktop' WHERE id='one'")
            with patch.object(agentfiles, "CODEX_HOME", directory):
                self.assertEqual(agentfiles.codex_metadata("one")["one"]["originator"], "codex_work_desktop")

    def test_codex_ready_active_stale_and_probe_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            rollout = Path(directory) / "rollout.jsonl"
            rollout.write_text(json.dumps({"type": "session_meta", "payload": {
                "id": "one", "cwd": directory, "source": "vscode", "originator": "codex_work_desktop"}}) + "\n")
            original = rollout.read_bytes()
            with patch.object(handoff, "CODEX_HOME", directory), patch.object(handoff, "codex_metadata", return_value={"one": {"rollout_path": str(rollout)}}), patch.object(handoff.subprocess, "run") as run:
                for stdout, state in [("123\n", "active"), ("", "ready")]:
                    run.return_value = subprocess.CompletedProcess([], 0 if stdout else 1, stdout, "")
                    result = handoff.inspect_session("codex", "one")
                    self.assertEqual(result["state"], state)
                    self.assertEqual(result["origin"], "desktop")
                run.return_value = subprocess.CompletedProcess([], 1, "", "lsof failed")
                self.assertEqual(handoff.inspect_session("codex", "one")["state"], "unknown")
                run.side_effect = subprocess.TimeoutExpired("lsof", 3)
                self.assertEqual(handoff.inspect_session("codex", "one")["state"], "unknown")
            self.assertEqual(rollout.read_bytes(), original)

    def test_unsupported_does_not_probe_or_silently_start_another_session(self):
        with patch.object(handoff, "open_pids") as probe:
            for record in [{"source": "exec"}, {"source": {"subagent": "review"}}, {"source": "cli", "archived": 1}]:
                with patch.object(handoff, "codex_metadata", return_value={"one": {**record, "rollout_path": "/missing"}}):
                    self.assertEqual(handoff.inspect_session("codex", "one")["state"], "unsupported")
            self.assertEqual(handoff.inspect_session("gemini", "one")["state"], "unsupported")
            self.assertEqual(handoff.inspect_session("codex", "../one")["state"], "unsupported")
            probe.assert_not_called()

    def test_claude_stale_registry_and_active_process(self):
        with patch.object(handoff, "claude_transcript", return_value="/fixture"), patch.object(handoff.os.path, "isdir", return_value=True), patch.object(handoff, "claude_registry", return_value=[(123, {"sessionId": "one"})]), patch.object(handoff.subprocess, "run") as run:
            for command, state in [("/bin/claude\n", "active"), ("/bin/unrelated\n", "ready"), ("", "ready")]:
                run.return_value = subprocess.CompletedProcess([], 0 if command else 1, command, "")
                result = handoff.inspect_session("claude", "one")
                self.assertEqual(result["state"], state)
                self.assertFalse(result["capabilities"]["desktopHistory"])
            run.side_effect = OSError("ps unavailable")
            self.assertEqual(handoff.inspect_session("claude", "one")["state"], "unknown")

    def test_adding_provider_does_not_change_dispatch(self):
        adapter = {"inspect": lambda sid: {"state": "ready", "origin": "fixture", "sameId": sid},
                   "capabilities": {"resumeSameId": True}}
        with patch.dict(handoff.PROVIDERS, {"future-fixture": adapter}):
            result = handoff.inspect_session("future-fixture", "one")
            self.assertEqual((result["state"], result["sameId"]), ("ready", "one"))

    def test_installer_packages_transitive_adapter_dependencies(self):
        spec = importlib.util.spec_from_file_location("installer", ROOT / "scripts/install.py")
        installer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(installer)
        for mod in ("spaces-plus", "agents-plus", "wt-sessions"):
            self.assertTrue({"session_handoff.py", "agentfiles.py", "resume.js"}.issubset(installer.mod_libs(ROOT / "mods" / mod)))

    def test_hm_resume_reports_preflight_failure_instead_of_success(self):
        tree = ast.parse((ROOT / "bin/hm").read_text())
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "cmd_resume")
        printed, requests = [], []
        rec = {"agent": "codex", "session": "one", "cwd": "/work"}
        def ask(kind, value):
            requests.append((kind, value))
            raise RuntimeError("active writer")
        scope = {"find_session": lambda _: rec, "need": lambda *args: None,
                 "ask": ask, "print": printed.append}
        exec(compile(ast.Module(body=[function], type_ignores=[]), "hm-resume", "exec"), scope)
        with self.assertRaisesRegex(RuntimeError, "active writer"):
            scope["cmd_resume"]({}, "one")
        self.assertEqual(requests, [("resume", rec)])
        self.assertEqual(printed, [])


if __name__ == "__main__":
    unittest.main()
