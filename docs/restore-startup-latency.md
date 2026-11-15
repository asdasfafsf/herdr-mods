# 앱을 다시 켰을 때 세션 복구가 늦는 이유

2026-11-15, 기준 HEAD `63436487bda18f02124b9c3d1d8c212bfbbd3c53`.
이 조사의 대상은 시작 후 세션 복구다. 마을/카드 렌더 비용은 조사 대상에서 제외했다.
앱·core·실제 세션을 재시작하지 않았으며, 설치나 제품 코드는 변경하지 않았다.
아래 실측 수치·프로세스·설치 해시는 이 원감사 시점의 기록이며, 이후 코드의 성능을
재측정한 결과가 아니다. 최신 main 호환 검증의 범위는 문서 끝에 구분한다.

## 확인한 지연

1. **새 core에서는 복구 판단을 20초 동안 보류한다.**
   `mods/wt-restore/main.js`의 `SETTLE = 20000`, `EVERY = 5000`과
   `tick()`의 `now.uptime < SETTLE` 분기다. 첫 조회는 즉시 하지만, 이 조건을
   통과하기 전에는 복구 후보를 안내하거나 시작하지 않는다.
2. **측정 당시 실행 중인 Codex 세션을 식별하는 조회도 수 초 걸렸다.**
   당시 부모 세션 9개를 읽은 세 번의 `look()`은 2.747 / 3.976 / 2.782초였다.
   이 중 Codex 식별 helper 9회의 합계가 2.637 / 3.876 / 2.681초로 약 96–97%다.
3. **느린 식별 fallback은 저장된 대화 전체에 반복 파일시스템 조회를 한다.**
   `lib/codex_live.py`는 열린 rollout 파일로 ID를 못 찾으면 미보관 대화 전체를
   SQLite에서 가져온다. `named_session()`은 제목을 비교하기 전에 매 레코드마다
   양쪽 cwd의 `os.path.realpath()`를 계산한다. 당시 미보관 80,743개, 서로 다른
   cwd 30개인데 fallback 한 번에 `realpath` 161,486회가 관측됐다.

이는 서로 다른 측정이다. 과거 시작 때의 21.2초에 별도 조회 2.7–4.0초를 더해서
당시 총 복구 시간을 계산해서는 안 된다. 시작 당시에는 살아 있던 세션 수와
다른 프로세스 수가 지금과 다르다.

## 남아 있는 실제 시작 기록

| 항목 | UTC 시각 / 값 |
| --- | --- |
| 측정 당시 core PID | 3847 |
| `hc server status`에서 역산한 core 시작 | 2026-11-15 09:02:20.272 |
| `ps lstart`의 앱/core 시작 | 2026-11-15 18:02:20 KST (초 단위) |
| 기존 `restore.jsonl`의 `offer` | 2026-11-15 09:02:41.473193 UTC |
| 시작부터 후보 안내 로그까지 | 약 **21.201초** |
| 기록 / 안내 | 6개 / 5개, 1개는 Herdr에서 이미 실행 중 |

이 기록은 20초 보류와 일치한다. 안내 전 지연 대부분을 설명하지만, 당시의 단계별
타이머나 화면 캡처는 없다. 따라서 나머지 약 1.2초를 특정 함수에 배정하지 않는다.
해당 `offer`는 **후보 발견 기록**이며 사용자의 선택, 명령 전달, CLI 준비 완료 시각이 아니다.

측정 시 설치된 `main.js`, `resume.js`, `codex_live.py`, `agentfiles.py`의 SHA-256은
워크트리와 같았다([원문](evidence/restore-startup-2026-11-15/audit.json)).
09:02 시작 시점의 설치 해시는 남아 있지 않다. 다만 초기 커밋 `9ce23d8`에도 같은
20초 보류와 5초 폴링이 있고, 이후 progress 표시 변경에도 유지됐다.

## 20초 조건의 범위와 재현

이는 앱 창을 열 때마다 반드시 더하는 20초가 아니라 **core의 uptime 조건**이다.
앱만 닫았다 열어 기존 core가 계속 살아 있으면 이 보류는 적용되지 않는다.
`sameRun()`이 같은 core라고 판단하면 자동 복구 후보 안내도 다시 하지 않는다.

실제 `init()`/`tick()`을 외부 연결 없는 VM에서 실행하고 시계와 호스트만 대체했다.
AUTO 설정을 주지 않아 후보 안내에서 멈추며, 전송·실행 함수는 예외를 던진다.

