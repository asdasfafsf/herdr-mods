"""Installer rollback and failure status in isolated homes; never run the real host."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('installer', ROOT/'scripts/install.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.repo, self.app = root/'repo', root/'app'
        self.source = self.repo/'mods/example'
        self.target = self.app/'mods/example'
        self.source.mkdir(parents=True); self.target.mkdir(parents=True)
        (self.repo/'lib').mkdir()
        (self.source/'main.js').write_text('new code')
        (self.source/'new.svg').write_text('new icon')
        (self.target/'main.js').write_text('old code')
        (self.target/'old.svg').write_text('old icon')
        (self.target/installer.MARK).write_text('owned')
        (self.target/'herdr.d.ts').write_text('host definition')
        for name, value in {'REPO':str(self.repo),'HOME':str(self.app),'BACKUPS':str(root/'backups')}.items():
            p = patch.object(installer, name, value); p.start(); self.addCleanup(p.stop)
        quiet = patch.object(installer,'say'); quiet.start();self.addCleanup(quiet.stop)

    def assert_old_files(self):
        self.assertEqual((self.target/'main.js').read_text(),'old code')
        self.assertTrue((self.target/'old.svg').exists())
        self.assertFalse((self.target/'new.svg').exists())
        self.assertEqual((self.target/'herdr.d.ts').read_text(),'host definition')

    def test_failed_precheck_leaves_live_files_untouched(self):
        with patch.object(installer,'check_mod',return_value=False):
            self.assertFalse(installer.install_mod('example',False))
        self.assert_old_files()

    def test_failed_postcheck_restores_previous_code_and_assets(self):
        with patch.object(installer,'check_mod',side_effect=[True,False]):
            self.assertFalse(installer.install_mod('example',False))
        self.assert_old_files()
        self.assertTrue(list(Path(installer.BACKUPS).glob('mod-example-*/example/main.js')))

    def test_success_preserves_host_files_and_removes_obsolete_owned_files(self):
        with patch.object(installer,'check_mod',return_value=True):
            self.assertTrue(installer.install_mod('example',False))
        self.assertEqual((self.target/'main.js').read_text(),'new code')
        self.assertTrue((self.target/'new.svg').exists())
        self.assertFalse((self.target/'old.svg').exists())
        self.assertEqual((self.target/'herdr.d.ts').read_text(),'host definition')

    def test_failed_first_install_does_not_leave_owned_code(self):
        import shutil
        shutil.rmtree(self.target)
        with patch.object(installer,'check_mod',side_effect=[True,False]):
            self.assertFalse(installer.install_mod('example',False))
        self.assertFalse((self.target/'main.js').exists())
        self.assertFalse((self.target/installer.MARK).exists())

    def test_copy_failure_restores_old_files(self):
        replace = installer.replace_owned
        attempts = []
        def fail_once(source,target):
            attempts.append(source)
            if len(attempts)==1:
                (Path(target)/'main.js').write_text('partial')
                raise OSError('copy failed')
            replace(source,target)
        with patch.object(installer,'check_mod',return_value=True), patch.object(installer,'replace_owned',side_effect=fail_once):
            self.assertFalse(installer.install_mod('example',False))
        self.assert_old_files()

    def test_empty_check_error_and_timeout_are_failures(self):
        with patch.object(installer.subprocess,'run',return_value=subprocess.CompletedProcess([],1,'','')):
            self.assertFalse(installer.check_mod('example',str(self.target)))
        with patch.object(installer.subprocess,'run',side_effect=subprocess.TimeoutExpired('check',30)):
            self.assertFalse(installer.check_mod('example',str(self.target)))

    def test_main_stops_before_settings_when_mod_fails(self):
        bundles={'bundle':{'mods':['example'],'layout':[]}}
        with patch.object(installer,'load',return_value=bundles), patch.object(installer,'install_mod',return_value=False), patch.object(installer,'merge_keys') as keys:
            self.assertEqual(installer.main(['bundle']),1)
            keys.assert_not_called()

    def test_dry_run_does_not_check_or_replace(self):
        with patch.object(installer,'check_mod') as check:
            self.assertTrue(installer.install_mod('example',True));check.assert_not_called()
        self.assert_old_files()


if __name__ == "__main__":
    unittest.main()
