// Packs choose an animation/pose for a movement state. Session status never
// changes a resident's identity; missing motion artwork falls back to idle.
export function spriteMotion(definition, resident, actor) {
  const key = actor?.moving ? actor.direction || "down" : "idle";
  const motions = definition.motions?.[resident];
  const clip = motions?.[key] || motions?.idle || {};
  const name = definition.sprites[clip.sprite] ? clip.sprite : resident;
  const sprite = definition.sprites[name];
  const frames = Array.isArray(clip.frames) && clip.frames.length && clip.frames.every((frame) =>
    Number.isInteger(frame) && frame >= 0 && frame < sprite.frames) ? clip.frames : null;
  return { key, name, frames, facing: clip.facing,
    duration: frames ? frames.reduce((sum, frame) => sum + sprite.durations[frame], 0) : sprite.duration };
}
