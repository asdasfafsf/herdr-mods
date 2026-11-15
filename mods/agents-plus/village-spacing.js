import { spriteLayout } from "./sprite-layout.js";

const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const scenicFloor = (width) => Math.min(260, Math.max(120, width * 0.19));
const union = (boxes) => {
  const left = Math.min(...boxes.map((box) => box.left)), top = Math.min(...boxes.map((box) => box.top));
  return { left, top, width: Math.max(...boxes.map((box) => box.left + box.width)) - left,
    height: Math.max(...boxes.map((box) => box.top + box.height)) - top };
};
const translate = (box, point) => ({ ...box, left: box.left + point.x, top: box.top + point.y });

// Reserve all visible content, not the body used to scale it. Both facings and
// every motion resource share an envelope so atlas frames/turns cannot resize it.
export function residentGeometry(sprites, size, visualScale = 1) {
  const art = union(sprites.flatMap((sprite) => [false, true].map((mirrored) => {
    const fitted = spriteLayout({ ...sprite, mirrored }, size + 16, size, true, visualScale);
    const [sourceX, y, width, height] = sprite.content || [0, 0, sprite.width, sprite.height];
    const x = mirrored ? sprite.width - sourceX - width : sourceX, scale = fitted.width / sprite.width;
    return { left: fitted.left + x * scale, top: fitted.top + y * scale, width: width * scale, height: height * scale };
  })));
  const name = { left: -6, top: Math.max(size + 12, art.top + art.height + 8), width: size + 28, height: 36 };
  const status = { left: (size + 16 - 84) / 2, top: Math.min(-26, art.top - 28), width: 84, height: 22 };
  const selection = { left: (size + 16 - size * visualScale) / 2, top: size, width: size * visualScale, height: 14 };
  return { art, name, status, selection, visualScale, body: union([art, name, selection]) };
}

export function noticeBounds(actor, layout, options = {}) {
  const width = Math.max(1, Math.min(options.width || 208, layout.width - 24));
  const height = Math.max(1, Math.min(options.height || 88, layout.height - 24));
  const left = clamp(actor.x + (layout.size + 16 - width) / 2, 12, layout.width - width - 12);
  return { left, top: clamp(actor.y + (options.artTop || 0) - height - 14, 12, layout.height - height - 12), width, height,
    tail: clamp(actor.x + (layout.size + 16) / 2 - left - 8, 12, width - 28) };
}

export function residentFootprint(actor, layout, geometry, notice) {
  const boxes = [translate(geometry.body, actor)];
  if (notice) {
    const bubble = noticeBounds(actor, layout, { ...notice, artTop: geometry.art.top });
    boxes.push({ ...bubble, height: bubble.height + 12 });
  } else boxes.push(translate(geometry.status, actor));
  return union(boxes);
}

export function residentBounds(layout, geometry, notice) {
  const { body, status, art } = geometry;
  const top = notice ? art.top - notice.height - 14 : status.top;
  const left = 12 - body.left, minY = Math.max(layout.groundTop ?? scenicFloor(layout.width), 12 - Math.min(body.top, top));
  // Bubbles clamp horizontally to the field; each body uses its own free space
  // while ordinary roaming remains on the original scenery's ground plane.
  return { left, right: Math.max(left, layout.width - 12 - body.left - body.width), top: minY,
    bottom: Math.max(minY, layout.height - 12 - body.top - body.height) };
}

