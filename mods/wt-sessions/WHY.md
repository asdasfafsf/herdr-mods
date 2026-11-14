# wt-sessions 를 만든 이유

워크트리(또는 레포)에서 돌았던 Claude Code·Codex 세션 목록.

## Herdr 기본
없다.

## 모자랐던 것
그 폴더에서 했던 예전 대화를 찾아 이어가거나 갈래를 낼 곳이 없다.

## 더한 것
제목으로 거르기, 전체 메시지 검색(`sessions.py`), Resume(`claude --resume`, `codex resume`)·Fork(`--fork-session`, `codex fork`)·Close 버튼. `~/.claude/projects`, Codex rollout·이름 기록·현재 SQLite 인덱스를 읽기만 한다. Codex의 폴더/이름 변경이 과거 rollout 헤더보다 우선한다. Resume/Fork는 호스트 실행 함수와 실행 argv 변수의 이름 충돌 없이 두 에이전트 모두 새 탭을 연다.

`hm resume --into`는 실행 중 세션 이동을 막는다. Codex는 공유 서버 writer도 검사하고, JSONL만 고쳐 인덱스와 어긋나는 것을 피하도록 native `resume --cd`에 맡긴다. 같은 ID와 기록을 유지한다.

## 걷어낼 조건
Herdr 가 폴더별 에이전트 세션 기록을 보여주고 이어 열게 하면 뺀다.

## 옮길 때 가져갈 것
없다. 세션은 각 에이전트가 갖고 있다(Claude Code `~/.claude/projects/<경로, 영숫자 아닌 글자는 ->/`, Codex `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`).
