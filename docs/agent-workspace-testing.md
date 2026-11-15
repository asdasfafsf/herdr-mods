# Agent workspace 별도 테스트

실행 중인 앱에 설치하지 않고 공통 에이전트 화면을 검사할 수 있다.
저장소 루트에서 다음 명령을 실행한다. Node.js와 Python 3이 필요하다.

```sh
python3 scripts/test-agent-workspace.py
```

선택한 테스트 23개를 실행하고 각 검사의 PASS/FAIL, 종료 코드, 실행 시간,
명령, 커밋, 변경 중인 파일 목록을 임시 리포트 폴더에 남긴다.
마지막에 출력되는 `summary.txt`와 `report.json`, 개별 `.log`를 확인한다.
하나라도 실패하면 runner도 0이 아닌 종료 코드를 반환한다.
전체 테스트 자동 탐색이나 임의 명령 실행 기능은 제공하지 않는다.

## 실제 GPUI 초기 요소 생성 검사

`herdr-app`이 PATH에 있으면 다음처럼 실행한다.

```sh
python3 scripts/test-agent-workspace.py --native
```

같은 synthetic 세션을 실제 GPUI builder로 처리하는 7개 초기 렌더 시나리오가
`agents-render.mjs` 검사에 추가된다. 임시 mod만 `herdr-app check`로 검사하며,
새 앱 창이나 코어를 시작하지 않는다. 기존 사용자 레이아웃에 mod를 설치하지 않는다.

**이 검사는 GUI 전체 검증이 아니다.** 호스트의 `check`는 초기 요소 생성만
검사한다. 실제 화면 배치, GPU 이미지 디코딩, 팝업 위치, 긴 GIF 재생, 비동기
상태, 실제 터미널 통합까지 통과했다고 해석하면 안 된다. 실제 세션 입력이나
리셋권 실행·테스트(mock 포함)는 이 suite에 없다. 승인·메시지 관련 fixture는
외부 연결 없는 synthetic transport만 사용한다.

## 반복·재현

```sh
# 전체 검사를 세 번, 서로 다른 전환 seed로 실행
python3 scripts/test-agent-workspace.py --native --repeat 3

# 실패한 실행의 seed로 재현
python3 scripts/test-agent-workspace.py --seed 20261116

# 전환 스트레스 검사만 빠르게 재현
node --experimental-vm-modules tests/theme-adapters.mjs --seed 20261116

# 실행하지 않고 고정된 검사 목록 확인
python3 scripts/test-agent-workspace.py --native --list
```

팩 검사는 매 실행마다 앱 팔레트·팩·Cards/Village·Pause·드래그·상태 변경을 400단계 혼합 시퀀스로
재현 가능한 순서로 섞는다. 그동안 선택·초안·첨부 참조·native focus·원래 split이
유지되고 예상하지 않은 host 명령이 발생하지 않는지 확인한다.
`--repeat`는 1–20을 지원하며 매 반복마다 seed를 1씩 올린다. 이는 변경 조합을
늘리는 검사이지 실제 GPU에서 400번 사용해 본 결과는 아니다.

## 격리 범위와 결과 읽기

| 검사 | 격리 방법 | 확인하는 것 |
|---|---|---|
| 동작·상태·입력 | Node VM의 synthetic Herdr host | 공통 함수·이벤트 처리, 전환 불변 조건 |
| 설치·업데이트·실패 복구 | 임시 앱 홈과 설치 checker stub | 파일 구성·소유권·원복, 설치된 모듈 로딩 |
| 이미지 리소스 | 저장소 파일 읽기와 `--check` 생성기 | 프레임·원본 해시·방향 wrapper 일치 |
| native 초기 렌더 | 임시 mod의 `herdr-app check` | 실제 GPUI API·초기 요소 생성 |