// Scroll the field to fit real envelopes with space to wander. Do not cram more
// rows into the old fixed area and then make the collision radius larger.
const nominalGeometry = new Map();
export function villageLayout(width, viewportHeight, count, noticeCount = 0, noticeSize = {}, residents) {
  const size = count > 12 ? 82 : 108;
  let specs = residents;
  if (!specs?.length) {
    if (!nominalGeometry.has(size)) nominalGeometry.set(size, residentGeometry([{ width: size + 16, height: size }], size));
    specs = [{ geometry: nominalGeometry.get(size), notice: noticeCount ? noticeSize : null }];
  }
  const envelopes = specs.map(({ geometry, notice }) => union([geometry.body, notice ? {
    left: (size + 16 - Math.min(notice.width || 208, width - 24)) / 2,
    top: geometry.art.top - (notice.height || 88) - 14,
    width: Math.min(notice.width || 208, width - 24), height: (notice.height || 88) + 12,
  } : geometry.status]));
  const envelope = union(envelopes), gap = 32;
  const inset = Math.min(110, Math.max(20, width * 0.08));
  const left = Math.max(12 - envelope.left, Math.min(inset, (width - envelope.width) / 2 - envelope.left));
  const right = Math.max(left, width - 12 - envelope.left - envelope.width);
  const columns = Math.max(1, Math.min(Math.max(1, count), 1 + Math.floor((right - left) / (envelope.width + gap))));
  const lines = Math.max(1, Math.ceil(count / columns));
  const groundTop = scenicFloor(width), top = Math.max(groundTop, 12 - envelope.top);
  const height = Math.max(420, viewportHeight, top + (lines - 1) * (envelope.height + gap) + envelope.top + envelope.height + 128);
  return { width, viewportHeight, height, size, left, right, top, groundTop,
    bottom: Math.max(top, height - envelope.top - envelope.height - 32), columns, noticeCount };
}

// Minimum translation distances, rather than intersection area, retain an
// escape gradient when one rectangle contains another (or starts coincident).
export function footprintOverlap(a, b) {
  const x = Math.min(a.left + a.width - b.left, b.left + b.width - a.left) + 6;
  const y = Math.min(a.top + a.height - b.top, b.top + b.height - a.top) + 6;
  return x > 0 && y > 0 ? x * y : 0;
}

// For changed layouts, completed drags or a persistently trapped overlap. Boundary candidates find a
// nearby vacant region even when a fixed resident seals off a narrow corridor;
// ordinary walking must never teleport through that resident every frame.
export function vacantPosition(actor, bounds, footprint, others) {
  const box = footprint(actor), dx = box.left - actor.x, dy = box.top - actor.y;
  const xs = [actor.x, bounds.left, bounds.right], ys = [actor.y, bounds.top, bounds.bottom];
  for (const other of others) {
    xs.push(other.left - dx - box.width - 7, other.left + other.width - dx + 7);
    ys.push(other.top - dy - box.height - 7, other.top + other.height - dy + 7);
  }
  let best = null, distance = Infinity;
  for (const x of new Set(xs.map((x) => clamp(x, bounds.left, bounds.right)))) {
    for (const y of new Set(ys.map((y) => clamp(y, bounds.top, bounds.bottom)))) {
      const nextDistance = Math.hypot(x - actor.x, y - actor.y);
      if (nextDistance >= distance) continue;
      const next = footprint({ x, y });
      if (others.every((other) => footprintOverlap(next, other) < 0.001)) { best = { x, y }; distance = nextDistance; }
    }
  }
  return best;
}

const vectors = { right: [1, 0], down: [0, 1], left: [-1, 0], up: [0, -1] };
const allDirections = [...Object.values(vectors), ...[[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([x, y]) => [x / Math.SQRT2, y / Math.SQRT2])];

export function spacedStep(actor, target, step, layout, footprint, others, directions) {
  const score = (point) => {
    const box = footprint(point);
    return others.reduce((sum, other) => sum + footprintOverlap(box, other), 0);
  };
  const start = score(actor);
  const dx = target.x - actor.x, dy = target.y - actor.y, distance = Math.hypot(dx, dy);
  const forward = distance ? [dx / distance, dy / distance] : null;
  const permitted = directions?.length ? directions.map((key) => vectors[key]) : allDirections;
  const candidates = forward && (!directions?.length || permitted.some(([x, y]) => Math.abs(x - forward[0]) + Math.abs(y - forward[1]) < 0.001)) ? [forward] : [];
  candidates.push(...permitted);
  let best = null, bestScore = start;
  for (const [x, y] of candidates) {
    const point = { x: clamp(actor.x + x * step, layout.left, layout.right), y: clamp(actor.y + y * step, layout.top, layout.bottom) };
    if (Math.hypot(point.x - actor.x, point.y - actor.y) < 0.01) continue;
    const next = score(point);
    if (!next || next < bestScore - 0.001) { best = point; bestScore = next; }
    if (!bestScore && best) break;
  }
  return best;
}
