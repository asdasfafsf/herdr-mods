"""Session parity without launching, moving or stopping the user's real agents."""
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
sys.path.insert(0, str(ROOT / "lib"))
import agentfiles
import codex_live

spec = importlib.util.spec_from_file_location("session_list", ROOT / "mods/wt-sessions/sessions.py")
sessions = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sessions)
outside_spec = importlib.util.spec_from_file_location("outside_sessions", ROOT / "mods/agents-plus/outside.py")
outside = importlib.util.module_from_spec(outside_spec)
outside_spec.loader.exec_module(outside)


class CodexSessionsTests(unittest.TestCase):
    def test_remote_client_does_not_use_local_index(self):
        with patch.object(codex_live.subprocess, 'run') as probe:
            self.assertIsNone(codex_live.resolve(123, '/work', 'Task', ['codex', '--remote', 'host']))
            self.assertIsNone(codex_live.resolve(123, '/work', 'Task', ['codex', '--remote=host']))
            probe.assert_not_called()

    def test_failed_writer_probe_is_unknown(self):
        with patch.object(codex_live.os.path, 'isfile', return_value=True), patch.object(codex_live.subprocess, 'run', side_effect=subprocess.TimeoutExpired('lsof', 3)):
            self.assertIsNone(codex_live.writer_open('one'))

    def test_daemon_outside_sessions_exclude_herdr_and_preserve_distinct_ids(self):
        one = '00000000-0000-4000-8000-000000000001'
        two = '00000000-0000-4000-8000-000000000002'
        three = '00000000-0000-4000-8000-000000000003'
        records = {sid: {'id':sid,'cwd':'/work','source':'cli','rollout_path':'/rollout',
                         'updated_at':1,'title':'Task','archived':0} for sid in [one,two,three]}
        opened = '\n'.join('n/home/thread-writer-locks/'+sid+'.lock' for sid in records)
        with patch.object(outside, 'codex_names', return_value={}), patch.object(outside, 'codex_metadata', return_value=records), patch.object(outside, 'load', return_value={'sessions':{'t1':{'session':one}}}), patch.object(outside, 'out', side_effect=lambda *a: 'codex app-server --listen unix://' if a[0]=='ps' else opened), patch.object(outside.os.path, 'isfile', return_value=True), patch.object(outside, 'json_lines', return_value=[]):
            rows = outside.codex_sessions({123:(1,'codex')},{})
            self.assertEqual({r['session'] for r in rows},{two,three})
            self.assertTrue(all(r['app']=='Codex server' and r['argv']==['codex'] for r in rows))

    def test_full_title_cwd_and_ambiguity(self):
        rows = [{"id": "one", "cwd": "/work/a", "name": None, "title": "old prompt"},
                {"id": "two", "cwd": "/work/b", "name": None, "title": "old prompt"}]
        names = {"one": "설계 확인", "two": "설계 확인"}
        self.assertEqual(codex_live.named_session('/work/a', '⠴ 설계 확인 | a', rows, names)['id'], 'one')
        self.assertIsNone(codex_live.named_session('/work/c', '설계 확인 | c', rows, names))
        self.assertIsNone(codex_live.named_session('/work/a', '설계… | a', rows, names))
        self.assertIsNone(codex_live.named_session('/work/a', '', rows, names))
        rows[1]['cwd'] = '/work/a'
        self.assertIsNone(codex_live.named_session('/work/a', '설계 확인 | a', rows, names))

    def test_desktop_discovery_does_not_promote_internal_subagents(self):
        desktop = '00000000-0000-4000-8000-000000000001'
        child = '00000000-0000-4000-8000-000000000002'
        records = {sid: {'id':sid,'cwd':'/work','source':'vscode','originator':'codex_work_desktop',
                         'rollout_path':'/rollout','updated_at':1,'title':'Task','archived':0}
                   for sid in [desktop, child]}
        records[child]['source'] = json.dumps({'subagent': {'thread_spawn': {'parent_thread_id': desktop}}})
        opened = '\n'.join('n/home/thread-writer-locks/'+sid+'.lock' for sid in records)
        with patch.object(outside, 'codex_names', return_value={}), patch.object(outside, 'codex_metadata', return_value=records), patch.object(outside, 'load', return_value={}), patch.object(outside, 'out', side_effect=lambda *a: 'codex app-server --stdio' if a[0]=='ps' else opened), patch.object(outside.os.path, 'isfile', return_value=True), patch.object(outside, 'json_lines', return_value=[]):
            rows = outside.codex_sessions({123:(1,'codex')},{})
            self.assertEqual([(r['session'],r['origin']) for r in rows],[(desktop,'desktop')])
            self.assertEqual(rows[0]['app'], 'Codex server')  # origin is not current owner UI

    def test_multiple_open_rollouts_are_not_one_session(self):
        result = subprocess.CompletedProcess([], 0, 'n/a space/rollout-one.jsonl\nn/a/rollout-two.jsonl\n', '')
        with patch.object(agentfiles.subprocess, 'run', return_value=result):
            self.assertIsNone(agentfiles.codex_rollout_of(123))
            result.stdout = 'n/a space/rollout-one.jsonl\n'
            self.assertEqual(agentfiles.codex_rollout_of(123), '/a space/rollout-one.jsonl')

    def test_stale_writer_file_is_not_running(self):
        with tempfile.TemporaryDirectory() as directory:
            lock = Path(directory) / 'thread-writer-locks' / 'one.lock'
            lock.parent.mkdir(); lock.touch()
            with patch.object(codex_live, 'CODEX_HOME', directory), patch.object(codex_live.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', '')):
                self.assertFalse(codex_live.writer_open('one'))

    def test_move_checks_shared_writer_and_defers_to_native_cd(self):
        with tempfile.TemporaryDirectory() as directory:
            rollout = Path(directory) / 'rollout.jsonl'
            original = '{"type":"session_meta","payload":{"cwd":"/old"}}\n'
            rollout.write_text(original)
            with patch.object(sessions, 'claude_transcript', return_value=None), patch.object(sessions, 'codex_rollout', return_value=str(rollout)), patch.object(sessions, 'codex_running', return_value=True):
                with self.assertRaises(SystemExit):
                    sessions.move('one', directory)
            with patch.object(sessions, 'claude_transcript', return_value=None), patch.object(sessions, 'codex_rollout', return_value=str(rollout)), patch.object(sessions, 'codex_running', return_value=False):
                result = sessions.move('one', directory)
                self.assertTrue(result['deferred'])
                self.assertEqual(rollout.read_text(), original)

    def test_listing_uses_current_cwd_and_name(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'rollout.jsonl'
            path.write_text(json.dumps({'type':'session_meta','payload':{'id':'one','cwd':'/old'}})+'\n')
            record = {'cwd':directory,'name':'renamed','updated_at':123}
            with patch.object(sessions, 'CODEX_SESSIONS', directory), patch.object(sessions, 'codex_rollouts', return_value=[str(path)]), patch.object(sessions, 'codex_names', return_value={}), patch.object(sessions, 'codex_metadata', return_value={'one':record}):
                rows = sessions.codex([directory], None)
                self.assertEqual(rows[0]['title'], 'renamed')
                self.assertEqual(rows[0]['cwd'], directory)
                self.assertEqual(rows[0]['updated'],123)

    def test_fork_is_listed_as_itself_not_its_original(self):
        # codex fork writes its own session_meta, then the original's (copied with the history).
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'rollout.jsonl'
            path.write_text(json.dumps({'type':'session_meta','payload':{'id':'fork','cwd':directory,'forked_from_id':'one'}})+'\n'
                            + json.dumps({'type':'session_meta','payload':{'id':'one','cwd':'/old'}})+'\n'
                            + json.dumps({'type':'response_item','payload':{'type':'message','role':'user','content':[{'type':'input_text','text':'Task'}]}})+'\n')
            with patch.object(sessions, 'CODEX_SESSIONS', directory), patch.object(sessions, 'codex_rollouts', return_value=[str(path)]), patch.object(sessions, 'codex_names', return_value={}), patch.object(sessions, 'codex_metadata', return_value={'one':{'cwd':'/old'}}):
                rows = sessions.codex([directory], None)
                self.assertEqual([(r['id'], r['cwd']) for r in rows], [('fork', directory)])

    def test_copy_for_fork_leaves_the_original(self):
        with tempfile.TemporaryDirectory() as directory:
            projects, old, new = (Path(directory) / n for n in ('projects', 'old', 'new'))
            new.mkdir(); (projects / 'o').mkdir(parents=True)
            original = projects / 'o' / 'one.jsonl'
            text = json.dumps({'type':'user','cwd':'/old','entrypoint':'sdk-cli','sessionId':'one'})+'\n{"half'
            original.write_text(text)
            with patch.object(sessions, 'CLAUDE_PROJECTS', str(projects)), patch.object(sessions, 'claude_transcript', return_value=str(original)), patch.object(sessions, 'claude_registry', return_value=[(1, {'sessionId':'one'})]):
                made = sessions.copy('one', str(new))  # running: still copied
            self.assertEqual(original.read_text(), text)
            copied = [json.loads(l) for l in Path(made['copy']).read_text().splitlines()]
            self.assertEqual(copied, [{'type':'user','cwd':str(new.resolve()),'entrypoint':'cli','sessionId':'one'}])
            with patch.object(sessions, 'CLAUDE_PROJECTS', str(projects)), patch.object(sessions, 'claude_transcript', return_value=made['copy']):
                self.assertIsNone(sessions.copy('one', str(new))['copy'])  # already there: not rewritten


if __name__ == '__main__':
    unittest.main()