runner는 실행마다 새 `HERDR_APP_HOME`과 `TMPDIR`을 사용한다. HOME은 변경하지
않으며 실제 앱 설정·인증·대화 기록을 테스트 홈으로 복사하지 않는다. 설치 fixture도
별도의 임시 홈만 쓴다. 프로세스 시작·파일 쓰기는 테스트 도구와 그 임시 데이터에
한정되며 실제 provider 프로세스를 실행하는 테스트는 목록에 없다.
generator는 항상 `--check`로 실행한다. timeout/중단 시 해당 fixture 프로세스
그룹을 종료하고 임시 홈을 정리하며, 그때까지의 로그는 리포트 폴더에 남긴다.

리포트에는 native 시나리오 7개를 각각 별도 suite로 중복 계산하지 않는다.
예를 들어 `--native --repeat 3`의 `69 passed`는 고정 검사 23개 × 3회를 뜻한다.
개별 assertion 개수와 native 시나리오 결과는 각 로그에서 확인한다.

### Saved-session history fixtures

`test_saved_sessions.py` uses temporary Claude/Codex transcripts and a read-only
SQLite fixture. It checks external history, bounded reads, current names/folders,
archived/internal exclusions, malformed/missing files and fail-closed process
ownership. `agents-render.mjs` checks the section after Idle, pagination, live
deduplication, no village residents, click-time revalidation and exact-session
Claude/Codex resume payloads with a synthetic host. Neither test resumes a real
conversation. The optional native sidebar fixture includes saved rows; this
feature's actual app validation is a separate integration step.

### 주민 간격 회귀 검사

`village-motion.mjs`는 실제 `advanceVillage`와 `renderVillage`를 synthetic host에서
실행한다. 같은 높이에서 접근하는 주민의 이름표가 겹치던 경로, body 기준 확대된
Rakko의 content 돌출, 양방향/atlas 및 motion resource 변경, 이름표의 명시 높이와
텍스트 줄·padding·border 합계, 상태표시·말풍선과 그림 사이의 교차를 검사한다.
240/360/700/1400px 장면의 4/24명 배회, 선택 정지, 겹친 시작점과 말풍선 내부에서
탈출, 실제 drag handler, resize/filter 재진입도 고정된 seed/clock으로 재현한다.

공통 `village-spacing.js`는 모든 motion content를 포함하는 보수적인 사각 영역을
예약한다. 조밀한 장면은 세로 스크롤 공간을 늘린다. 정상 이동은 속도를 유지하며
기존 지면 높이 위로 올라가지 않는다. 빈 방향으로 돌아서고, resize/filter/팩·표시 영역 변경이나 드래그 종료 후 갇힌
경우에는 겹친 unlocked 주민만 가까운 빈 공간에 한 번 재배치한다. 시계가 멈춰
있으면 재배치를 보류한다. 지면과 고정 말풍선 사이에서 기존 겹침을 벗어나려는
시도가 0.75초 동안 막힌 경우에도 해당 unlocked 주민에만 빈자리 복구를 적용한다.
선택 좌표는 접근 가능한 범위에서 유지하고, 축소로
장면 밖에 고립될 때만 안쪽으로 보정하며 드래그 중 포인터 소유권은 유지한다.

렌더 트리와 예약 영역의 수치 일치 검사는 native 화면의 글꼴 래스터화, GPU 그림
디코딩이나 최종 시각 배치를 확인한 것이 아니다. `agents-render.mjs --native`는
새 모듈도 임시 fixture에 복사하며, bundle matrix는 임시 설치본에 포함되는지 검사한다.
팩 정의·resident·크기별 content 영역을 캐시하고 이동 단계의 spec을 렌더에 재사용한다.
초기/정지 프레임은 충돌 계산을 생략하며, 영역 변경은 참조 비교로 판정한다.
native 200명 시나리오도 기존 실행 제한으로 검사한다.

## 별도 GUI 미리보기는 왜 아직 실행하지 않는가

현재 확인한 CLI에는 독립 GUI preview 명령이 없고, `HERDR_APP_HOME`은 앱 창의
설정·제어 대상을 분리하는 값이다. 이것만으로 herdr-core의 세션까지 분리된다고
판정하지 않는다. 따라서 이 runner는 `herdr-app`을 인수 없이 실행하거나,
`hc server`를 시작·재시작하거나, 기존 앱에 테스트 layout을 추가하지 않는다.

