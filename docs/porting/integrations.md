# 외부 연동과 명령 계약

이 문서는 기준 코드가 실제로 호출하는 인터페이스를 기록한다. 외부 프로그램의 최신 버전 전체에 대한 지원 약속은 아니다. 새 앱에서는 지원 버전을 고정하고 아래 응답 fixture로 파서를 확인한 뒤 실제 계정/테스트 레포에서 합격 사례를 실행한다. 로그인 비밀값은 문서·fixture·이전 파일에 포함하지 않는다.

## Git / GitHub / 파일 준비

| 목적 | 호출 또는 입력 | 결과 해석 |
|---|---|---|
| checkout/primary 구분 | `git rev-parse --show-toplevel`, `--path-format=absolute --git-common-dir` | main/common-dir와 현재 top이 다르면 linked |
| checkout 목록 | `git worktree list --porcelain` | 빈 줄로 구분된 worktree/HEAD/branch/bare/detached 정보. Unicode 경로·브랜치 보존 |
| 기본 base | `git symbolic-ref refs/remotes/origin/HEAD`, `show-ref --verify --quiet …` | origin HEAD → main → master → HEAD |
| 브랜치 검사·생성 | `git check-ref-format --branch B`; `worktree add [--track 또는 --no-track] [-b B] PATH REF` | 실패 코드/메시지를 사용자에게 반환. 데이터·UI 메타데이터는 성공 후 기록 |
| 안전성·merge | `git --no-optional-locks -c core.fsmonitor=false status --porcelain`; `merge-base --is-ancestor …` | 실패와 변경 없음 구분. submodule·untracked도 확인 |
| 정리 | `fetch --prune --quiet origin`; `worktree remove [--force] PATH`; `branch -D B` | branch -D는 합의된 merge/PR 증거를 확인한 뒤만 |
| PR/issue 이름 | `gh pr view ID --json number,headRefName,title,url`, `gh issue view URL --json title,number` | gh 실패를 빈 제목과 혼동하지 않음. 티켓 키만 있으면 키 그대로 |
| PR/CI 배지 | `gh pr list --state all --author @me --limit 60 --json number,headRefName,state,isDraft,url,title,statusCheckRollup` | repo+headRefName으로 대응; OPEN/MERGED/CLOSED와 checks를 표시 |
| 파일 복사 | `include.py PRIMARY TARGET EXTRA_PATTERNS` | `{copied:[…],kept:[…],patterns:[…]}`. 전체 gitignore 구현은 아님 |

PR refresh 타이머는 60초마다 필요 여부를 검사하되 레포별 조회 간격은 5분이다. 앱이 활성일 때 정기 조회하며 첫 조회는 시작 후 약 4초다. 이 간격 자체보다 호출 폭주 방지와 마지막 조회 시각/실패 구분이 이식 요구다.

## Claude 사용량

관찰한 실행 버전: Claude Code `2.1.319`. 실험적인 control API다. 새 버전·구버전에서 요청/응답을 확인해야 한다.

```text
claude -p --input-format stream-json --output-format stream-json --verbose
  --no-session-persistence --setting-sources "" --strict-mcp-config
  --settings '{"disableAllHooks":true}'
```

stdin/stdout 한 줄당 JSON. 순서는 initialize의 성공 응답을 받은 후 get_usage이다.

```jsonl
{"type":"control_request","request_id":"init","request":{"subtype":"initialize"}}
{"type":"control_request","request_id":"usage","request":{"subtype":"get_usage","skip_behaviors":true}}
```

응답 `type=control_response`, `response.subtype=success`, 동일 `request_id`를 매치한다. 본문은 `response.response.rate_limits`. generic은 five_hour/seven_day, Fable 등은 `model_scoped:[{display_name,utilization,resets_at}]`이다. `utilization:0`을 버리지 않는다. `extra_usage`의 credits는 이 한도 창과 혼합하지 않는다.

사용자 prompt를 보내지 않으며 CLI가 인증을 처리한다. 비활성 hooks·MCP, transcript 행동 분석 생략, 세션 미저장을 유지한다. stdout은 partial frame이 올 수 있으므로 newline까지 누적한다. 12초 후 실패 처리하고 프로세스를 종료/회수한다. 직접 조회는 300초 캐시, 수동 Refresh 예외. 구형 CLI/로그아웃/오프라인이면 raw/HUD 및 마지막 정상 캐시로 fallback한다.

