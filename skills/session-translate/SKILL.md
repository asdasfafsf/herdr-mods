---
name: session-translate
description: 한 에이전트의 대화(세션)를 다른 에이전트 세션으로 옮긴다 — Claude Code ↔ Codex (표준 형식 agent-session/1 을 거쳐서, 여러 에이전트에 한꺼번에도). "이 세션 코덱스로 이어가", "클로드 세션을 codex 로 옮겨", "codex 대화를 claude 로", "같은 대화를 claude·codex 둘 다에 붙여", "에이전트 바꿔서 계속", "translate this session to codex" 에서 쓴다. 같은 에이전트 안에서 이어가기·워크트리 옮기기는 herdr 스킬의 hm resume(--into).
---

# 세션 번역 (agent-session/1)

대화를 **표준 형식 한 벌**로 옮겨 두고, 거기서 에이전트별 세션을 만든다. 표준이 가운데 있으니 같은 대화를 여러 에이전트에
한꺼번에 붙일 수 있다(그 뒤로는 각자 따로 이어 간다). 원본 세션은 건드리지 않는다 — 늘 새 세션이 생긴다.

어디서든(Herdr 없이도) 이 스킬 폴더의 스크립트로 한다. `<스킬>` = 이 SKILL.md 가 있는 폴더(`~/.claude/skills/session-translate`
또는 `~/.codex/skills/session-translate`):

```sh
python3 <스킬>/scripts/translate.py convert <세션> --to codex [--cwd 폴더]        # Claude → 새 Codex 세션
python3 <스킬>/scripts/translate.py convert <세션> --to claude,codex [--cwd 폴더] # 둘 다 한꺼번에
python3 <스킬>/scripts/translate.py export <세션>                                 # 표준 파일만
python3 <스킬>/scripts/translate.py import <표준 id|경로> --to claude --cwd 폴더    # 표준 파일에서 다시
```

결과 JSON 의 새 id 로 연다: `claude --resume <id>`(그 --cwd 폴더에서) / `codex resume <id>`.
Herdr 안이면 hm 이 같은 일을 하고 그 공간에 바로 연다:

```sh
hm translate <세션> --to claude,codex [--into T]   # 워크트리 T 에
hm resume <세션> --as codex [--into T]             # 옮기고 Herdr 그 공간에 연다
```

- 세션 id 는 `hm sessions T`(Herdr) 로, 아니면 `~/.claude/projects/<폴더>/<id>.jsonl`·`~/.codex/sessions/…/rollout-…-<id>.jsonl`.
- 표준 파일은 `~/.herdr/agent-sessions/<표준 id>.jsonl` — 머리 줄에 원본 에이전트·세션·폴더가 남는다.
- --cwd 를 안 주면 원본 세션의 폴더에 만든다.
- 옮겨지는 것: 사용자·어시스턴트 말, 도구 실행과 그 결과(받는 쪽엔 글로 — 도구 이름이 달라도 된다), 앞 대화 요약.
  안 옮겨지는 것: Claude thinking·Codex reasoning(모델 전용), 서브에이전트 대화, 에이전트가 스스로 넣는 지침.
- 지금 아는 에이전트: claude, codex. 다른 에이전트(Grok 등)는 `lib/agentsession.py` 의 ADAPTERS 에 (to_std, from_std) 한 쌍.
- 아주 긴 도구 결과는 앞뒤만 남긴다(MAX_TOOL_OUTPUT). 세션에 고객 원문 같은 민감 정보가 있으면 옮긴 세션에도 그대로 있다.
