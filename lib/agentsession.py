"""에이전트 세션 번역 — 한 에이전트(Claude Code·Codex …)의 대화를 표준 형식으로 옮기고, 표준에서 다른 에이전트 세션을 만든다.

    Claude 세션 ─ to_std ─┐                       ┌─ from_std ─▶ Claude 세션
    Codex 세션  ─ to_std ─┼─▶ 표준 세션 파일 ─────┼─ from_std ─▶ Codex 세션
    (다음 에이전트)       ┘   (~/.herdr/agent-sessions) └─ from_std ─▶ (다음 에이전트)

표준이 가운데 있어서 에이전트가 N 개면 어댑터는 2N 개(N×(N-1) 직접 변환이 아니다)이고, 표준 하나에서 여러 에이전트
세션을 한꺼번에 만들 수 있다(같은 대화를 Claude·Codex 가 각자 이어받는다 — 그 뒤로는 각자 따로 간다).
새 에이전트는 ADAPTERS 에 (to_std, from_std) 한 쌍만 더하면 된다.

표준 형식 agent-session/1 — JSON Lines. 첫 줄 머리, 나머지 줄은 메시지(OpenAI Chat 메시지 모양):
    {"schema": "agent-session/1", "id", "created", "title", "source": {"agent", "session", "cwd", "model"}}
    {"role": "user" | "assistant" | "tool" | "system", "content": str,
     "tool_calls": [{"id", "name", "arguments": {...}}],      # assistant 만
     "tool_call_id", "name", "is_error",                      # tool 만
     "kind": "summary"?, "ts"?}                               # system: 앞 대화를 줄인 요약(compaction)
옮기지 않는 것: Claude thinking(서명이 붙어 다른 모델이 못 쓴다)·Codex 암호화 reasoning, 서브에이전트 대화, 훅·첨부·
요청 기록 같은 에이전트 전용 기록, 에이전트가 스스로 넣는 지침(Codex developer 메시지·AGENTS.md·환경 정보).
표준에서 만들 때 도구 호출·결과는 글로 적는다 — 받는 에이전트에 같은 도구가 없어도(Codex exec_command ↔ Claude Bash)
API 가 거절하지 않고, 모델은 무엇을 실행해 무엇을 봤는지 그대로 읽는다. 아주 긴 도구 결과는 MAX_TOOL_OUTPUT 에서 자른다.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import uuid

from agentfiles import CLAUDE_PROJECTS, CODEX_HOME, CODEX_SESSIONS, HERDR_STATE, claude_transcript, codex_rollout, codex_metadata, json_lines, project_dir_name

SCHEMA = "agent-session/1"
STD_DIR = os.path.join(HERDR_STATE, "agent-sessions")
MAX_TOOL_OUTPUT = 20_000  # 글자 — 이보다 긴 도구 결과는 앞뒤만 남긴다
_CODEX_INJECTED = ("# AGENTS.md instructions", "<environment_context", "<user_instructions", "<permissions instructions")


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def agent_of(session):
    """그 세션 id 가 어느 에이전트 것인지 ("claude" / "codex"), 모르면 None."""
    if claude_transcript(session):
        return "claude"
    if codex_rollout(session):
        return "codex"
    return None


# ── 표준 파일 ───────────────────────────────────────────────────────────────────────

def save_std(std):
    """표준 세션을 ~/.herdr/agent-sessions/<id>.jsonl 로. 경로를 돌려준다."""
    os.makedirs(STD_DIR, exist_ok=True)
    path = os.path.join(STD_DIR, f"{std['header']['id']}.jsonl")
    with open(path + ".tmp", "w", encoding="utf-8") as f:
        for item in [std["header"], *std["messages"]]:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")
    os.replace(path + ".tmp", path)
    return path


def load_std(ref):
    """경로 또는 표준 id 로 표준 세션을 읽는다."""
    path = ref if os.path.exists(ref) else os.path.join(STD_DIR, f"{ref}.jsonl")
    items = list(json_lines(path))
    if not items or items[0].get("schema") != SCHEMA:
        raise ValueError(f"{path} 는 {SCHEMA} 표준 세션이 아니다")
    return {"header": items[0], "messages": items[1:]}


def _std(source_agent, session, cwd, model, title, messages):
    header = {
        "schema": SCHEMA,
        "id": str(uuid.uuid4()),
        "created": now(),
        "title": title or "",
        "source": {"agent": source_agent, "session": session, "cwd": cwd, "model": model},
    }
    return {"header": header, "messages": messages}


def _first_line(text, n=60):
    line = (text or "").strip().split("\n")[0]
    return line[:n]


# ── Claude Code ─────────────────────────────────────────────────────────────────────

def claude_to_std(session):
    path = claude_transcript(session)
    if not path:
        raise ValueError(f"Claude 세션 {session} 없음")
    msgs, cwd, model, title, last_id = [], None, None, None, None
    for o in json_lines(path):
        kind = o.get("type")
        if kind == "ai-title" and o.get("aiTitle"):
            title = o["aiTitle"]
        if kind not in ("user", "assistant") or o.get("isSidechain") or o.get("isMeta"):
            continue
        cwd = cwd or o.get("cwd")
        m = o.get("message") or {}
        content = m.get("content")
        if kind == "user":
            if o.get("isCompactSummary"):
                msgs.append({"role": "system", "kind": "summary", "content": _text(content), "ts": o.get("timestamp")})
                continue
            if isinstance(content, str):
                msgs.append({"role": "user", "content": content, "ts": o.get("timestamp")})
                continue
            texts = []
            for b in content or []:
                if b.get("type") == "tool_result":
                    msgs.append({"role": "tool", "tool_call_id": b.get("tool_use_id"), "content": _text(b.get("content")),
                                 "is_error": bool(b.get("is_error")), "ts": o.get("timestamp")})
                elif b.get("type") == "text":
                    texts.append(b.get("text") or "")
                elif b.get("type") == "image":
                    texts.append("[이미지]")
            if any(t.strip() for t in texts):
                msgs.append({"role": "user", "content": "\n".join(texts), "ts": o.get("timestamp")})
            continue
        model = model or m.get("model")
        # Claude 는 응답 하나(message.id)를 블록마다 기록 한 줄로 나눠 적는다 — 같은 id 면 한 메시지로 모은다.
        if not (msgs and msgs[-1]["role"] == "assistant" and last_id and last_id == m.get("id")):
            msgs.append({"role": "assistant", "content": "", "tool_calls": [], "ts": o.get("timestamp")})
        last_id = m.get("id")
        cur = msgs[-1]
        for b in content or []:
            if b.get("type") == "text" and b.get("text"):
                cur["content"] = (cur["content"] + "\n\n" + b["text"]).strip()
            elif b.get("type") == "tool_use":
                cur["tool_calls"].append({"id": b.get("id"), "name": b.get("name"), "arguments": b.get("input") or {}})
    for m in msgs:
        if m["role"] == "assistant" and not m["tool_calls"]:
            del m["tool_calls"]
    _name_tool_results(msgs)
    first_user = next((m["content"] for m in msgs if m["role"] == "user"), "")
    return _std("claude", session, cwd, model, title or _first_line(first_user), msgs)


def std_to_claude(std, cwd, version="2.1.318"):
    """표준 → 새 Claude Code 세션(그 cwd 의 프로젝트 폴더). 새 세션 id 를 돌려준다."""
    sid = str(uuid.uuid4())
    head = std["header"]
    turns = _alternating(_render(std))
    records, parent = [], None
    base = {"isSidechain": False, "userType": "external", "entrypoint": "cli", "cwd": cwd, "sessionId": sid,
            "version": version, "gitBranch": ""}
    for role, text in turns:
        rid = str(uuid.uuid4())
        message = ({"role": "user", "content": text} if role == "user" else
                   {"id": f"msg_import_{rid[:8]}", "type": "message", "role": "assistant", "model": head["source"].get("model") or "imported",
                    "content": [{"type": "text", "text": text}], "stop_reason": "end_turn", "stop_sequence": None,
                    "usage": {"input_tokens": 0, "output_tokens": 0}})
        records.append({**base, "parentUuid": parent, "type": role, "uuid": rid, "timestamp": now(), "message": message})
        parent = rid
    if head.get("title"):
        records.append({"type": "ai-title", "aiTitle": head["title"], "sessionId": sid})
    folder = os.path.join(CLAUDE_PROJECTS, project_dir_name(cwd))
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, f"{sid}.jsonl"), "w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    return sid


# ── Codex ───────────────────────────────────────────────────────────────────────────

def codex_to_std(session):
    """Export history with the current index cwd, including native resume --cd moves."""
    path = codex_rollout(session)
    if not path:
        raise ValueError(f"Codex 세션 {session} 없음")
    msgs, cwd, model = [], None, None
    for o in json_lines(path):
        kind, p = o.get("type"), o.get("payload") or {}
        if kind == "session_meta":
            cwd = cwd or p.get("cwd")
        elif kind == "turn_context":
            model = model or p.get("model")
        elif kind == "compacted" and p.get("message"):
            msgs.append({"role": "system", "kind": "summary", "content": p["message"], "ts": o.get("timestamp")})
        elif kind == "response_item":
            t = p.get("type")
            if t == "message" and p.get("role") in ("user", "assistant"):
                text = _text(p.get("content"))
                if p["role"] == "user" and text.lstrip().startswith(_CODEX_INJECTED):
                    continue  # Codex 가 스스로 넣는 지침·환경 정보
                if text.strip():
                    msgs.append({"role": p["role"], "content": text, "ts": o.get("timestamp")})
            elif t in ("function_call", "custom_tool_call"):
                args = p.get("arguments") if t == "function_call" else p.get("input")
                try:
                    args = json.loads(args) if isinstance(args, str) and t == "function_call" else ({"input": args} if t == "custom_tool_call" else args)
                except ValueError:
                    args = {"input": args}
                if not (msgs and msgs[-1]["role"] == "assistant"):
                    msgs.append({"role": "assistant", "content": "", "ts": o.get("timestamp")})
                msgs[-1].setdefault("tool_calls", []).append({"id": p.get("call_id"), "name": p.get("name"), "arguments": args or {}})
            elif t in ("function_call_output", "custom_tool_call_output"):
                msgs.append({"role": "tool", "tool_call_id": p.get("call_id"), "content": _text(p.get("output")), "ts": o.get("timestamp")})
    _name_tool_results(msgs)
    cwd = codex_metadata().get(session, {}).get("cwd") or cwd
    title = _codex_name(session) or _first_line(next((m["content"] for m in msgs if m["role"] == "user"), ""))
    return _std("codex", session, cwd, model, title, msgs)


def std_to_codex(std, cwd, cli_version="0.166.0"):
    """표준 → 새 Codex 세션(~/.codex/sessions/오늘/rollout-…-<id>.jsonl). 새 세션 id 를 돌려준다."""
    sid = str(uuid.uuid4())
    head = std["header"]
    stamp = dt.datetime.now()
    folder = os.path.join(CODEX_SESSIONS, f"{stamp:%Y}", f"{stamp:%m}", f"{stamp:%d}")
    os.makedirs(folder, exist_ok=True)
    lines = [{"timestamp": now(), "type": "session_meta",
              "payload": {"id": sid, "session_id": sid, "timestamp": now(), "cwd": cwd, "originator": "agent-session-import",
                          "cli_version": cli_version, "source": "cli", "model_provider": "openai"}}]
    for role, text in _alternating(_render(std)):
        kind = "input_text" if role == "user" else "output_text"
        lines.append({"timestamp": now(), "type": "response_item",
                      "payload": {"type": "message", "role": role, "content": [{"type": kind, "text": text}]}})
        lines.append({"timestamp": now(), "type": "event_msg",
                      "payload": {"type": "user_message" if role == "user" else "agent_message", "message": text}})
    path = os.path.join(folder, f"rollout-{stamp:%Y-%m-%dT%H-%M-%S}-{sid}.jsonl")
    with open(path, "w", encoding="utf-8") as f:
        for item in lines:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")
    if head.get("title"):
        with open(os.path.join(CODEX_HOME, "session_index.jsonl"), "a", encoding="utf-8") as f:
            f.write(json.dumps({"id": sid, "thread_name": head["title"]}, ensure_ascii=False) + "\n")
    return sid


def _codex_name(session):
    try:
        for o in json_lines(os.path.join(CODEX_HOME, "session_index.jsonl")):
            if o.get("id") == session and o.get("thread_name"):
                return o["thread_name"]
    except OSError:
        pass
    return None


# ── 어댑터 ──────────────────────────────────────────────────────────────────────────

ADAPTERS = {
    "claude": (claude_to_std, std_to_claude),
    "codex": (codex_to_std, std_to_codex),
}


def to_std(session, agent=None):
    agent = agent or agent_of(session)
    if agent not in ADAPTERS:
        raise ValueError(f"세션 {session}: 아는 에이전트({', '.join(ADAPTERS)})의 세션이 아니다")
    return ADAPTERS[agent][0](session)


def from_std(std, agent, cwd):
    if agent not in ADAPTERS:
        raise ValueError(f"{agent}: 아는 에이전트는 {', '.join(ADAPTERS)}")
    return ADAPTERS[agent][1](std, os.path.realpath(cwd))


# ── 공통 ────────────────────────────────────────────────────────────────────────────

def _text(content):
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    parts = []
    for c in content:
        if isinstance(c, str):
            parts.append(c)
        elif isinstance(c, dict):
            parts.append(c.get("text") or ("[이미지]" if c.get("type") in ("image", "input_image") else ""))
    return "\n".join(p for p in parts if p)


def _name_tool_results(msgs):
    """tool 메시지에 그 호출의 도구 이름을 붙인다(받는 쪽에서 글로 적을 때 쓴다)."""
    names = {c["id"]: c["name"] for m in msgs for c in m.get("tool_calls", [])}
    for m in msgs:
        if m["role"] == "tool":
            m["name"] = names.get(m.get("tool_call_id"), "tool")


def _cut(text):
    if len(text) <= MAX_TOOL_OUTPUT:
        return text
    half = MAX_TOOL_OUTPUT // 2
    return f"{text[:half]}\n… ({len(text) - MAX_TOOL_OUTPUT:,}자 생략) …\n{text[-half:]}"


def _render(std):
    """표준 메시지 → (역할, 글). 도구 호출·결과는 글로, 앞에 어디서 옮겨 왔는지 한 줄."""
    src = std["header"]["source"]
    out = [("user", f"[이 대화는 {src.get('agent')} 세션 {src.get('session')} 에서 옮겨 왔다(agent-session 표준 {std['header']['id']}). "
                    "앞 대화의 도구 실행은 글로 남겼다 — 그 결과를 이미 본 것으로 이어서 한다.]")]
    for m in std["messages"]:
        role = m["role"]
        if role == "system":
            out.append(("user", f"[앞 대화 요약]\n{m['content']}"))
        elif role == "user":
            out.append(("user", m["content"]))
        elif role == "assistant":
            calls = "".join(
                f"\n\n[도구 실행: {c.get('name')}]\n{json.dumps(c.get('arguments'), ensure_ascii=False)}" for c in m.get("tool_calls", [])
            )
            out.append(("assistant", (m.get("content") or "") + calls))
        elif role == "tool":
            flag = " (오류)" if m.get("is_error") else ""
            out.append(("user", f"[도구 결과: {m.get('name', 'tool')}{flag}]\n{_cut(m.get('content') or '')}"))
    return out


def _alternating(turns):
    """같은 역할이 이어지면 한 메시지로 합친다 — 사용자·어시스턴트가 번갈아야 받는 API 가 받아 준다. 끝은 어시스턴트로
    (원래 세션이 사용자 말에서 끝났으면 '답하기 전에 끝났다'고 적는다 — 지어낸 답을 넣지 않는다)."""
    merged = []
    for role, text in turns:
        text = (text or "").strip()
        if not text:
            continue
        if merged and merged[-1][0] == role:
            merged[-1] = (role, merged[-1][1] + "\n\n" + text)
        else:
            merged.append((role, text))
    if merged and merged[-1][0] == "user":
        merged.append(("assistant", "[원래 세션은 이 말에 답하기 전에 끝났다.]"))
    return merged
