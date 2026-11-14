// Shared status semantics. All presentations consume this registry; theme
// palettes provide the named colors, and the host remains the state owner.
import { option } from "./state.js";

export const AGENT_STATUSES = {
  blocked: { label: "Needs you", priority: 4, color: "blocked", mark: "attention", notice: true, summary: "Waiting for your input or approval." },
  working: { label: "Working", priority: 2, color: "working", mark: "spinner", icon: "mods/workspace-chrome/spinner.svg", summary: "Working on this task…" },
  done: { label: "Done", priority: 3, color: "done", mark: "dot", notice: true, summary: "Task finished. Review the latest reply." },
  seen: { label: "Seen", priority: 1.5, color: "seen", fallback: "#8b7cf6", mark: "ring", summary: "Reply seen. Ready for your next message." },
  idle: { label: "Idle", priority: 1, color: "idle", mark: "ring", quiet: true, compact: true, summary: "Ready for the next task." },
  unknown: { label: "Unknown", priority: 0, color: "muted", mark: null, filter: false, summary: "Checking session status…" },
};
export const normalizeStatus = (status, child = false) => status === "error" ? "blocked" : child && status === "done" ? "idle" : status || "idle";
export const statusInfo = (status) => AGENT_STATUSES[normalizeStatus(status)] ?? AGENT_STATUSES.unknown;
export const statusLabel = (status) => statusInfo(status).label;
export const statusRank = (status) => statusInfo(status).priority;
export const STATUS_RANK = Object.fromEntries(Object.entries(AGENT_STATUSES).map(([key, value]) => [key, value.priority]));
export const STATUS_LABEL = Object.fromEntries(Object.entries(AGENT_STATUSES).map(([key, value]) => [key, value.label]));
export const STATUS_FILTERS = [["all", "All"], ...Object.entries(AGENT_STATUSES).filter(([, value]) => value.filter !== false).map(([key, value]) => [key, value.label])];
export const statusColor = (theme, status) => {
  const definition = statusInfo(status);
  return theme[definition.color] ?? definition.fallback ?? theme.dim;
};
export function statusNotice(row) {
  const definition = statusInfo(row.status);
  return definition.notice ? { label: definition.label, text: row.activity?.trim() || definition.summary } : null;
}

export const seenFor = (options) => option("seen", options) ? option("seenMinutes", options) * 60000 : 0;
export function shownStatus(raw, info, now = Date.now(), duration) {
  const status = normalizeStatus(raw);
  if (status === "done" && info?.acked) return now - info.acked < (duration ?? seenFor()) ? "seen" : "idle";
  return status === "idle" && info?.seen && now - info.seen < (duration ?? seenFor()) ? "seen" : status;
}
