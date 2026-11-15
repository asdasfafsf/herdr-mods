// Fit visible artwork rather than its transparent canvas, keeping the original
// frame and animation pixels intact. Content bounds cover every frame.
export function spriteLayout(sprite, width, height, fitBody = false, visualScale = 1) {
  const bounds = (fitBody && sprite.body) || sprite.content || [0, 0, sprite.width, sprite.height];
  const [sourceX, y, contentWidth, contentHeight] = bounds;
  const x = sprite.mirrored ? sprite.width - sourceX - contentWidth : sourceX;
  // Optional presentation sizing keeps the same body baseline and horizontal
  // center. Source bounds/pixels and the default (including Cards) stay intact.
  const scale = Math.min(width / contentWidth, height / contentHeight) * visualScale;
  return { left: (width - contentWidth * scale) / 2 - x * scale,
    top: height - (y + contentHeight) * scale,
    width: sprite.width * scale, height: sprite.height * scale };
}