| 첫 조회 시점(core uptime) | 첫 후보 안내(core uptime) |
| --- | --- |
| 0ms | 20,000ms |
| 1,000ms | 21,000ms |
| 19,999ms | 24,999ms |
| 20,000ms | 20,000ms |
| 이미 60초 지난 같은 core | 즉시 startup check 완료, 재복구 안내 없음 |

이 표는 **조회 비용을 0으로 둔 제어 흐름 재현**이다. 실제로는 `look()` 전체를
먼저 기다린 다음, 조회 시작 때 얻은 uptime으로 조건을 검사한다. `look()`이
길거나 5초 주기에 겹치면 `busy`/`polling` 때문에 그 주기를 건너뛸 수도 있다.
따라서 25초가 실제 지연의 상한이라는 뜻은 아니다.

20초 조건은 과거 시작 직후 core가 옛 foreground PID를 잠깐 보고하여 복구를
놓치고 기록을 덮어쓴 문제에 대응해 추가됐다([배경](recovery-reliability.md)).
원인을 확인했다는 이유로 이 보호를 삭제하거나 임의로 줄이지 않았다.

## 실제 읽기 전용 탐색 비용

`look()`의 생산 함수를 Node VM에 로드하고, `hc server status/ls/get`, `ps`,
기준 HEAD의 `codex_live.py`만 실제 실행했다. GUI 호스트의 브리지는 사용하지
않으므로 이 값은 **실제 명령과 helper를 통한 탐색 wall time**이며 앱 전체
시작 시간이나 native callback 비용의 직접 측정은 아니다.

| 구간 | 1회차 | 2회차 | 3회차 |
| --- | ---: | ---: | ---: |
| 전체 `look()` | 2,747ms | 3,976ms | 2,782ms |
| `hc get` 9회 합계 | 41ms | 36ms | 38ms |
| foreground PID 묶음 확인 | 54ms | 54ms | 53ms |
| Codex identity 9회 합계 | 2,637ms | 3,876ms | 2,681ms |
| 식별 성공 / 실패 | 9 / 0 | 9 / 0 | 9 / 0 |

9개 중 7개는 열린 rollout 파일, 2개는 제목+cwd fallback으로 식별됐다.
helper의 개별 subprocess 실행까지 포함하면 전자는 약 139–163ms,
후자는 약 568–2,120ms였다. 각 terminal 조회와 identity lookup은 직렬이다.
현재 시작 화면이 기존 core에 다시 붙는 경우에도 첫 `look()` 비용은 남는다.

별도로, 존재하지 않는 무작위 Codex UUID에 대한 `runningElsewhere()`의 읽기 전용
miss 검사 3회는 504 / 488 / 488ms였다. 이 함수는 복구 후보마다 `pgrep`, 각 PID의
`ps` 및 `lsof` 조회를 다시 한다. 그 시점의 Codex 이름 프로세스는 15개였다.
후보 수에 따른 반복 비용 가능성은 있지만, 이를 과거 복구 시간으로 환산하지 않는다.

### fallback 내부 프로파일

별도 `cProfile` 실행에서 같은 두 fallback은 다음과 같았다. cProfile 자체의
오버헤드와 프로세스 재사용이 있으므로 위의 개별 subprocess 시간과 직접 비교하지 않는다.

| 항목 | fallback A | fallback B |
| --- | ---: | ---: |
| 전체 프로파일 호출 | 1,525ms | 856ms |
| `named_session()` 누적 | 1,324ms | 658ms |
| `realpath()` 호출 | 161,486회 | 161,486회 |
| `lstat()` 호출 | 486,345회 | 163,373회 |
| `lstat()` self time | 834ms | 344ms |

`named_session()`이 전체의 약 77–87%를 차지했다. 80,743개 레코드 × 양쪽 경로
정규화 = 161,486회라는 코드와 관측이 일치한다. `lstat` 수 차이는 경로 구성에
따라 생길 수 있으며, 이 결과로 대화 본문을 읽는 비용이라고 해석하지 않는다.
전체 대화 수는 80,745개였다. 집계 외에 제목·폴더·ID·본문은 결과물에 저장하지 않았다.

원문: [프로파일](evidence/restore-startup-2026-11-15/discovery-profile.json),
[독립 DB 집계](evidence/restore-startup-2026-11-15/index-counts.json).

