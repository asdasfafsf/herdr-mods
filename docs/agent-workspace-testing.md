# Agent workspace 별도 테스트

실행 중인 앱에 설치하지 않고 공통 에이전트 화면을 검사할 수 있다.
저장소 루트에서 다음 명령을 실행한다. Node.js와 Python 3이 필요하다.

```sh
python3 scripts/test-agent-workspace.py
```

선택한 테스트 22개를 실행하고 각 검사의 PASS/FAIL, 종료 코드, 실행 시간,
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
예를 들어 `--native --repeat 3`의 `66 passed`는 고정 검사 22개 × 3회를 뜻한다.
개별 assertion 개수와 native 시나리오 결과는 각 로그에서 확인한다.

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

직접 관찰한 잔여 문제도 있다. 주민이 가까워지면 그림이나 이름표가 다른
이름표를 일부 가린다. 현재 이동 충돌 검사는 이름표 전체 영역을 예약하지 않는다.
또한 다크 전환 후 기존 Codex 입력·사용자 메시지의 밝은 배경이 남았다.
읽기 전용 theme compatibility checker는 light=`herdr-chiikawa`, dark=`moss`와
중복 팔레트 상태 없음은 확인했지만, 설치 CLI 0.1.15의 native surface 기능은
`unknown`으로 보고했다. 이를 앱 렌더러 지원이 확인된 것으로 해석하지 않는다.
앱·core·실제 세션을 재시작하거나 입력하지 않았다.
