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
    def test_one_split_preserves_the_native_terminal_and_other_panels(self):
        terminal = {"id": "main", "type": "block", "content": {"tab": "active", "pane": {"gap": 8}}}
        sidebar = {"id": "sidebar", "size": {"px": 268}}
        source = {"id": "root", "theme": "ink", "children": [sidebar, terminal]}
        before = copy.deepcopy(source)
        installer.patch(source, {"workspace_views": {}})
        nodes = {n.get("id"): n for n, _ in installer.blocks(source)}
        self.assertEqual(nodes["workspace-views"]["type"], "column")
        self.assertTrue(nodes["workspace-views"]["resizable"])
        self.assertEqual(nodes["agent-terminal-surface"]["children"], [before["children"][1]])
        self.assertEqual(nodes["agent-scene"]["min"], 0)
        self.assertEqual(nodes["agent-terminal-dock"]["min"], 20)
        self.assertEqual(nodes["agent-terminal-toolbar"]["size"], {"px": 20})
        self.assertEqual(nodes["agent-scene"]["size"], {"weight": 0.5})
        self.assertEqual(nodes["agent-terminal-dock"]["size"], {"weight": 0.5})
        self.assertNotIn("workspace-view-switch", nodes)
        self.assertNotIn("active", nodes["workspace-views"])
        self.assertEqual(source["children"][0], before["children"][0])
        self.assertEqual(source["theme"], "ink")
        once = copy.deepcopy(source)
        self.assertIsNone(installer.patch(source, {"workspace_views": {}}))
        self.assertEqual(source, once)

    def test_split_upgrades_owned_agent_block_without_changing_terminal(self):
        terminal = {"id": "main", "type": "block", "content": {"tab": "active", "pane": {"gap": 8}}}
        agent = {"id": "agent-world", "type": "block", "content": {
            "mod": "agents-plus", "props": {"mode": "overview", "integrated": True}}}
        source = {"id": "workspace-views", "type": "stack", "active": "agent-world", "children": [terminal, agent]}
        before = copy.deepcopy(terminal)
        installer.patch(source, {"workspace_views": {}})
        self.assertNotIn("active", source)
        self.assertEqual(source["type"], "column")
        nodes = {node["id"]: node for node, _ in installer.blocks(source)}
        self.assertEqual(nodes["agent-terminal-surface"]["children"], [before])
        self.assertNotIn("hidden", nodes["agent-terminal-surface"])
        self.assertEqual(nodes["agent-scene"]["content"], agent["content"])
        once = copy.deepcopy(source)
        self.assertIsNone(installer.patch(source, {"workspace_views": {}}))
        self.assertEqual(source, once)

    def test_old_dock_and_owned_switch_migrate_without_replacing_user_controls(self):
        terminal = {"id": "main", "type": "block", "content": {"tab": "active", "pane": {"header": {"height": 35}}}}
        content = {"mod": "agents-plus", "props": {"mode": "overview", "integrated": True}}
        old = {"id": "agent-world", "type": "column", "children": [
            {"id": "agent-scene", "type": "block", "content": content},
            {"id": "agent-terminal-dock", "type": "column", "size": {"px": 480}, "children": [
                {"id": "agent-terminal-toolbar", "type": "block", "content": {"mod": "agents-plus", "props": {"mode": "terminal-toolbar"}}},
                {"id": "agent-terminal-surface", "type": "block", "content": {"agent": "focused"}}
            ]}
        ]}
        custom = {"id": "custom-control", "type": "block", "content": {"mod": "custom"}}
        source = {"id": "workspace-presentation", "type": "column", "size": {"px": 900}, "children": [
            {"id": "workspace-view-switch", "type": "block", "content": {"mod": "agents-plus", "props": {"mode": "view-switch"}}},
            {"id": "workspace-views", "type": "stack", "active": "agent-world", "padding": 2, "children": [terminal, old]},
            custom
        ]}
        before = copy.deepcopy(terminal)
        installer.patch(source, {"workspace_views": {}})
        nodes = {node["id"]: node for node, _ in installer.blocks(source)}
        self.assertNotIn("workspace-view-switch", nodes)
        self.assertEqual(nodes["workspace-views"]["padding"], 2)
        self.assertEqual(nodes["agent-terminal-surface"]["children"], [before])
        self.assertEqual(source["size"], {"px": 900})
        self.assertIs(source["children"][-1], custom)
        self.assertEqual(sum((n.get("content") or {}).get("tab") == "active" for n, _ in installer.blocks(source)), 1)

    def test_customized_legacy_dock_is_not_replaced(self):
        source = {"id": "workspace-views", "type": "stack", "children": [
            {"id": "main", "type": "block", "content": {"tab": "active"}},
            {"id": "agent-world", "type": "column", "children": [
                {"id": "agent-scene", "type": "block", "content": {"mod": "custom"}}
            ]}
        ]}
        before = copy.deepcopy(source)
        self.assertIsNone(installer.patch(source, {"workspace_views": {}}))
        self.assertEqual(source, before)

    def test_custom_agent_surface_is_not_replaced(self):
        source = {"id": "workspace-views", "type": "stack", "children": [
            {"id": "agent-world", "type": "block", "content": {"mod": "custom"}}]}
        before = copy.deepcopy(source)
        self.assertIsNone(installer.patch(source, {"workspace_views": {}}))
        self.assertEqual(source, before)

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
