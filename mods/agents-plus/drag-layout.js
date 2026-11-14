// Pointer drags shared by residents and floating session panels. GPUI reports
// window-relative `position`; using that delta avoids jumping as the target moves.
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const clamp = (value, low, high) => Math.max(low, Math.min(high, finite(value, low)));
const point = (value) => value && Number.isFinite(value.x) && Number.isFinite(value.y);
const range = (bounds) => ({
  left: finite(bounds?.left, 0), top: finite(bounds?.top, 0),
  right: Math.max(finite(bounds?.left, 0), finite(bounds?.right, 0)),
  bottom: Math.max(finite(bounds?.top, 0), finite(bounds?.bottom, 0)),
});

export function clampPosition(position, bounds) {
  const area = range(bounds);
  return { x: clamp(position?.x, area.left, area.right), y: clamp(position?.y, area.top, area.bottom) };
}

// Store relative positions, so a dragged panel stays reachable when the window
// shrinks and returns to the same relative location when it grows again.
export function normalizedPosition(position, bounds) {
  const area = range(bounds), fitted = clampPosition(position, area);
  return { x: area.right > area.left ? (fitted.x - area.left) / (area.right - area.left) : 0.5,
    y: area.bottom > area.top ? (fitted.y - area.top) / (area.bottom - area.top) : 0.5 };
}

export function restorePosition(saved, bounds, fallback = {}) {
  const area = range(bounds);
  if (!point(saved)) return clampPosition(fallback, area);
  return { x: area.left + clamp(saved.x, 0, 1) * (area.right - area.left),
    y: area.top + clamp(saved.y, 0, 1) * (area.bottom - area.top) };
}

export function reflowPosition(position, previousBounds, bounds) {
  return previousBounds ? restorePosition(normalizedPosition(position, previousBounds), bounds)
    : clampPosition(position, bounds);
}

// Install on the actual grab handle. `bounds` may be a getter so resize changes
// during a drag are respected. `onMove` updates the caller's per-session state.
export function beginDrag(view, id, event, position, bounds, onMove, cx, onEnd) {
  if (!point(event?.position) || !point(position)) return false;
  if (view.pointerDrag) finishDrag(view, null, cx);
  view.suppressedDragClick = null;
  view.pointerDrag = { id, origin: { ...event.position }, start: { ...position }, position: { ...position },
    bounds, onMove, onEnd, moved: false };
  cx?.stop_propagation();
  cx?.notify();
  return true;
}

export const isDragging = (view, id) => Boolean(view.pointerDrag && (id == null || view.pointerDrag.id === id));

// Install on the containing viewport, not each moving object, so a fast pointer
// can move off the grabbed object's bounds without losing the drag.
export function moveDrag(view, event, cx) {
  const drag = view.pointerDrag;
  if (!drag || !point(event?.position)) return false;
  const dx = event.position.x - drag.origin.x, dy = event.position.y - drag.origin.y;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return false;
  drag.moved = true;
  const bounds = typeof drag.bounds === "function" ? drag.bounds() : drag.bounds;
  const next = clampPosition({ x: drag.start.x + dx, y: drag.start.y + dy }, bounds);
  if (next.x !== drag.position.x || next.y !== drag.position.y) {
    drag.position = next;
    drag.onMove(next);
    cx?.notify();
  }
  cx?.stop_propagation();
  return true;
}

// Call for viewport mouse-up, pointer leave and mode/selection changes. The
// current host exposes no pointer capture: releasing outside must never leave a
// resident frozen. Ending on leave keeps the last safe position and resumes it.
export function finishDrag(view, event, cx) {
  const drag = view.pointerDrag;
  if (!drag) return false;
  if (event) moveDrag(view, event, cx);
  view.pointerDrag = null;
  if (drag.moved) view.suppressedDragClick = { id: drag.id, until: Date.now() + 500 };
  drag.onEnd?.(drag.position, drag.moved);
  cx?.notify();
  return drag.moved;
}

// Check before the ordinary resident/background click action. Starting a fresh
// press clears this guard, so intentional clicks immediately after a drag work.
export function consumeDragClick(view, id) {
  const suppressed = view.suppressedDragClick;
  if (!suppressed) return false;
  if (suppressed.until < Date.now()) { view.suppressedDragClick = null; return false; }
  // A release may land on another resident. That trailing click belongs to the
  // drag too; it must never select the resident underneath the drop position.
  view.suppressedDragClick = null;
  return true;
}