실제 시각적 검증은 코어 연결 격리가 확인된 별도 개발 환경에서 공통 view와
synthetic host를 사용해야 한다. 그 전까지 위 자동 검증과 실제 화면 검증의
차이를 명확히 남긴다. HTML로 화면을 다시 구현한 모형을 native 검증 대신 쓰지 않는다.


## 통합 설치 후 확인 (2026-11-15)

`db77407`의 통합 소스에서 atlas 생성기까지 포함한 22개 검사가 통과했다.
`c686b23` 설치 후 CUA로 Plain → Chiikawa 복귀와 Cards ↔ Village 전환을
확인했다. 앱 팔레트, Active 세션과 터미널 분할은 유지됐다. Working은 작은
상태 표시만 남고 Done은 말풍선을 사용한다. 쿠리만쥬의 좌우 이동과 방향 전환에
따른 그림 반전도 관찰했다. 연속 프레임 캡처로 반복 경계의 깜빡임을 측정한
검사는 아니며, 승인 버튼 전송은 합성 transport 검증만 수행했다.

같은 날 `52acb58`을 기준으로 두 worker worktree의 clean 상태, 원격과의 일치,
최종 커밋의 main 포함을 직접 확인했다. 설치된 agents-plus 777개와 usage-bar
4개의 비문서 추적 파일도 저장소와 일치했다. `--native --seed 20261116`으로
22개 검사를 다시 통과했다.

CUA로 moss 다크 팔레트와 Chiikawa 팩을 함께 사용했을 때 미선택 주민 이름이
밝은 배경에 묻히는 문제를 발견했다. 공통 이름표에 `raised` 배경과 의미 토큰을
적용하고, `agents-render.mjs --native --overview-only` 및 설치 검사를 통과한 뒤
실앱의 light/dark 양쪽에서 대비 개선을 확인했다. 팩·Active 세션·터미널 분할은
유지됐고 검증 후 기존 Light/Chiikawa 팔레트로 복원했다.

이 시점에는 주민이 가까워지면 그림이나 이름표가 다른 이름표를 일부 가리는
문제가 남았다. 당시 이동 충돌 검사는 이름표 전체 영역을 예약하지 않았다.
또한 다크 전환 후 기존 Codex 입력·사용자 메시지의 밝은 배경이 남았다.
읽기 전용 theme compatibility checker는 light=`herdr-chiikawa`, dark=`moss`와
중복 팔레트 상태 없음은 확인했지만, 설치 CLI 0.1.15의 native surface 기능은
`unknown`으로 보고했다. 이를 앱 렌더러 지원이 확인된 것으로 해석하지 않는다.
앱·core·실제 세션을 재시작하거나 입력하지 않았다.

### 주민 간격 수정 통합 및 실제 화면 확인

별도 `fix/resident-spacing`의 `28deb52`를 검토하고 `705bc96`으로 main에
병합했다. 수정 전 `6616518`은 실제 village 엔진을 사용하는 접근 fixture에서
frame 9, dx=135px에 이름표 교차를 재현했다. 수정본은 worker의
`--native --seed 20261116`과 main의 `--native --seed 20261117`에서 각각
22 passed, 0 failed였다. worker의 native Chiikawa 200명 초기 렌더는
74ms, interrupted=false로 기존 실행 제한을 통과했다.

`./install.sh agents` 후 실제 Herdr 화면을 CUA로 확인했다. Rakko의 돌출된
글자 그림 위에 상태 표시가, 전체 그림 아래에 두 줄 이름표가 따로 표시됐다.
선택한 Rakko를 Usagi 위로 드래그하면 놓은 직후에는 겹침이 보였으나,
후속 관찰에서 Usagi가 벗어나 그림과 이름표가 분리됐다. Light/Chiikawa와
Dark/Moss 모두 이름표의 두 줄이 잘리지 않고 읽혔다. 팩은 Chiikawa로 유지됐고,
검사 후 Light/Chiikawa와 기존 main의 Active 세션으로 복원했다.
설치된 agents-plus의 비문서 추적 파일 778개가 main과 일치했다. 두 수정
브랜치를 main에 push한 뒤 Herdr 작업트리와 병합된 로컬·원격 브랜치를
정리했으며 이 저장소에는 main 작업트리만 남았다.

