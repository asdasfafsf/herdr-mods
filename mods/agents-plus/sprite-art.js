import { div, image } from "gpui-kit";

// Keep the same decoded image while the viewport advances through its frames.
export function spriteArt(sprite, id, art) {
  const atlas = sprite.atlas;
  return div().absolute().left(art.left).top(art.top).w(art.width).h(art.height).overflow_hidden()
    .child(image(sprite.path).id(id).absolute()
      .left(atlas ? -(atlas.frame % atlas.columns) * art.width : 0)
      .top(atlas ? -Math.floor(atlas.frame / atlas.columns) * art.height : 0)
      .w(art.width * (atlas?.columns || 1)).h(art.height * (atlas?.rows || 1)));
}
