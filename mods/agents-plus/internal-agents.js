// Internal Codex threads have identities and parents, but no terminal address.
// Both sidebar and workspace consume this adapter; navigation targets a real
// parent session and never passes a thread ID to terminal controls.
import { normalizeStatus } from "./ui.js";

export const internalAgentId = (session) => `codex-thread:${session}`;

export function internalAgents(listed, info = {}) {
  const native = new Map();
  for (const agent of listed) {
    const session = info[agent.address]?.session_id;
    if (session) native.set(session, agent);
  }
  const children = new Map();
  for (const agent of listed) {
    for (const child of info[agent.address]?.children ?? []) {
      if (typeof child?.id !== "string" || !child.id || typeof child.parent_session_id !== "string") continue;
      const previous = children.get(child.id);
      if (!previous || (child.updated || 0) > (previous.updated || 0)) children.set(child.id, child);
    }
  }
  const ownerOf = (child) => {
    const visited = new Set([child.id]);
    let parent = child.parent_session_id;
    while (parent && !visited.has(parent)) {
      if (native.has(parent)) return native.get(parent);
      visited.add(parent);
      parent = children.get(parent)?.parent_session_id;
    }
    return null;
  };
  const rows = [];
  for (const child of children.values()) {
    if (native.has(child.id)) continue; // Already represented by a real pane.
    const owner = ownerOf(child);
    if (!owner) continue; // Ignore orphans and cycles from an incomplete snapshot.
    rows.push({ id: internalAgentId(child.id), address: null, internal: true,
      sessionId: child.id,
      parent: native.get(child.parent_session_id)?.address ?? internalAgentId(child.parent_session_id),
      parentAddress: owner.address, pane: owner.pane, name: child.name || child.id,
      status: normalizeStatus(child.state || "unknown"), at: child.updated || 0,
      cwd: child.cwd || "", program: owner.program });
  }
  return rows;
}
