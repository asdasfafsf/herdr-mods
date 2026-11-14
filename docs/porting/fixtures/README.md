# 가상 예제 데이터

모든 파일은 문서 작성용으로 생성했다. 실제 사용자·계정·레포·대화·로그인 정보를 복사하지 않았다. `/example`, `/target`, `example.invalid`, 0000… 세션 ID는 실행 가능한 실제 대상을 뜻하지 않는다.

| 파일 | 의미 | 검증 |
|---|---|---|
| [shared.json](shared.json) | 기준 shared.json에서 보존할 사용자 값 예제 | W03, B06, C02와 migration |
| [migration.json](migration.json) | 아직 구현되지 않은 export envelope/경로 매핑 제안 | prefix 경계, 캐시 제외, import가 실행을 유발하지 않는지 |
| [restore.json](restore.json) | 기준 복구 파일 모양 | R01, 호스트 ID 재발급 |
| [usage-sources.json](usage-sources.json) | Claude generic/model-scoped와 Codex 제어 응답, 최신 raw snapshot | U01의 창별 병합과 0% 보존 |
| [usage.json](usage.json) | 화면에 넘길 정규화 한도, 총 4창 | U02의 480/720/1200px 표현 |
| [states.json](states.json) | 고정 시계와 Seen 전이 기대값 | A04 |
| [session.jsonl](session.jsonl) | agent-session/1, 도구 호출/결과·요약·미응답 끝 | S04. 원본 에이전트 rollout fixture가 아니라 중간 표준 |
| [sample.md](sample.md), [second.md](second.md) | Markdown 렌더링·상대 링크·Back | D01 |

시간 기준은 `1893456000` epoch 초(2030-01-01 UTC). 한도 화면 검증에서는 시계를 `clock_seconds`로 고정한다. 실제 현재 시각으로 그리면 reset/stale 의미가 달라진다. stale 예제는 updated를 now-3601초로, reset 예제는 resets를 now-1초로 복제하여 만든다. 사용률은 0/79/80/99/100, 서비스 null도 각각 확인한다.

파일을 실제 `~/.herdr`/`~/.claude`/`~/.codex`에 덮어쓰지 않는다. fixture를 읽는 수집기 테스트는 경로와 CLI를 mock하거나 완전히 분리한 임시 home을 사용한다. 초기화된 가짜 ID로 실제 agent를 resume하지 않는다.
