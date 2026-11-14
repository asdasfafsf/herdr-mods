# Claude Code / Codex 기능 대조

2026-11-09, 로컬 Herdr와 Codex CLI 0.167.0 기준. 기능을 만들었던 이유는 각 mod의 WHY, 이식할 동작은 [behavior](porting/behavior.md)를 따른다. 이 문서는 지원 여부와 확인한 깊이를 구별한다.

| 기능 | 두 에이전트의 지원 | 이번 확인 |
|---|---|---|
| 새 에이전트·워크트리·첫 요청 | 공통 실행 설정과 argv 사용 | 코드 경로 확인 |
| 왼쪽 워크트리 아래 에이전트·클릭 이동 | 공통 pane/terminal 트리 사용 | 코드 경로 확인; 별도 오른쪽 목록은 추가하지 않음 |
| Working/Blocked/Done·Seen·pin·하위 에이전트 | Herdr가 보고한 상태를 공통 UI로 표시 | 공통 렌더 회귀 검사. 실제 모델의 모든 상태 전이를 유발한 검사는 아님 |
| 완료·승인 대기 알림 | 공통 상태 전이 처리 | 코드 확인. 이번 작업에서 OS 알림을 강제 발생시키지 않음 |
| 현재 도구·마지막 답 | 에이전트별 기록 파서 | Codex 공유 서버 세션 식별 보완 |
| 사용량·리셋 | 각각의 CLI 직접 조회와 기록 fallback | 기존 fixture 검사. 창 종류는 각 서비스가 제공하는 값이며 Claude Fable 창을 Codex에 만들지 않음 |
| 세션 목록·제목/본문 검색 | 각 기록을 읽는 adapter | Codex 현재 cwd·이름 인덱스 반영 검사 |
| Resume / Fork | 각각 native resume/fork argv | 양쪽 버튼 핸들러 검사, 임시 Codex 서버의 실제 ID resume/fork 성공. 호스트 run 함수와 지역 argv 변수 충돌 수정 |
| 시작 옵션 보존 | 에이전트별 플래그 parser | Codex enable/disable·oss·cd 보존 검사 및 옵션 목록 보완 |
| 재시작 복원 | ID/argv/cwd 저장 후 이어 열기 | 실제 복원 파일의 Claude 23개 + Codex 7개 확인. 앱 재시작·재부팅 자체는 미실행 |
| Sleep / Wake | 저장 후 창 닫기·다시 열기 | 미식별 세션이면 보존하는 경로와 저장/닫기 검사. 실제 작업 중 세션을 닫지는 않음 |
| 다른 워크트리로 이동 | 실행 중이면 거부 | Codex 열린 writer·JSONL 미수정 검사, 임시 native 서버에서 cwd 변경과 SQLite 반영 성공 |
| 외부 에이전트 | 읽기 전용 탐지 후 이어 열기 | 공유 서버의 여러 세션·내부 ID 제외 fixture. 실제 외부 목록의 고유 ID 확인 |
| Claude↔Codex 번역 | 중간 형식으로 새 ID 생성 | 변환 fixture와 합성 변환 기록의 실제 Codex resume 성공, 이동 뒤 export cwd·대화 보존 확인. 도구 기록은 텍스트이고 reasoning/이미지 등은 완전 복제하지 않음 |

## 이번 결함의 원인과 수정

Codex의 공유 app-server가 rollout/writer를 소유하고 TUI는 파일을 직접 열지 않는 경우가 있다. 이전에는 TUI PID의 열린 파일만 보았으므로 실행 중인 Codex 7개가 복원 파일에서 모두 빠졌다.

[공통 식별 helper](../lib/codex_live.py)는 직접 열린 단일 rollout을 우선한다. 없으면 현재 SQLite 인덱스·이름 기록에서 **전체 제목 + 실제 cwd가 유일하게 일치하고 writer lock이 실제 열려 있는** 세션만 사용한다. 최신 기록이나 cwd만으로 고르지 않는다. 같은 TUI PID가 세션을 바꿀 수 있어 PID만으로 영구 캐시하지 않는다.

식별 불가 상태에서 Sleep하면 대화를 잃을 수 있으므로 창을 유지하고 이유를 반환한다. CLI도 처리 결과를 기다린다. Codex가 이미 서버에서 실행 중이면 복원 시 자동 이어가기 요청을 기본 해제한다. 실행 여부 조회 실패도 이어가기 요청을 보내지 않는 쪽으로 처리한다.

Codex 이동은 SQLite와 기록 파일이 함께 관리되므로 JSONL cwd만 재작성하면 불일치가 생긴다. `hm resume --into`는 native `codex resume --cd`로 목적지를 전달한다. 같은 기록과 ID를 유지하며, Claude의 파일 복사 방식과 같지는 않다.

## 유지해야 할 차이와 한계

- 공유 서버의 제목/cwd 대조는 **공식 PID→세션 ID 연결이 아닌 추정**이다. 동일 이름·폴더, 생략된 제목, 이름 갱신 지연, 다른 CODEX_HOME, 미지원 DB 형식에서는 식별하지 못할 수 있다. 이식 호스트가 세션 ID를 직접 제공하면 그 값을 우선한다.
- 공유 서버는 터미널을 닫아도 작업할 수 있다. Sleep은 창 정리와 재연결 기능이며 서버 작업의 일시정지를 보장하지 않는다.
- 서버가 소유한 외부 세션의 원래 터미널 앱을 확정할 수 없어 `Codex server`로 표시한다. 자동 복원 기록과 외부 목록 사이에는 폴링 지연이 있다. 외부 TUI의 중복 접속을 모두 판별하는 공식 매핑은 없다.
- 원격 세션 조회·이동·자동 식별은 지원 범위 밖이다. 로컬 인덱스로 원격 `--remote` 클라이언트를 추측하지 않는다.
- CLI의 새로운 플래그·DB 스키마·기록 형식은 adapter를 다시 확인해야 한다. 사용량 창, 모델 전용 기능, 도구 이름, 승인 정책 자체를 두 제품에서 같게 만드는 것은 이 mod의 기능이 아니다.
- 실제 재부팅 복구, 사용 중인 대화의 이동, OS 알림 권한까지 이번 검사로 통과했다고 간주하지 않는다.

## 다시 검사하기

```sh
python3 -m unittest discover -s tests -p 'test_*.py'
node --experimental-vm-modules tests/session-parity.mjs
node --experimental-vm-modules tests/agents-render.mjs --before 7b446e6 --native
python3 scripts/check-porting-docs.py
python3 tests/native_codex_sessions.py  # 설치된 Codex, 임시 CODEX_HOME 사용
./install.sh restore worktrees agents palette usage commands
```

단위 Python/JS 검사는 임시 파일·호스트 stub으로 실행하며 기존 사용자 세션을 종료하지 않는다. native 렌더 검사는 실제 Herdr 런타임의 view 생성 검사이며 실제 모델 응답이나 재부팅 검사가 아니다. 설치 후에는 앱 상태·스크린샷과 `~/.herdr/restore/last.json`의 세션 저장을 별도로 확인한다.

`native_codex_sessions.py`는 임시 CODEX_HOME에 합성 대화를 만들고 실제 stdio app-server의 thread/resume·thread/fork와 SQLite cwd를 검사한다. 사용자 세션·인증 파일을 복사하지 않으며 turn/start(모델 요청)는 호출하지 않는다. CLI TUI 화면 전체 조작과는 별도의 서버 통합 검사다.
