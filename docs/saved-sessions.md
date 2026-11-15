# Saved 세션과 네이티브 앱 연결

Saved는 priority/grouped 정렬 모두에서 Idle을 포함한 live 그룹 아래에 표시된다.
중립적인 history 표시는 공통 상태 정의를 사용하며 `ag.info`/`ag.order`에 live agent를
만들거나 Cards/Village 주민을 추가하지 않는다. Herdr에 붙은 세션과 Outside에 이미
표시된 세션은 중복하지 않는다.

기본은 접힘이며 헤더에서 명시적으로 선택한 펼침/접힘을 로컬 설정에 저장한다.
Refresh, 주기적 갱신, 정렬 변경, sidebar 축소/복귀와 view 재생성 뒤에도 선택을 유지한다.
Claude와 Codex는 같은 Saved 영역과 설정을 사용한다. 다른 provider의 기록은 현재
지원하지 않는다.

펼치면 처음에는 8개, Show more로 최근 60개까지 표시한다. 활성 창의 펼친 sidebar에서
45초마다 읽고 Refresh로 갱신한다. active·unknown 기록도 다른 위치에 표시되지 않았다면
Saved에 남기고 이유를 보여 준다. 목록의 소유권 스냅샷은 실행 허가가 아니다.

## 탐색과 읽기 전용 계약

`mods/agents-plus/saved.py`는 파일/메타데이터와 프로세스 소유권만 읽는다.

- 기본 출력: `{rows, errors}`. 기존 row 필드 `{agent, session, cwd, title, updated}`를
  유지한다. ID는 UUID, cwd는 존재하는 절대 경로, updated는 epoch seconds다.
  선택 필드 `origin`, `historyMode`, `handoff: {state, reason}`은 설명용이다.
  history에는 실행할 argv를 넣지 않는다.
- `check JSON`: 같은 ID와 cwd를 다시 읽고 삭제·archive·internal·미지원 기록을
  거부한다. 공통 `session_handoff.inspect_session`으로 정확한 세션의 소유권을 확인한다.
  기존 `{running, record}`에 `handoff`를 추가한다. unknown/missing/unsupported는
  이유와 함께 nonzero로 실패한다. active는 `running: true`이며 UI가 실행을 막는다.
- provider당 최대 300개 후보와 64 KiB 본문 발췌, 64 KiB 이름 index tail을 읽는다.
  Codex의 첫 헤더는 공통 reader의 최대 2 MiB 한 줄 제한을 사용한다. SQLite 조회는
  최근 후보 및 정확한 ID로 제한한다. 파일명/mtime 탐색 자체는 전체 history tree를
  열거할 수 있으므로 전체 보관함 검색으로 보장하지 않는다.

Codex는 `codex_session_kind(record, firstHeader)`를 목록과 guard에서 함께 사용한다.
`source=vscode`만 있으면 editor이며, 알려진 desktop originator가 있어야 Codex app으로
표시한다. originator는 재개 과정에서 바뀔 수 있어 영구적인 최초 출처가 아니다.
object/JSON string의 `source.subagent`와 `attached_thread_parent_id`를 먼저 제외하고,
exec·알 수 없는 현대 출처·archived 기록도 제외한다. source가 없는 구형 CLI는 실제
ID가 있는 첫 헤더와 origin/history 표식 부재를 확인하는 동일한 기준을 적용한다.

paginated history는 JSONL에 메시지 본문이 없어도 index의 제목으로 탐색한다. 실제
대화는 같은 ID의 native resume/history 기능이 읽으며 transcript를 복제하거나 변환하지
않는다. `historyMode`는 기록 형식 설명이지 desktop 판정이나 실행권 증거가 아니다.

`codex_metadata(limit=None, sessions=None, *, session=None)`는 기존 제한·복수 ID 조회와
native의 정확한 ID 조회를 함께 지원한다. 이전 native 호출의 positional string ID도
호환하며, 새 호출은 `session=`을 권장한다. 존재하는 optional 컬럼만 읽어 구형 schema의
제한 조회도 유지한다. `codex_names(tail=None)`의 기본 동작도 유지한다.

## 클릭, 공통 검사와 중복 실행 방지

Saved는 먼저 현재 Herdr live terminal을 확인한다. 이미 붙었으면 focus하고 새 client를
실행하지 않는다. 읽기 전용 check가 끝난 뒤에도 attachment를 다시 확인한다.
`savedResumeRecord`는 설치된 실행 설정만 받아 같은 provider/ID/cwd를 전달하고,
이전 세션 selector·첫 prompt·Codex 시작 cwd/image를 제거한다. remote 실행 설정은
로컬 history에 사용할 수 없다. 암묵적인 fork나 자동 첫 메시지는 없다.