이는 실제 세 주민의 배치·이동·드래그 복구를 확인한 것이다. 좁은 장면과
4/24명 밀도는 위 자동 검사 범위이며, 모든 GPU 프레임이나 장시간 배회를
측정한 결과로 확대 해석하지 않는다. selected/dragged 주민끼리의 겹침은
선택과 포인터 소유권을 우선하고 잠금 해제 후 복구한다.

### 터미널 배경 진단과 적용 대기

별도 `fix/terminal-surfaces`의 `212e90d`는 실행 파일 경로·해시 증거와
native 회귀 검사를 보강했다. 실행 중인 앱과 PATH의 `herdr-app`은 같은
symlink target 및 SHA256(`31ae7a64…`)였다. 0.1.15의 버전 응답만으로
renderer 지원을 확정할 수 없으며 실제 앱은 capability를 광고하지 않았다.
모드 API만으로 이미 기록된 Codex RGB 배경을 바꾸는 live fix는 불가능했다.
CUA의 Dark/Moss 전환에서도 기존 입력·사용자 메시지의 밝은 배경이 남았다.

기존 optional native renderer는 정확한 Chiikawa → Moss 전환에서 추가
PTY 출력 없이 기존 입력과 scrollback을 다시 칠하고 ANSI 구문색을 보존하는
회귀 검사를 통과했다. checker Python 13개, standalone Rust 9개와 native
필터 9/8/1개가 통과했고 offline/locked arm64 빌드를 완료했다. 메인 담당자도
Python 13개와 정확한 전환 native 회귀를 직접 다시 통과했다.

검증한 dev 실행 파일과 manifest, patch, LICENSE, 보고서는 로컬
`~/.local/share/herdr-mods/artifacts/native-surfaces-212e90d/`에 보관했다.
실행 파일 SHA256은
`953b605b0b2d83d5ac6200269e07d228376d00d3492d7cf5335ca667f52950ef`이며
두 surface capability가 supported다. 공식 서명된 배포 앱 번들이 아니며
이 단계에서는 해당 실행 파일의 실제 GUI 검증을 하지 않았다. 기존 앱을
교체하거나 재시작하지 않았고 별도 확인을 기다렸다. 활성화 후에는 해당
Codex PID가 Chiikawa opt-in을 관찰한 뒤 Moss로 전환하는 경로를 확인해야 한다.

### 승인 후 native 적용 및 실제 화면 검증 (2026-11-15 오전)

사용자가 적용과 직접 테스트를 요청한 뒤 공식 앱 전체를 복구용으로 보관했다.
검증한 실행 파일을 기존 앱의 리소스·Info.plist·entitlements와 함께 로컬
ad-hoc 서명하고 `codesign --verify --strict`를 통과했다. Herdr 앱만 정상
종료한 뒤 번들을 교체하고 CUA로 다시 열었다. 코드 서명을 추가한 설치
실행 파일의 SHA256은
`d8484d1326bc6905d66cf87520da1d6a0a1fb915905dc59be425271cacfd5694`다.
실행 PID `34061`의 경로와 설치본 해시를 확인했고 checker는 두 surface
계약을 모두 `supported`, 설치 상태를 `capabilities_verified`로 보고했다.

core PID `69831`, holder PID `69886`와 기존 live 터미널 8개의 ID, 생성 시각,
root PID, foreground PID가 교체 전후 모두 같았다. 기존 세션을 재시작하지
않았다. 앱의 원래 main 탭, Village/Chiikawa 팩과 터미널 분할도 유지됐다.
설치된 agents-plus 비문서 파일 778개는 저장소와 계속 일치했다.

