// Near-vertical motion keeps the last facing rather than flickering left/right.
export function movementFacing(dx, dy, previous) {
  return Math.abs(dx) > 0.1 && Math.abs(dx) > Math.abs(dy) * 0.15 ? Math.sign(dx) : previous;
}
export function movementDirection(dx, dy, previous = "down") {
  if (Math.hypot(dx, dy) < 0.1) return previous;
  return Math.abs(dx) >= Math.abs(dy) ? dx < 0 ? "left" : "right" : dy < 0 ? "up" : "down";
}
export function frameFacing(definition, name, frame) {
  const facing = definition.facing?.[name];
  return (Array.isArray(facing) ? facing[frame] : facing) || 0;
}
