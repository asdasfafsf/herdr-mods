"""Theme installation and contrast checks use temporary homes only."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("theme_installer", ROOT / "scripts/install.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)
THEMES = ROOT / "mods/theme-chiikawa"


def luminance(color):
    channels = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in channels]
    return sum(c * w for c, w in zip(linear, (.2126, .7152, .0722)))


class AgentThemesTests(unittest.TestCase):
    def test_terminal_palette_stays_readable_on_cream(self):
        native = json.loads((THEMES / "herdr-chiikawa.json").read_text())
        self.assertGreater(luminance(native["background"]), .8, "Chiikawa stays light")
        for foreground in native["ansi"] + [native["foreground"]]:
            ratio = (luminance(native["background"]) + .05) / (luminance(foreground) + .05)
            self.assertGreaterEqual(ratio, 4.5, foreground)

    def test_install_preserves_user_file_config_and_backs_up_owned_theme(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            config = home / "settings.json"
            config.write_text('{"font_size":12}')
            target = home / "themes/herdr-chiikawa.json"
            source = "theme-chiikawa/herdr-chiikawa.json"
            with patch.dict(installer.os.environ, {"HERDR_APP_HOME": str(home)}), patch.object(installer, "HOME", str(home)), patch.object(installer, "USER", str(home / "user")), patch.object(installer, "BACKUPS", str(home / "backup")):
                self.assertTrue(installer.install_theme(source, True))
                self.assertFalse(target.exists())
                target.parent.mkdir()
                target.write_text("user theme")
                self.assertFalse(installer.install_theme(source, False))
                self.assertEqual(target.read_text(), "user theme")
                target.with_suffix(".herdr-mods").write_text(str(ROOT))
                self.assertTrue(installer.install_theme(source, False))
                self.assertEqual(next((home / "backup").glob("*.json.*")).read_text(), "user theme")
                self.assertEqual(json.loads(target.read_text())["background"], "#f8f5ec")
                self.assertEqual(config.read_text(), '{"font_size":12}')

    def test_standalone_bundle_preserves_existing_workspace(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            existing = {
                "settings.json": '{"theme":"ink", "font_size": 17}\n',
                "keys.json": '{"global": {"cmd-p":"custom.action"}}\n',
                "shared.json": '{"layout":"main","ag.presentation":"cards"}\n',
                "layouts/main.json": '{"id":"root","type":"block","content":{"tab":"active"}}\n',
                "mods/agents-plus/main.js": "// Existing independently installed agent view\n",
                "themes/personal.json": '{"background":"#ffffff"}\n',
                "user/.codex/config.toml": 'model = "personal-model"\n',
                "user/.claude/settings.json": '{"theme":"dark"}\n',
            }
            for name, content in existing.items():
                path = home / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content)
            result = subprocess.run(
                [sys.executable, "-I", str(ROOT / "scripts/install.py"), "chiikawa"],
                env={**os.environ, "HERDR_APP_HOME": str(home)},
                capture_output=True, text=True, timeout=10,
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            for name, content in existing.items():
                self.assertEqual((home / name).read_text(), content, name)
            added = {str(p.relative_to(home)) for p in home.rglob("*") if p.is_file()} - set(existing)
            self.assertEqual(added, {"themes/herdr-chiikawa.json", "themes/herdr-chiikawa.herdr-mods"})
            self.assertEqual((home / "themes/herdr-chiikawa.json").read_bytes(), (THEMES / "herdr-chiikawa.json").read_bytes())

    def test_standalone_bundle_does_not_create_agent_workspace(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            result = subprocess.run(
                [sys.executable, "-I", str(ROOT / "scripts/install.py"), "chiikawa"],
                env={**os.environ, "HERDR_APP_HOME": str(home)},
                capture_output=True, text=True, timeout=10,
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            self.assertEqual({p.name for p in home.iterdir()}, {"themes"})


if __name__ == "__main__":
    unittest.main()
