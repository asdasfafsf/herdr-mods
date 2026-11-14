"""Independent bundle matrix; temporary homes and synthetic hosts only.

The native checker is replaced for file installation; the installed JavaScript
is then linked/rendered by a separate VM test with real execution forbidden.
No reset-credit execution path, even a mock, is exercised.
"""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("bundle_matrix_installer", ROOT / "scripts/install.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


def put(home, name, value):
    path = home / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))


def workspace(sidebar):
    children = [{"id": "main", "type": "block", "content": {"tab": "active"}}]
    if sidebar != "absent":
        children.insert(0, {"id": "sidebar", "type": "block", "hidden": sidebar == "hidden",
                            "content": {"mod": "agents"}})
    return {"id": "root", "type": "row", "theme": "ink", "children": children}


class AgentBundleMatrixTests(unittest.TestCase):
    def install(self, home, bundles, source=None):
        if source is not None:
            put(home, "layouts/sandbox.json", source)
            put(home, "shared.json", {"layout": "sandbox"})
        # No skill destination exists, so this can never reach the real user.
        with contextlib.ExitStack() as stack:
            for name, value in {"HOME": str(home), "BACKUPS": str(home / "backups"),
                                "USER": str(home / "user"), "BIN": str(home / "user/bin"),
                                "SKILL_HOMES": [str(home / "user/.codex"), str(home / "user/.claude")]}.items():
                stack.enter_context(patch.object(installer, name, value))
            checker = stack.enter_context(patch.object(installer, "check_mod", return_value=True))
            # Installation must not spawn a real app/core/agent for this matrix.
            stack.enter_context(patch.object(installer.subprocess, "run", side_effect=AssertionError("Unexpected real process during fixture installation")))
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            result = installer.main([*bundles, "--layout", "sandbox"] if source is not None else list(bundles))
        return result, checker.call_count

    def test_standalone_and_combined_bundles_need_no_other_optional_bundle(self):
        for bundles in [("agents",), ("chiikawa",), ("agents", "chiikawa")]:
            for sidebar in ("shown", "absent", "hidden"):
                with self.subTest(bundles=bundles, sidebar=sidebar), tempfile.TemporaryDirectory() as directory:
                    home = Path(directory)
                    source = workspace(sidebar)
                    put(home, "settings.json", {"theme": "ink", "font_size": 17})
                    put(home, "keys.json", {"global": {"cmd-p": "personal.palette"}})
                    configs = {"settings.json": (home / "settings.json").read_bytes()}
                    result, checks = self.install(home, bundles, source)
                    self.assertEqual(result, 0)
                    self.assertEqual((home / "settings.json").read_bytes(), configs["settings.json"])
                    self.assertEqual(json.loads((home / "shared.json").read_text()), {"layout": "sandbox"})
                    self.assertEqual(json.loads((home / "keys.json").read_text())["global"]["cmd-p"], "personal.palette")
                    installed = {path.name for path in (home / "mods").iterdir()} if (home / "mods").exists() else set()
                    self.assertEqual(installed, {"agents-plus"} if "agents" in bundles else set())
                    themes = {path.name for path in (home / "themes").glob("*.json")}
                    self.assertEqual(themes, {"herdr-chiikawa.json"} if "chiikawa" in bundles else set())
                    actual = json.loads((home / "layouts/sandbox.json").read_text())
                    if "agents" in bundles:
                        self.assertEqual(checks, 2)
                        nodes = {node.get("id"): node for node, _ in installer.blocks(actual)}
                        self.assertEqual(nodes["main"]["content"], {"tab": "active"})
                        self.assertEqual(nodes["workspace-views"]["type"], "column")
                        self.assertTrue(nodes["workspace-views"]["resizable"])
                        self.assertNotIn("active", nodes["workspace-views"])
                        self.assertNotIn("workspace-view-switch", nodes)
                        self.assertEqual(nodes["agent-scene"]["size"], {"weight": 0.6})
                        self.assertEqual(nodes["agent-terminal-dock"]["size"], {"weight": 0.4})
                        self.assertEqual(nodes["agent-terminal-surface"]["children"], [nodes["main"]])
                        self.assertEqual(actual["theme"], "ink")
                        if sidebar != "absent":
                            self.assertEqual(nodes["sidebar"]["hidden"], sidebar == "hidden")
                        self.assertTrue((home / "mods/agents-plus/state.js").is_file())
                        self.assertTrue((home / "mods/agents-plus/agent-status.js").is_file())
                        self.assertTrue((home / "mods/agents-plus/village-spacing.js").is_file())
                    else:
                        self.assertEqual(checks, 0)
                        self.assertEqual(actual, source)

    def test_installed_agent_module_renders_without_repo_libs_or_optional_bundles(self):
        for bundles in [("agents",), ("agents", "chiikawa")]:
            with self.subTest(bundles=bundles), tempfile.TemporaryDirectory() as directory:
                home = Path(directory)
                self.assertEqual(self.install(home, bundles, workspace("absent"))[0], 0)
                for script in ["agent-empty-states.mjs", "theme-adapters.mjs"]:
                    result = subprocess.run(["node", "--experimental-vm-modules", str(ROOT / "tests" / script),
                                             "--mod-dir", str(home / "mods/agents-plus")],
                                            cwd=directory, capture_output=True, text=True, timeout=20)
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


    def test_empty_home_without_layout_files_is_not_an_exception(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            result, _ = self.install(home, ("agents",))
            self.assertEqual(result, 0)
            self.assertTrue((home / "mods/agents-plus/main.js").is_file())
            self.assertFalse((home / "layouts/herdr-worktrees.json").exists(), "do not fabricate an empty layout")

    def test_unreadable_shipped_layout_is_preserved_without_a_fabricated_clone(self):
        for content in ["not json", "[]", "{}", '{"type":"column"}', '{"type":"block","content":null}',
                        '{"type":"block","content":{}}', '{"type":"row","children":["invalid"]}']:
            with self.subTest(content=content), tempfile.TemporaryDirectory() as directory:
                home = Path(directory)
                source = home / "layouts/main.json"
                source.parent.mkdir()
                source.write_text(content)
                result, _ = self.install(home, ("agents",))
                self.assertEqual(result, 0)
                self.assertEqual(source.read_text(), content)
                self.assertFalse((home / "layouts/herdr-worktrees.json").exists())

    def test_empty_home_dry_run_writes_nothing_and_never_calls_native_checker(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            result, checks = self.install(home, ("agents", "chiikawa", "--dry-run"))
            self.assertEqual(result, 0)
            self.assertEqual(checks, 0)
            self.assertEqual(list(home.iterdir()), [])

    def test_valid_shipped_layout_is_cloned_without_mutating_original(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            put(home, "layouts/main.json", workspace("absent"))
            before = (home / "layouts/main.json").read_bytes()
            result, _ = self.install(home, ("agents",))
            self.assertEqual(result, 0)
            self.assertEqual((home / "layouts/main.json").read_bytes(), before)
            cloned = json.loads((home / "layouts/herdr-worktrees.json").read_text())
            self.assertEqual(cloned["cloned_from"]["name"], "main")
            self.assertTrue(any(node.get("id") == "workspace-views" for node, _ in installer.blocks(cloned)))


if __name__ == "__main__":
    unittest.main()
