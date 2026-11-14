// Near-vertical motion keeps the last facing rather than flickering left/right.
export function movementFacing(dx, dy, previous) {
  return Math.abs(dx) > 0.1 && Math.abs(dx) > Math.abs(dy) * 0.15 ? Math.sign(dx) : previous;
}
export function frameFacing(definition, name, frame) {
  const facing = definition.facing?.[name];
  return (Array.isArray(facing) ? facing[frame] : facing) || 0;
}
