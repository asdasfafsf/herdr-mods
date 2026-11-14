"""Workspace presentation migration; fixtures only, no live host or sessions."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("installer", ROOT / "scripts/install.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class WorkspaceViewsTests(unittest.TestCase):
    def test_one_stack_preserves_the_native_terminal_and_other_panels(self):
        terminal = {"id": "main", "type": "block", "content": {"tab": "active", "pane": {"gap": 8}}}
        sidebar = {"id": "sidebar", "size": {"px": 268}}
        source = {"id": "root", "theme": "ink", "children": [sidebar, terminal]}
        before = copy.deepcopy(source)
        installer.patch(source, {"workspace_views": {}})
        stack = next(n for n, _ in installer.blocks(source) if n.get("id") == "workspace-views")
        self.assertEqual(stack["type"], "stack")
        self.assertEqual(stack["active"], "main")
        self.assertEqual(stack["children"][0], before["children"][1])
        self.assertEqual(source["children"][0], before["children"][0])
        self.assertEqual(source["theme"], "ink")
        once = copy.deepcopy(source)
        self.assertIsNone(installer.patch(source, {"workspace_views": {}}))
        self.assertEqual(source, once)

    def test_retire_only_owned_inactive_layout_with_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            (home / "layouts").mkdir()
            old = home / "layouts/herdr-agents.json"
            old.write_text(json.dumps({"id": "agent-workspace", "type": "row", "children": [
                {"id": "agent-world", "content": {"mod": "agents-plus", "props": {"mode": "overview", "integrated": True}}}
            ]}))
            original = old.read_bytes()
            with patch.object(installer, "HOME", str(home)), patch.object(installer, "BACKUPS", str(home / "backup")):
                (home / "shared.json").write_text('{"layout":"herdr-agents"}')
                installer.archive_legacy_agent_layout(False)
                self.assertTrue(old.exists(), "never remove the displayed layout")
                (home / "shared.json").write_text('{"layout":"herdr-worktrees"}')
                installer.archive_legacy_agent_layout(True)
                self.assertTrue(old.exists(), "dry run leaves files intact")
                installer.archive_legacy_agent_layout(False)
                self.assertFalse(old.exists())
                self.assertEqual(next((home / "backup").glob("*.json")).read_bytes(), original)
                old.write_text('{"id":"user-layout","type":"row"}')
                installer.archive_legacy_agent_layout(False)
                self.assertTrue(old.exists(), "unrecognized user layouts are preserved")


if __name__ == "__main__":
    unittest.main()
