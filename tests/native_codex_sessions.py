"""Optional native integration check: python3 tests/native_codex_sessions.py.

Requires an installed Codex CLI with the v2 app-server API. Uses a temporary
CODEX_HOME and synthetic imported history; never sends turn/start. Terminates
only the test's own stdio server and leaves existing sessions untouched.
"""
import json, os, select, sqlite3, subprocess, sys, tempfile, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'lib'))
import agentsession
import agentfiles
with tempfile.TemporaryDirectory(prefix='herdr-codex-parity-') as directory:
    root=Path(directory); home=root/'codex'; old=root/'old'; new=root/'new'
    for path in [home,old,new]: path.mkdir()
    agentsession.CODEX_HOME=str(home); agentsession.CODEX_SESSIONS=str(home/'sessions')
    agentfiles.CODEX_HOME=str(home); agentfiles.CODEX_SESSIONS=str(home/'sessions')
    std={'header':{'schema':'agent-session/1','id':'fixture','created':'2026-11-09T00:00:00Z','title':'Parity fixture','source':{'agent':'claude','session':'fixture','cwd':str(old)}},'messages':[{'role':'user','content':'Synthetic session only'},{'role':'assistant','content':'Fixture answer'}]}
    sid=agentsession.std_to_codex(std,str(old))
    proc=subprocess.Popen(['codex','app-server','--stdio'],cwd=old,env={**os.environ,'CODEX_HOME':str(home)},stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
    buf=b''; seq=0
    def rpc(method,params):
        global seq,buf
        seq+=1
        proc.stdin.write((json.dumps({'jsonrpc':'2.0','id':seq,'method':method,'params':params})+'\n').encode()); proc.stdin.flush()
        deadline=time.monotonic()+20
        while time.monotonic()<deadline:
            if not select.select([proc.stdout],[],[],min(1,max(0,deadline-time.monotonic())))[0]: continue
            chunk=os.read(proc.stdout.fileno(),65536)
            if not chunk: raise RuntimeError('server exited')
            buf+=chunk
            while b'\n' in buf:
                line,buf=buf.split(b'\n',1)
                msg=json.loads(line)
                if msg.get('id')==seq:
                    if 'error' in msg: raise RuntimeError(msg['error'])
                    return msg['result']
        raise TimeoutError(method)
    try:
        rpc('initialize',{'clientInfo':{'name':'herdr-parity-test','version':'1'},'capabilities':{'experimentalApi':True}})
        resumed=rpc('thread/resume',{'threadId':sid,'cwd':str(new),'excludeTurns':True})
        assert resumed['thread']['id']==sid
        assert resumed['cwd']==str(new),resumed['cwd']
        forked=rpc('thread/fork',{'threadId':sid,'cwd':str(new)})
        assert forked['thread']['id']!=sid
        with sqlite3.connect(home/'state_5.sqlite') as conn:
            current=conn.execute('SELECT cwd FROM threads WHERE id=?',(sid,)).fetchone()
        assert current and os.path.realpath(current[0])==os.path.realpath(new),current
        exported=agentsession.codex_to_std(sid)
        assert os.path.realpath(exported['header']['source']['cwd'])==os.path.realpath(new)
        assert any('Fixture answer' in m['content'] for m in exported['messages'])
        print('PASS: isolated imported Codex session resumed by ID, changed cwd in native SQLite, forked to new ID; no turn/start or model request.')
    finally:
        proc.terminate()
        try:proc.wait(timeout=5)
        except subprocess.TimeoutExpired:proc.kill();proc.wait()
