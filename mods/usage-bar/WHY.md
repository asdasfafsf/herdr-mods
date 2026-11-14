# usage-bar 를 만든 이유

하단바의 Claude·Codex 요금제 한도.

## Herdr 기본
없다.

## 모자랐던 것
Claude·Codex 를 얼마나 썼는지, 언제 리셋되는지 안 보인다.

## 더한 것
- 하단바 왼쪽에 알약 하나(에이전트 사이는 얇은 선): 5시간·7일 사용률, 리셋까지 남은 시간(`resets in 3h 39m`), 정확한 시각은 hover, 누르면 자세히, 끝에 Refresh.
- Claude: Claude Code 가 상태줄에 넘기는 한도를 `hm-statusline`(상태줄 명령 앞에 끼움)이 그대로 남긴 것(`~/.herdr/usage/claude-raw.json`). Claude Code 가 보내는 창은 전부(모델별 한도를 보내면 그것도 칸으로). Claude Code 가 도는 동안 바뀐다. 없으면 ClaudeHUD 스냅샷(`display.externalUsageWritePath`, 5h·7d). 상태줄에서 빠지는 Fable 등 모델별 주간 한도는 Claude Code의 `get_usage` 제어 요청(`skip_behaviors: true`)으로 5분마다 또는 Refresh 때 직접 조회한다. 모델 호출·로그인 정보 읽기 없이 Claude가 인증을 처리하고, 훅·MCP·세션 저장·대화 기록 스캔은 끈다. 실험적 인터페이스이므로 구버전이나 조회 실패 시 스냅샷과 마지막 정상 조회값으로 대체한다(`~/.herdr/usage/claude-live.json`). 최신 전체 한도 스냅샷이 들어와도 별도 Fable 값은 유지하며, 데이터 시각은 가장 오래된 표시 항목 기준이다.
- Codex: `codex app-server` 의 `account/rateLimits/read`(읽기만)로 5분마다 또는 Refresh 때 Codex 자신에게 묻는다. 로그인 정보는 읽지 않는다. 못 물으면 세션 기록의 마지막 값(턴이 돌 때만 바뀌어서, 한도를 다 쓰면 예전 숫자가 남는다: 실제로 그랬음).
- Claude 스냅샷은 모든 Claude 세션이 쓰므로, 쉬던 세션이 예전 값으로 덮어쓸 수 있다. 같은 리셋 주기 안에서 오래된 값은 더 높을 수 없으니, 더 낮은 값은 예전 값으로 보고 무시한다(`~/.herdr/usage/seen.json`). 요금제를 올리면 실제로 내려가는데, 그땐 리셋 뒤에 맞춰진다. Claude 직접 조회값과 Codex 는 서버에 물은 값이라 그대로 쓴다(리셋 크레딧을 쓰면 실제로 내려감).
- 하단바의 실제 너비와 항목 수에 맞춰 `resets in` 문구를 줄인다(720px에서 4개 항목도 축약). 더 좁으면 이름·사용률만 남기고 막대·리셋 시각은 자세히 보기와 hover로 확인한다. 자세히 보기 창은 항목 수에 맞춰 높이를 조정하고 스크롤한다.
- Refresh는 두 직접 조회가 성공할 때만 잠깐 `Updated`를 표시한다. 일부만 성공하면 `Partial`, 모두 실패하거나 helper 실행/응답이 잘못되면 `Failed`다. 실패 이유는 hover에 보이고 마지막 정상 수치·시각은 유지한다. 캐시를 읽었다는 이유로 최신 조회 성공이라고 표시하지 않는다. 다음 수동 조회에서 회복하면 실패 표시를 지운다.

## 걷어낼 조건
Herdr 가 한도를 보여주면 뺀다. 계정 여러 개 관리는 아직 없다.

## 옮길 때 가져갈 것
없다. `~/.herdr/usage/claude.json`(ClaudeHUD 가 씀), `~/.herdr/usage/codex.json`(캐시)은 다시 만들어진다.