`hm-statusline`은 stdin JSON 중 rate_limits만 `~/.herdr/usage/claude-raw.json`에 `{updated_at:epochSeconds,rate_limits}`로 기록하고, 뒤의 상태줄 명령에는 stdin 원문과 출력/exit code를 보존한다. ClaudeHUD fallback은 `{updated_at,five_hour,seven_day,model_scoped?}`. 창별 `used_percentage`도 허용한다.

## Codex 사용량

`codex app-server`의 JSON-RPC stdio:

```jsonl
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"herdr-usage-bar","version":"1"}}}
{"jsonrpc":"2.0","method":"initialized"}
{"jsonrpc":"2.0","id":2,"method":"account/rateLimits/read","params":{"excludeResetCreditDetails":true}}
```

기준 코드는 이 셋을 연속 전송한다. id=2 응답 `result.rateLimits`의 primary/secondary를 읽는다. 각 창은 usedPercent/windowDurationMins/resetsAt, 전체 planType/rateLimitReachedType. 300분 이하는 5h, 10000분 이상은 7d, 그 외는 시간으로 표시한다. 300초 캐시·12초 대기. CLI가 인증을 맡는다.

fallback은 rollout 끝 1MiB의 `event_msg`/`token_count`/`rate_limits`이다. primary/secondary의 used_percent, window_minutes, resets_at과 plan_type을 읽는다. 최근 날짜 폴더에서 최신 40개 rollout을 찾아본다. live와 logged를 시각으로 비교한다. 여기서 window_duration이 항상 5h/7d라고 가정하지 않는다.

## 세션·프로세스 연결

| 작업 | 계약 |
|---|---|
| Claude resume/fork | `claude FLAGS --resume ID [PROMPT]`; fork는 `--fork-session` 추가 |
| Codex resume/fork | `codex resume FLAGS ID [PROMPT]`; `codex fork FLAGS ID` |
| argv 보존 | 기존 resume/continue/session 선택 옵션과 원래 positional prompt를 제거하고, 값이 필요한 플래그와 값을 함께 보존. 세부 목록은 [resume.js](../../lib/resume.js)의 에이전트별 adapter |
| 목록/검색 | `sessions.py list PATH…`, `sessions.py search QUERY PATH…` → `[{agent,id,cwd,title,updated:seconds,snippet?}]` |
| 같은 에이전트에서 위치 이동 | `sessions.py move ID FOLDER [--from OLD] [--keep]`; 실행 중이면 거부. Claude는 transcript/cwd 변경, Codex는 `{agent,id,cwd,deferred:true}` 후 native `resume --cd`로 처리. 단순 보기 이동과 구별 |
| 원본 그대로 다른 폴더에서 fork | `sessions.py copy ID FOLDER [--from OLD]` → `{agent,id,cwd,copy}`; 실행 중이어도 됨. Claude는 FOLDER 의 프로젝트 폴더에 복사(copy=경로) 후 `--resume ID --fork-session`, `sessions.py drop-copy COPY ID FOLDER SINCE_MS` 가 fork 가 읽은 뒤(레지스트리에 새 id·status) 복사본을 지움. Codex는 복사 없이 native `fork --cd FOLDER ID` (새 rollout, 원본 불변) |
| 바깥 에이전트 | `ps`, `lsof`, Claude registry, Codex 열린 writer와 현재 인덱스; `outside.py` → `[{agent,pid,session,cwd,title,status,argv,app,bundle}]` |
| 활동 | `activity.py '[{"address":"…"},…]'` → `{address:{doing,said}}`; 기록 끝 최대 512KiB, 바뀐 세션만 파싱 |
| 세션 번역 | `translate.py export ID`; `import STD --to AGENT --cwd DIR`; `convert ID --to A,B [--cwd DIR]` |

밖의 프로세스 탐지는 기본 10초(활성 창), activity는 3초(비활성일 때 약 30초)다. macOS의 `ps/lsof` 출력과 부모 프로세스 관계에 의존하므로 Windows/Linux에서 그대로 동작한다고 간주하지 않는다. 터미널 ID→PID 매핑과 외부 앱 판별은 OS adapter로 교체한다. Codex 공유 서버는 `codex_live.py`의 전체 제목·cwd 유일 일치와 열린 writer로 보완한다(원격 클라이언트 제외, 모호하면 미식별). Python의 CODEX_HOME 지원과 JS sessionOf의 기본 Claude 경로 의존도 별도로 확인한다.

번역 CLI 결과: export `{std,path,agent,title,messages}`, 단일 import `{agent,id,cwd}`, convert/여러 import `{std,path,sessions:[{agent,id,cwd}]}`. 표준 파일 버전을 먼저 검사한다. 기준의 세션 파일 writer에 들어 있는 CLI version 문자열은 호환성 검증 결과가 아니다.

