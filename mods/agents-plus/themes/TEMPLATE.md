# Add an agent resource pack

A resource pack supplies character and scene data. The shared engine owns sessions, statuses and speech,
character assignment, selection, dragging, roaming, Cards/Village and the native
terminal split. Do not copy those implementations into a pack.

1. Supply PNG animation frames, timing/source metadata and scene images under
   `mods/agents-plus/assets/<pack-id>/` so the `agents` bundle includes them.
2. Add a data module like `../pack-chiikawa.js`, then import and register it in
   `../resource-packs.js` under a unique ID. The shared Pack selector discovers
   every registered entry. No palette package or native theme ID is required.
3. If the pack has facing metadata, generate direction wrappers with
   `node scripts/build-sprite-directions.mjs` (also supports `--check`).
   No changes to view behavior, status definitions or terminal handling are needed.

```js
export const MY_PACK = {
  label: "My pack", layout: "village",
  art: "mods/agents-plus/assets/my-pack",
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

For a neutral GIF, set `animation: "originals/first.gif"` in its sprite record and keep its original dimensions. The engine reuses one native animated image, avoiding per-frame cache eviction. Numbered PNG frames remain the pause fallback; resuming the native GIF restarts its loop. Directional poses and APNG sources use the numbered frame path because this host does not animate APNGs or transform GIFs.

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
shared UI assets. Packs contain no native theme ID, palette tokens, contrast
policy or behavior callbacks. Palette and contrast policies belong to
`../themes.js` and Settings → Look. A Shin-chan pack, for example, would add
its own assets and metadata here; it would reuse every existing interaction.

An absent scene gives themed Cards. An invalid/empty resident pool or unknown
pack gives ordinary Cards. A palette package works without `agents`, and
`agents` works without a palette or other optional bundles.

Validate changes with `tests/theme-adapters.mjs` (run Node with
`--experimental-vm-modules`), resource integrity checks, both generators and
native rendering. Its second-pack fixture deliberately provides data only:
it must reuse speech, movement, focus and input with no Chiikawa paths.

`ag.resourcePack` persists the selection independently of `ag.presentation` and
native Settings. Automatic migration is stored separately in
`ag.resourcePackMigration`: a valid legacy standalone overview preference wins
over the initial native fallback regardless of toolbar mount order. An explicit
Pack selection always wins over either migration source. Later palette changes do
not select packs. An unavailable saved pack renders Plain without erasing its
ID. Plain and packs without scenes render Cards without erasing the user's
Cards/Village preference. Pack changes preserve session focus, drafts, filters,
pagination and resident positions; the shared engine releases any active drag.

To add an unrelated app palette, follow [the palette guide](README.md). It does
not require a resource pack, and a resource pack does not require a palette.

This is the repository contributor workflow. Do not customize an installed
`mods/agents-plus` folder: the installer replaces its files on updates. A separate
user pack importer and storage are proposed in the
[installation and customization design](../../../docs/agent-workspace-packs.md);
they are not implemented yet.