`spaces-plus.resume@JSON` 경로와 standalone fallback 모두 `resumeSession`을 사용한다.
공유 launch reservation을 잡은 다음 fresh provider preflight를 수행한다. ready만 새
client를 허용하고 active/unknown은 거부한다. 새로 확인한 cwd가 요청과 다르거나 확인할
수 없으면 기존 폴더로 재개하지 않는다. preflight 중 붙은 terminal은 결과가 active거나
실패해도 focus한다. exited terminal 또는 shell/다른 provider로 돌아온 terminal을 가리키는 오래된 LIVE
매핑은 focus하지 않고 Saved에서도 해당 기록을 숨기지 않는다. foreground argv가 있으면
우선 사용하고, 그렇지 않으면 현재 host program의 agent/key를 확인한다.
같은 wrapper를 outside, session picker, `hm resume`도 사용한다.

Saved는 비동기 resume를 기다린다. worktrees 위임 시 request ID의 `wt.results` 응답을
최대 30초 기다려 guard 실패를 Saved 오류에 반영하고 pending을 해제한다. 응답 성공은
preflight 및 launch 명령 처리의 확인이며, CLI가 실제로 대화를 열었다는 확인은 아니다.
공유 reservation과 Saved pending은 실행 명령 뒤 15초 동안 중복 클릭을 억제한다.
외부 앱과의 원자적 lease가 아니며 최종 Codex 경쟁은 native writer lock이 거부한다.
Claude Code의 registry 검사는 같은 수준의 원자적 보장을 제공하지 않는다.

## 실제 전환의 한계

Idle, 응답 완료, 다른 대화 화면 선택은 writer 해제 증거가 아니다. 기존 client가 writer를
놓지 않았다면 이유를 표시하고 기다린다. 자동 writer release, 사용자 앱/daemon 종료,
재시작은 구현하지 않는다. 다시 앱에서 이어가기 역시 Herdr 쪽 writer가 해제되어야 한다.
`nativeSessionUrl`은 같은 ID 주소를 생성하는 helper이며 Saved의 자동 앱 전환 기능은 아니다.

독립 기능의 설치 실행기 왕복 증거와 범위는 [native-app-sessions.md](native-app-sessions.md)에
있다. 동일 ID/history 호환과 실제 데스크톱 화면의 갱신 UX는 별개다. 이 통합의 합성
검사만으로 실제 UI 왕복이나 앱 전용 도구·첨부·권한의 완전한 호환을 주장하지 않는다.

`test_saved_sessions.py`, `test_session_handoff.py`, `session-handoff.mjs`,
`agents-render.mjs`에 분류·신규 schema·bounded/exact API·차단 이유·cwd 변경·중복 예약·
exited LIVE·attachment race·비동기 실패의 회귀 검사가 있다. workspace runner에 포함한다.
모든 검사는 합성 transport 또는 격리 임시 세션을 사용하며 실제 대화에 테스트 입력을
보내지 않는다. reset/redemption 실행 경로는 mock으로도 검사하지 않는다.

## 기본 접힘 통합 검증 (2026-11-15)

`40bc294`를 YOLO, usage, Cmd+E, perf 감사, provider 검증이 통합된 `f5f3029`
위에 병합했다. 충돌 없이 Saved 변경과 기존 YOLO argv/terminal-toolbar 검사를 보존했다.
Saved 기본 접힘·명시적 선택 유지 합성 검사, `test_saved_sessions.py` 12개,
`agent-launch.mjs` 81개가 통과했다.

첫 `test-agent-workspace.py --native --seed 20261116` 실행은 29개 통과,
`agents-render.mjs` 1개 실패였다. 그 안의 native 11개 중 `chiikawa/200`만
`village.js`의 `advanceVillage`에서 `interrupted`로 중단됐고 나머지 10개는 통과했다.
원인은 미확정이며 Saved 수정에는 Village 코드 변경이 없다. 별도 임시 app home에서
`agents-render.mjs --native --overview-only`만 다시 실행해 합성 검사와 native 11개
모두 통과했다. 최초 실패를 전체 suite 통과로 바꿔 기록하지 않는다.

Native 검사는 임시 합성 mod의 초기 렌더 검사이며 실제 화면·입력·localStorage의
지속성을 검증하지 않는다. Saved의 실제 CUA 검증은 조정자 t28에게 남겨 두며,
그 승인 전에는 이 단위를 main에 push하지 않는다.