## 아직 측정하지 못한 구간

- 실제 재시작을 하지 않아 **명령 전달부터 Codex/Claude의 대화 로딩·입력 가능까지**는
  재현하지 않았다. 기존 로그에 그 완료 시각도 없다.
- `restore()`의 `hc send`는 직렬이다. 응답 성공은 shell로 명령을 보냈다는 뜻이며,
  이전 세션의 CLI 준비 완료를 기다리는 코드가 아니다. 큐가 끝났다는 표시만으로
  복구 완료 시간이나 순차 CLI 초기화라고 결론 내리지 않는다.
- 당시 사용자 선택 시각과 자동 복구 설정은 로그만으로 확정할 수 없다.
- Orca는 측정하지 않았다. 이 조사로 Orca 대비 속도 차이 또는 원인을 수치화하지 않는다.
- 측정 당시 기기는 Mac16,7 / 14 CPU / 48GiB, Herdr 0.1.15, core 0.1.21이었다.
  다른 Codex 작업, StorageManagementService, ApplicationsStorageExtension, 브라우저,
  OrbStack, WindowServer가 활동 중이었다. raw report의 `ps %cpu`는 종료 무렵의
  스냅샷이며 측정 구간의 CPU 적분값이 아니다. 조용한 독점 환경의 결과가 아니다.

## 재현 및 검증

이 워크트리 안에서 실행한다. `--live`는 현재 세션의 메타데이터/프로세스만 읽는다.
VM에서 실제 앱 초기화나 `restore()`를 호출하지 않으며, 모든 세션 전송·실행·앱 변경
명령을 거부한다. 프로브 하위 명령은 최대 15초로 제한한다. Python은 bytecode 저장을
끄고 SQLite를 `mode=ro`로 연다. shell scan은 생산 코드의 읽기 전용 Codex 문자열과
일치하는 경우만 허용한다. 실제 설정·복구 파일에 쓰지 않는다.

```sh
node --experimental-vm-modules scripts/audit-restore-startup.mjs
node --experimental-vm-modules scripts/audit-restore-startup.mjs --live > audit.json
python3 -B scripts/profile-restore-discovery.py > discovery-profile.json
git diff --check
```

원감사에서는 fake-clock의 경계 조건 및 같은 core 분기, 실제 3회 탐색과 3회 miss 검사, 별도
9개 프로파일, 기존 restore-progress 합성 검사가 통과했다. live transport/허용 목록
오류가 생산 helper의 catch에 가려지더라도 감사 스크립트는 결과를 폐기하고 실패한다.
실제 세션 메시지·승인, reset/redemption 경로, 앱/core 재시작은 실행하지 않았다.

다음 변경을 검토한다면 20초 보호가 필요로 하는 **실제 core 준비 조건**을 먼저
확정하고, fallback의 전체 레코드 반복 경로 정규화를 줄이되 제목/cwd 유일성과
live writer 확인을 보존하는 것이 근거 있는 대상이다. 이 감사에는 최적화를 포함하지 않았다.

## 최신 main 호환 검증 (2026-11-15)

`origin/main`의 `433eb73`을 이 감사 브랜치에 병합하여 확인했다. `resume.js`가
새로 import하는 `./agent-launch.js`는 외부 import나 I/O 없이 인자 배열만 만드는
pure helper다. 감사 VM의 제한된 module map에 실제 `lib/agent-launch.js`만 추가했다.
그 외 host 권한이나 import 범위를 넓히지 않았다.

아래 fake-clock 검사만 다시 실행했다. 네 경계 시점에서 후보 안내가 각각
20,000 / 21,000 / 24,999 / 20,000ms에 발생하고, 60초 지난 같은 core에서는 안내 없이
check가 완료됐다. AUTO는 없고 후보 안내에서 멈추므로 `restore()`나 `hc send`를
mock으로도 실행하지 않는다. 기존 `tests/restore-progress.mjs`는 mock 복구 전송을
포함하므로 이번 호환 검증에서는 실행하지 않았다.

```sh
node --check scripts/audit-restore-startup.mjs
node --experimental-vm-modules scripts/audit-restore-startup.mjs
git diff --check
```

live scan과 Python 프로파일은 재실행하지 않았고, 원감사의 JSON 증거 파일은 그대로
보존했다. YOLO 실행 동작이나 실제 복구 완료 시간의 검증을 의미하지 않는다.