`usage.py --now`는 기존 수치 외에 `refresh:{claude:{ok,error},codex:{ok,error}}`를 반환한다. cache/fallback 수치가 있어도 직접 조회가 실패하면 ok=false다.

## `hm`의 사용자 계약

명령 이름은 새 앱에서도 유지하면 기존 스킬을 적은 수정으로 옮길 수 있다. 이름을 바꾸면 동일한 작업 표를 새 명령으로 연결한다.

| 명령 | 입력 / 결과 |
|---|---|
| `ls` | `--all`, `--json`; 로컬 checkout 목록, 현재 cwd 표시 |
| `new [NAME]` | `--repo --branch --base --link --agent --prompt --setup --copy --no-wait`; 완료 시 path, no-wait는 요청 접수만 |
| `add [DIR]`, `clone URL`, `project NAME` | clone `--into --host`, project `--in --host`; open/clone 예정 path 또는 생성 path와 note |
| `go [T]`, `sleep [T]` | 선택/깨우기, 세션 저장 후 공간 닫기. sleep은 요청 ID로 결과를 최대 30초 기다리고 식별 실패를 반환 |
| `pin/unpin`, `archive/unarchive` | checkout T의 해당 필드 |
| `set [T]` | `--name --comment --link --pr --status`; 비우기 지원 |
| `rm [T]` | `--force` 명시 여부; 안전 검사 후 삭제 |
| `clean` | `--repo`, `--review`; 제거 목록과 보류 이유 또는 UI |
| `term [T]` | `--agent --prompt --name`; 설치 argv로 새 탭 |
| `sessions [T]` | `--search --json`; 목록 또는 메시지 검색 |
| `resume ID` | `--fork --into --as`; 같은 ID 이어가기/새 fork/경로 이동/다른 에이전트 변환 |
| `translate ID` | `--to A[,B] --into T`; 새 에이전트 세션들 |
| `outside`, `usage` | `--json`; 수집기 결과 |
| `logs` (기준 이후 C03) | `--json`, `--watch`/`--once`/`--stop`/`--render`; 최근 50개 UI 오류 또는 렌더 집계 읽기·오류 기록·종료 요청. 세부 계약은 [UI 진단](../ui-diagnostics.md) |
| `sort` | activity/recent/name/created |
| `pin-agent [TERMINAL]` | `--off`; 생략 시 HC_TERMINAL_ID |
| `md FILE` | Markdown 파일 존재/확장자 검사 후 현재 에이전트 옆에 포커스 보존하며 표시 |
| `option [NAME VALUE]` | 생략하면 목록, 값은 on/off/number/선택값/default |
| `color REPO COLOR` | 색 이름/#rrggbb/auto; all auto 재배정 |
| `seen all 또는 TERMINAL…` | 실행 종료 없이 Done을 확인 처리 |
| `restore`, `skill` | 복구 질문 설정, 사용 안내 출력 |

T는 cwd/현재 공간, 절대·상대경로, 표시 이름, branch, repo/name으로 해석한다. ambiguous면 실패한다. `hm`의 checkout resolver는 현재 로컬 대상으로 제한된다. `--host`가 일부 명령에 있다고 모든 CLI가 원격을 지원하는 것은 아니다.

Herdr 전송은 `spaces-plus.<kind>@<JSON>` + 12자 request ID, `wt.results[request]`로 응답한다. 0.5초 폴링, 일반 120초/new 120초/clean 300초/doc 15초/option·color·seen 10초. 최근 20개 결과만 남는다. exit 1은 작업 실패, 구문 안내에는 exit 2가 쓰일 수 있다. 새 앱은 이 공유 JSON 폴링을 고집하지 않고 직접 응답 IPC로 교체해도 된다. **타임아웃은 작업 취소 보장이 아니므로** 재시도 전에 실제 결과를 확인한다.

## OS/UI/버전 경계

알림 도우미는 `~/Applications/HerdrNotify.app`, 미설치 실행 실패 시 osascript. 새 앱의 notification API가 클릭 대상 이동을 제공하면 대체 가능하다. 포트 표시는 로컬 listen socket/PID/cwd에 의존하며 원격 포트를 추정해 붙이지 않는다.

Herdr의 GPUI 타입 파일은 앱이 다시 쓰므로 실제 설치된 `gpui-kit.d.ts`/`herdr.d.ts`가 기준이다. 새 앱은 그 타입을 복제할 필요가 없다. 파일 읽기·원격 실행·취소·화면 크기 측정의 의미를 [host-contract](host-contract.md)에 맞춘다.