CUA로 실행 중인 세션과 출력이 멈춘 기존 세션에서 Chiikawa → Moss →
Chiikawa를 확인했다. 입력창과 기존 사용자 메시지는 각 테마의 배경으로
바뀌고 글자가 읽혔다. 과거 출력으로 스크롤한 뒤에도 배경이 바뀌었으며
보이는 빨강·파랑·초록 ANSI 글자색은 구분을 유지했다. 정지 세션의 테마
전환 전후 `hc read` 텍스트 해시는 동일했다. 이 비교는 출력 텍스트 보존
확인이며 PTY 전체 바이트를 계측한 것은 아니다. Edit의 추가·삭제 배경은
이번 CUA에서 따로 찾지 않았고 기존 native 셀 회귀 검사 범위로 남긴다.
테스트 메시지·승인 입력·reset-credit 실행은 하지 않았다. 검증 후 원래
Light/Chiikawa와 main의 Active 세션으로 복원했고 앱 오류 목록은 비어 있었다.

복구용 공식 앱과 적용 기록은 로컬
`~/.local/share/herdr-mods/artifacts/native-surfaces-212e90d/activation-20261115/`에
있다. `official.noindex/Herdr.app`이 원본이며 `activation.json`에 설치 해시,
프로세스 보존 및 CUA 결과를 기록했다. 이 소스 빌드는 upstream 정책상
앱·core 자동 릴리스 확인을 실행하지 않는다. 공식 배포 서명이나 자동
업데이트까지 제공하는 설치로 해석하지 않으며 이후 갱신은 별도로 관리한다.

추가 개선 후보는 다음과 같다. 현재 `resident-assignment.js`의 배정은 view
메모리에만 있어 재시작 후 같은 세션의 캐릭터가 달라질 수 있다. 세션별
배정 저장이 식별 일관성을 높인다. `pack-chiikawa.js`에서 방향별 motion
정의가 있는 주민은 Kurimanju뿐이고 다른 주민은 기본 동작을 사용하므로,
실제 이동용 artwork 보강이 다음 시각 개선이다. 로컬 native 빌드의 갱신·복구
절차와 적용 여부 진단을 묶으면 다음 앱 업데이트에서도 유지하기 쉬워진다.

## 세션 통합 회귀 검사

기본 runner는 saved history, provider handoff, Codex/activity discovery, session parity도
포함한다. Saved의 native/editor/legacy 분류와 paginated metadata, active/unknown 설명,
fresh cwd 변경 거부, shared launch reservation, stale LIVE와 preflight attachment race,
standalone/위임 resume 실패 전파를 합성 transport 및 임시 파일로 검사한다.
네이티브 화면과 실제 사용자 대화 왕복은 이 검사 결과에 포함되지 않는다.

## 기존 Agent view 탭과 통합 장면의 중복

기존 standalone `Agent view` 탭은 터미널이 없는 agents-plus mod pane이다.
통합 workspace의 위 장면이 보일 때 그 pane은 `No terminal in this pane`과
안내를 표시한다. 탭을 닫거나 native tab tree를 숨기지 않으며, 다른 mod/문서와
터미널 split은 그대로 유지한다. `Show Agent view here` 또는 Terminal only로
위 장면을 접으면 기존 overview를 다시 사용할 수 있다.

`agent-empty-states.mjs`는 integrated 속성이 없는 legacy props, Plain/Chiikawa
Cards/Village, 반복 선택과 ghost/빈 프로젝트/문서 focus, stale resident 선택,
팩 보존과 split 복귀를 검사한다. `agents-render.mjs --native`는 placeholder와
Terminal only의 native builder도 검사하지만 실제 앱 화면 검증을 대신하지 않는다.
`session-handoff.mjs`는 실제 Saved/Outside handler와 공통 resume guard에 합성
transport를 연결해, 중복 클릭 및 두 spaces-plus 수신자에서도 최대 한 번만
launch하는지 확인한다. active/unknown ownership은 두 provider 모두 거부해야 한다.
