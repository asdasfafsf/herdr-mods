# lib: 여러 mod 가 같이 쓰는 코드

mod 는 자기 폴더 밖을 import 할 수 없어서, `install.sh` 가 이 파일들을 import 하는 mod 폴더마다 복사한다: `.js` 는 mod 의 main.js 가 import 하면, `.py` 는 mod 의 .py 가 import 하거나 JS에서 `"./helper.py"` 의존성을 선언하면(전이 import도 포함). 레포에서 바로 돌리는 .py 는 `../../lib` 에서 찾는다. 고칠 땐 여기서 고치고 `./install.sh`. mod 폴더의 사본은 git 에 넣지 않는다.

| 파일 | 하는 일 | 쓰는 곳 |
|---|---|---|
| `worktree.js` | 워크트리 만들기(`createWorktree`)·지우기(`removeWorktree`)·정리 후보(`cleanupCandidates`), 그 규칙(위치·base·PR·파일 복사·setup·브랜치 정리), `wt.meta`·`wt.repos` | worktree-plus(버튼·정리 창), spaces-plus(`hm new` 의 create@) |
| `resume.js` | 돌던 Claude·Codex 세션 찾기와 처음 띄운 옵션 그대로 이어 열기·fork(`AGENTS`), 레이아웃에 mod 가 떠 있는지(`runs`) | spaces-plus, wt-restore, agents-plus, picker-plus, wt-sessions |
| `saved-sessions.js` | Saved history validation, live-session deduplication, bounded presentation and safe resume payloads; history never publishes live status or residents | agents-plus |
| `project.js` | 프로젝트 추가: clone(`cloneRepo`, 새 space 의 터미널에서)·새 프로젝트(`createProject`)·기본 부모 폴더 | project-add(창), spaces-plus(`hm clone`·`hm project`) |
| `state.js` | mod 끼리 주고받는 공유 데이터의 키 이름과 모양(`META`, `TREES`, `SLEEP`, `RESULTS`, `AGENT_INFO` …), 워크트리 정보 읽기·쓰기(`metaKey`·`metaOf`·`setMeta`·`dropMeta`), 에이전트 요청에 답하기(`answer`), 바뀔 때만 쓰기(`setIfChanged`). 키는 문자열로 쓰지 말고 여기 이름으로 | 거의 모든 mod, lib/worktree.js·project.js |
| `ui.js` | 에이전트 상태 표시(`statusMark`, 자리가 있을 땐 글자까지 `statusPill`: 사이드바·Agents 목록·⌘P 가 같은 모양), 색 알약(`pill`), 창 아래 버튼(`button`, `footer`), 몇 분 전(`ago`, `agoText`) | spaces-plus, agents-plus, picker-plus, worktree-plus, wt-menu, wt-sessions, project-add, usage-bar |
| `places.js` | 폴더가 다른 폴더 안인지(`inside`), space 가 지금 어디인지(`placeOf`) | picker-plus, agents-plus |
| `docs.js` | Markdown 파일 열기 한 벌(`openDoc`: 같은 탭에 띄운 게 있으면 거기로, 아니면 그 pane 오른쪽에 `md-view` pane), 폴더의 Markdown 파일 목록(`listDocs`: 레포면 Git 이 무시하지 않는 것, 최근 바뀐 순) | picker-plus(⌘P Docs), spaces-plus(`hm md` 의 `doc@`) |
| `codex_live.py` | 로컬 Codex TUI의 세션 식별: 열린 rollout 우선, 공유 서버는 전체 제목·cwd의 유일한 일치와 열린 writer lock 확인. 모호하면 미식별 | resume.js 소비 mod, agents-plus(activity.py) |
| `agentfiles.py` | Claude Code·Codex 가 기록을 두는 곳과 읽는 법 한 벌: 경로(`CLAUDE_PROJECTS`, `CODEX_SESSIONS` 등, `CODEX_HOME` 반영), .jsonl 읽기(`json_lines`, 앞에서·끝에서), 세션 파일 찾기(`claude_transcript`, `codex_rollout`, `codex_rollout_of`, `codex_rollouts`), 돌고 있는 claude 목록(`claude_registry`), Codex 스레드 이름(`codex_names`)·현재 SQLite 메타데이터(`codex_metadata`)·실행 여부(`codex_running`), JSON 캐시 읽기·쓰기(`load`, `save`) | agents-plus(`outside.py`, `activity.py`), wt-sessions(`sessions.py`), usage-bar(`usage.py`) |

`agentsession.py`는 Claude·Codex 대화를 `agent-session/1` 중간 형식으로 읽고, 다른 에이전트가 이어받을 세션을 만든다. 도구 결과와 요약의 보존·손실 범위는 [세션 번역 WHY](../skills/session-translate/WHY.md)와 모듈 docstring을 따른다.

규칙의 배경은 쓰는 mod 의 `WHY.md`(워크트리는 `mods/worktree-plus/WHY.md`), 이식에 필요한 형식과 조건은 [이식 안내](../docs/porting/README.md)를 따른다. 현재 JS 라이브러리는 Herdr API에 의존하며 호스트 독립 SDK가 아니다.

Herdr 에 딸린 mod 의 복제본(spaces-plus, worktree-plus, picker-plus, agents-plus)에서 원본에서 온 코드(예: `place`, `glyph`, `narrow`)는 여기로 옮기지 않는다. 옮기면 Herdr 업데이트를 3-way 병합할 때마다 충돌이 커진다. 우리가 더한 코드만 모은다.
