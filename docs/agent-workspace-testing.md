# Agent workspace 별도 테스트

실행 중인 앱에 설치하지 않고 공통 에이전트 화면을 검사할 수 있다.
저장소 루트에서 다음 명령을 실행한다. Node.js와 Python 3이 필요하다.

```sh
python3 scripts/test-agent-workspace.py
```

선택한 테스트 21개를 실행하고 각 검사의 PASS/FAIL, 종료 코드, 실행 시간,
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
예를 들어 `--native --repeat 3`의 `63 passed`는 고정 검사 21개 × 3회를 뜻한다.
개별 assertion 개수와 native 시나리오 결과는 각 로그에서 확인한다.

## 별도 GUI 미리보기는 왜 아직 실행하지 않는가

현재 확인한 CLI에는 독립 GUI preview 명령이 없고, `HERDR_APP_HOME`은 앱 창의
설정·제어 대상을 분리하는 값이다. 이것만으로 herdr-core의 세션까지 분리된다고
판정하지 않는다. 따라서 이 runner는 `herdr-app`을 인수 없이 실행하거나,
`hc server`를 시작·재시작하거나, 기존 앱에 테스트 layout을 추가하지 않는다.

실제 시각적 검증은 코어 연결 격리가 확인된 별도 개발 환경에서 공통 view와
synthetic host를 사용해야 한다. 그 전까지 위 자동 검증과 실제 화면 검증의
차이를 명확히 남긴다. HTML로 화면을 다시 구현한 모형을 native 검증 대신 쓰지 않는다.
