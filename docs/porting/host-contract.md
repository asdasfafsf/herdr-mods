# 새 앱과 연결하는 경계

이 문서의 API 이름은 **이식용 제안 계약**이다. 현재 레포에 이 이름의 SDK가 구현되어 있지는 않다. 목적은 새 앱을 바꿀 때 업무 규칙까지 다시 작성하지 않도록 교체 지점을 정하는 것이다.

## 공통 식별

- `CheckoutRef = { machine, path }`: `machine: null`은 로컬, `path`는 해당 머신의 절대경로. 레포 이름·브랜치 이름만으로 식별하지 않는다.
- `SessionRef = { agent, id }`: Claude와 Codex의 세션 ID는 앱의 탭 ID와 다르다.
- `WorkspaceRef`, `TerminalRef`, `PaneRef`: 새 앱이 발급하는 불투명 ID. Herdr ID를 그대로 복사하지 않고 이전표로 대응한다.
- 시간은 계약에서 `*Ms`를 epoch 밀리초, `*Seconds`를 epoch 초로 명시한다. 기존 파일의 혼합 단위는 [data.md](data.md)에 따른다.

## 기능별 최소 연결부

| 연결 계약 | 요청·응답 / 실패 의미 | Herdr 기준 연결 | 필요한 기능 |
|---|---|---|---|
| `execute(machine, argv, cwd, deadline)` | 인자를 배열로 받고 `{exitCode, stdout, stderr}` 반환. 실행 불가·시간 초과를 구분 | `exec` (30초, 출력 8MiB) | Git·수집기·프로젝트 준비 |
| `listWorkspaces()` / `listTerminals()` | 경로·머신·탭·pane·실행 프로그램·상태·현재 포커스 | `spaces`, `panes`, `agents`, `hc ls/get` | 트리·중복 열기 방지·복구 |
| `openWorkspace(checkout, title, argv?, prompt?)` | 요청 접수와 실제 터미널 준비 완료를 구분 | `run("space.new", …)` | 워크트리·프로젝트 생성 |
| `openTerminal(workspace, cwd, argv, title?)` | 지정된 폴더·실행 옵션으로 터미널 생성 | `tab.new` | 새 터미널·Resume·Fork |
| `focusWorkspace/Terminal/Pane(id)` | 포커스 이동 결과; 존재하지 않는 ID는 실패 | `space.select`, `agent.focus`, `pane.focus` | 이동·팔레트·알림 클릭 |
| `closeWorkspace(id, disposition)` | UI만 닫기/터미널 종료/기록 보존의 의미를 명시 | `space.close` | Sleep·삭제. 새 앱의 close가 프로세스를 유지하면 별도 종료 필요 |
| `readTerminalState(id)` / `resumeInShell(id, cwd, argv)` | 대상이 비어 있는 셸인지 확인한 후만 실행 | `hc get`, `hc send` | 충돌 없는 재시작 복구 |
| `runtimeIdentity()` | PID만이 아닌 시작 세대 식별자 | `hc server status`의 pid·uptime | 창 재시작과 터미널 런타임 재시작 구분 |
| `loadState(key)` / `saveState(key, value)` | 영속성·동시 쓰기·실패를 명시; 복구 상태는 즉시 내구성 확보 | `shared`, `setShared`, `writeTextFile(expected)` | 메타데이터·Sleep·설정·복구 |
| `readFile/watchDirectory(machine, path)` | 삭제/권한/오프라인 구분, 감시 취소 가능 | `readTextFile`, 파일 감시, 원격 폴링 | 문서·Git·기록 갱신 |
| `agentPrograms(machine)` | 설치 여부와 실행 argv; 문자열 shell alias에 의존하지 않음 | `knownAgents`, `programs.json` | 새 에이전트·복구 |
| `onAgentsChanged/onFocusChanged/isActive()` | 상태·포커스·앱 활성 이벤트 | Herdr render 갱신, `window().active` | Active·Seen·알림 |
| `openDialog/Popup/View(spec)` | 입력·선택·취소·포커스 제어, 비동기 결과 전달 | `openOverlay`, mod pane | 메뉴·세션·문서·상세 한도 |
| `splitDocumentPane(anchor, file, focus)` | 같은 탭/파일/머신이면 재사용, focus=false면 사용자 입력 보존 | `pane.split`, `md.panes` | 문서 보기 |
| `systemNotification(message, target)` | 허용 안 됨과 도우미 부재 구분; 클릭 시 target으로 이동 | HerdrNotify / osascript | 백그라운드 완료·승인 알림 |
| `registerCommand/Shortcut(name, handler)` | 버튼과 동일한 업무 함수를 호출; 결과·오류 반환 | `nextCommand`, `hm`, keys.json | 에이전트 명령·단축키 |
| `openExternal/copyText/pickFolder` | URL·파일을 구별; 파일 내용을 명령으로 실행하지 않음 | OS opener·clipboard·pickFolder | 행 메뉴·링크·프로젝트 |

## 없어도 되는 연결부

기본 파일 선택 창이 없으면 경로 입력으로, 옆 pane이 없으면 재사용 가능한 문서 탭으로, 시스템 알림이 없으면 새 앱의 알림 센터로 대응할 수 있다. 이는 합의된 대체 동작으로 기록한다. **포커스를 빼앗지 않는다**, **이미 열린 대상을 중복 생성하지 않는다** 같은 원래 결과는 유지한다.

원격 실행을 제공하지 않는 앱은 원격 기능을 `지원 불가`로 표시해야 한다. 로컬 경로로 실행하거나 원격 실패를 “폴더가 삭제됨”으로 처리해서는 안 된다. 상태 보고가 없는 에이전트는 unknown으로 다루며 임의로 working/done을 추정해 삭제·알림을 결정하지 않는다.

## 명령과 UI의 일치

`CreateWorktree`, `RemoveWorktree`, `CleanWorktrees`, `CloneProject`, `CreateProject`, `OpenDocument`, `ResumeSession`은 버튼과 CLI가 공유하는 업무 함수로 둔다. 사용자 확인 창은 UI 어댑터에서만 다루고, 함수에는 승인된 선택과 `force`를 전달한다. 실패를 성공 문자열로 바꾸지 않는다.

현재 Herdr는 `run` 호출 뒤 UI 객체 생성이 지연될 수 있어서 일부 기능이 폴링한다. 새 앱이 완료를 await할 수 있다면 그것을 사용한다. 150ms/250ms 폴링 자체는 이식할 기능이 아니다.

## 새 앱 평가표

아래 표를 앱별로 작성한 다음 구현량을 정한다. 아직 특정 새 앱에 대한 평가를 수행하지 않았다.

| 기능 ID | 새 앱 기본 기능 | 연결부 | 부족한 결과 | 판정 | 확인 근거 |
|---|---|---|---|---|---|
| 예: B01 | 저장소 트리 | 체크아웃 목록 공급 | 열지 않은 worktree가 안 보임 | 연결+추가 구현 | 샘플 레포의 미개방 worktree 확인 |

기본 지원 여부는 [acceptance.md](acceptance.md)의 결과로 판단한다. “워크트리 지원”이라는 설명만으로 Sleep·메타데이터·안전한 정리까지 지원한다고 간주하지 않는다.
