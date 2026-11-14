"""Restore log rotation and CLI reading, using temporary homes only."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('restore_diagnostics',ROOT/'mods/wt-restore/diagnostics.py')
diagnostics=importlib.util.module_from_spec(spec);spec.loader.exec_module(diagnostics)


class RestoreDiagnosticsTests(unittest.TestCase):
    def test_rotation_and_hm_read_without_agents_bundle(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            target=root/'mods/wt-restore';target.mkdir(parents=True)
            shutil.copy2(diagnostics.__file__,target/'diagnostics.py')
            for i in range(8):
                diagnostics.record(directory,{'channel':'storage','problem':{'reason':f'failure {i}'}},limit=300)
            self.assertTrue((root/'diagnostics/restore.jsonl.1').exists())
            self.assertFalse((root/'diagnostics/restore.jsonl.2').exists())
            result=subprocess.run([sys.executable,str(ROOT/'bin/hm'),'logs','--restore','--json'],env={**os.environ,'HERDR_APP_HOME':directory},capture_output=True,text=True,timeout=5)
            self.assertEqual(result.returncode,0,result.stderr)
            events=[json.loads(line) for line in result.stdout.splitlines()]
            self.assertEqual(events[-1]['problem']['reason'],'failure 7')
            self.assertLess(len(events),8)
            self.assertEqual((root/'diagnostics/restore.jsonl').stat().st_mode & 0o777,0o600)

    def test_log_modes_cannot_be_combined(self):
        result=subprocess.run([sys.executable,str(ROOT/'bin/hm'),'logs','--restore','--watch'],capture_output=True,text=True,timeout=5)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('cannot be combined',result.stderr)
