# Add a presentation theme

A theme supplies data. The shared engine owns sessions, statuses and speech,
character assignment, selection, dragging, roaming, Cards/Village and the native
terminal split. Do not copy those implementations into a theme.

1. Copy `mods/theme-chiikawa/palette.js` to `mods/theme-your-name/palette.js`.
   Keep its semantic color keys, choose a unique `native` name, and replace the
   colors. `node scripts/build-agent-themes.mjs` discovers `theme-*` packages.
   Declare the generated JSON in a standalone bundle as `chiikawa` does.
2. Supply original PNG animation frames, timing/source metadata and scene images.
   Add a presentation definition like the one below, then register it in
   `../themes.js` under a unique key. The `native` value must match the palette.
3. Generate direction wrappers with `node scripts/build-sprite-directions.mjs`.
   Both generators support `--check`. No engine changes are needed.

```js
export const MY_ADAPTER = {
  label: "My theme", native: "my-theme", layout: "village",
  art: "mods/my-theme-art/assets",
  residents: ["first", "second"],
  sprites: {
    first: { width: 160, height: 200, frames: 2,
      durations: [100, 100], duration: 200, content: [10, 20, 140, 170] },
    second: { width: 200, height: 200, frames: 2,
      durations: [80, 120], duration: 200 },
  },
  facing: { first: -1, second: [0, 1] },
  scene: { width: 1400, height: 900, background: "#dce9c5", layers: [
    { path: "field.png", x: 0, y: 0, width: 1400, height: 900 },
  ] },
};
```

For a neutral GIF, set `animation: "originals/first.gif"` in its sprite record and keep its original dimensions. The engine reuses one native animated image, avoiding per-frame cache eviction. Numbered PNG frames remain the pause fallback; resuming the native GIF restarts its loop. For APNG and directional poses, set `frameAtlas: "atlases"` on the adapter and run `node scripts/build-sprite-atlases.mjs` (or `--check`). It embeds unchanged PNG bytes into one SVG grid per orientation. The shared renderer advances a clipped viewport, retaining the loaded image across loops and pause/resume. Caption frames keep their original orientation. Packs without this metadata retain the numbered-frame fallback.

Frames are `first/001.png`, `first/002.png`, etc. Durations are milliseconds.
`content` and optional `body` are `[x, y, width, height]`: layout bounds only,
never image crops. Cards fit the entire content; Village can fit a body reference
so captions or effects do not shrink the character. Every original pixel stays
in the frame.

Facing is `-1` left, `1` right or `0` neutral. An array describes individual
frames, allowing caption-free poses to turn while lettered frames stay intact.
Generated SVG wrappers embed the exact PNG bytes and transform them at display
time. Omit facing for poses that should never be mirrored.

Scene dimensions are fixed; the viewport crops the scene. Layers accept `path`
and/or `color`, rectangle coordinates and optional `clipHeight`. Speech bubbles,
labels, focus rings and controls use the current native palette; speech tails are
shared UI assets. `contrast: true` opts into the reversible existing contrast
policy; omit it to keep the person's terminal contrast setting unchanged.

An absent scene gives themed Cards. An invalid/empty resident pool or unknown
adapter gives ordinary Cards. A palette package works without `agents`, and
`agents` works without a palette or other optional bundles.

Validate changes with `tests/theme-adapters.mjs` (run Node with
`--experimental-vm-modules`), resource integrity checks, both generators and
native rendering. Its second-theme fixture deliberately provides data only:
it must reuse speech, movement, focus and input with no Chiikawa paths.

### Movement clips

An optional `motions` map selects each resident's `idle`, `left`, `right`,
`up`, or `down` clip from actual movement, independently of agent status.
Each clip can select `sprite`, zero-based `frames`, and horizontal `facing`.
Missing direction clips fall back to `idle`; missing metadata retains the
original animation. `directions` restricts roaming to directions with usable
artwork (for example `["left", "right"]` when no rear pose exists).

```js
motions: { resident: {
  directions: ["left", "right"],
  idle: { sprite: "resident" },
  left: { sprite: "resident", frames: [1, 2, 3, 4], facing: -1 },
  right: { sprite: "resident", frames: [1, 2, 3, 4], facing: 1 },
} }
```

Frame subsets keep source durations and restart on motion changes. They use
the same atlas through every loop. A GIF clip with a frame subset needs a
generated atlas or falls back to the numbered source frames. The current
Kurimanju pack reuses drinking side poses; it does not contain walking or
rear-view artwork. Its full captioned animation plays while stationary.
