# Chiikawa theme artwork

The existing agent overview uses this artwork as an optional village theme. Sessions, filters, sorting, pagination and navigation are shared with the default card theme. The Chiikawa theme lets residents wander around the village. Small labels show current status. Speech bubbles preview unread answers or requests needing user input; full details appear when a resident is selected.

The six animations are public previews from Doga Kobo (動画工房), Anime Chiikawa animated LINE stickers vol.1 and vol.2. Copyright: ©nagano / chiikawa committee. These character assets are not covered by this repository's code license. Retrieved 2026-11-14.

| Asset | Animation | Source | Original public preview |
| --- | --- | --- | --- |
| `walk` | Trio walking | [LINE STORE](https://store.line.me/stickershop/product/32367501/ja) | [APNG 805188762](https://stickershop.line-scdn.net/stickershop/v1/sticker/805188762/iPhone/sticker_animation@2x.png?v=1) |
| `study` | Chiikawa studying | [LINE STORE](https://store.line.me/stickershop/product/32855985/ja) | [APNG 816451486](https://stickershop.line-scdn.net/stickershop/v1/sticker/816451486/iPhone/sticker_animation@2x.png?v=1) |
| `done` | Chiikawa dancing | [LINE STORE](https://store.line.me/stickershop/product/32855985/ja) | [APNG 816451476](https://stickershop.line-scdn.net/stickershop/v1/sticker/816451476/iPhone/sticker_animation@2x.png?v=1) |
| `music` | Hachiware playing guitar | [LINE STORE](https://store.line.me/stickershop/product/32367501/ja) | [APNG 805188752](https://stickershop.line-scdn.net/stickershop/v1/sticker/805188752/iPhone/sticker_animation@2x.png?v=1) |
| `idle` | Usagi hopping | [LINE STORE](https://store.line.me/stickershop/product/32855985/ja) | [APNG 816451484](https://stickershop.line-scdn.net/stickershop/v1/sticker/816451484/iPhone/sticker_animation@2x.png?v=1) |
| `blocked` | Trio chatting | [LINE STORE](https://store.line.me/stickershop/product/32855985/ja) | [APNG 816451473](https://stickershop.line-scdn.net/stickershop/v1/sticker/816451473/iPhone/sticker_animation@2x.png?v=1) |

`originals/` retains the source APNGs and locally converted GIFs. The numbered PNG frames are decoded from APNG to preserve smooth, partially transparent edges. Each animation uses one fixed crop covering the union of all frames, with three pixels of padding. Original frame durations and crop coordinates are recorded in `manifest.json` and `../../theme-assets.js`. No runtime network request is made.

Free-roaming residents use Chiikawa, Usagi, Hachiware, Rakko, Momonga and Kurimanju animations. Each session keeps its character as its status changes. The other downloaded sticker sets are retained as available resources. The native renderer replays the PNG frames and offers a motion toggle.

## Additional residents

Retrieved 2026-11-14. Original pixels, transparency, lettering and frame timings are retained. No runtime downloads. These assets are not covered by the repository's code license.

| Resident | Source | Original | Frames |
| --- | --- | --- | --- |
| Rakko / 랏코 | [Doga Kobo LINE vol.2](https://store.line.me/stickershop/product/32855985/ja) | [APNG 816451482](https://stickershop.line-scdn.net/stickershop/v1/sticker/816451482/iPhone/sticker_animation@2x.png?v=1) | 370×300, 16×62.5ms |
| Momonga / 모몽가 | [Tenor, spritewhisper](https://tenor.com/en-GB/view/momonga-chiikawa-taunt-taunting-tail-wag-gif-10849976929610000049) | [GIF](https://media.tenor.com/lpLciCaWZrEAAAAj/momonga-chiikawa.gif) | 200×151, 22×50ms |
| Kurimanju / 쿠리만쥬 | [Doga Kobo LINE vol.1](https://store.line.me/stickershop/product/32367501/ja) | [APNG 805188758](https://stickershop.line-scdn.net/stickershop/v1/sticker/805188758/iPhone/sticker_animation@2x.png?v=1) | 370×300, 16×62.5ms |

The official previews are ©nagano / chiikawa committee; no open reuse license was found. Momonga is a community upload with an unverified official origin/reuse license. Session assignments remain stable while this view is open. Every available resident animation is assigned before any repeats; status, focus and sorting changes do not replace residents. Cards and Village share the assignments.

## Village scenery sources

Retrieved 2026-11-14 from the public official websites. The source images belong to their respective rights holders; no open reuse license was found. They are not covered by this repository's code license.

| File | Source page | Original image |
| --- | --- | --- |
| `village/field.png` | [Chiikawa Pocket](https://gl.chiikawa-pocket.com/en/) | [Village and meadow](https://gl.chiikawa-pocket.com/en/_astro/bgImage.CBD9E472.png) |
| `village/stump.png` | [Chiikawa Pocket Japan](https://jp.chiikawa-pocket.com/ja/) | [Stump](https://jp.chiikawa-pocket.com/ja/_next/static/media/Stump.8c49ae96.png) |
| `village/trees-left.png` | [Chiikawa anime](https://www.anime-chiikawa.jp/) | [Left trees](https://www.anime-chiikawa.jp/images/bg_top_tree_left_01.png) |
| `village/trees-right.png` | [Chiikawa anime](https://www.anime-chiikawa.jp/) | [Right trees](https://www.anime-chiikawa.jp/images/bg_top_tree_right_01.png) |

All source images retain their original pixels and transparency; native layout scales them and clips the tall right-tree strip.


## Free-roaming Hachiware

`hachiware/001.png`–`014.png` are lossless decoded frames of [Hachiware bouncing by eongeneral on Tenor](https://tenor.com/view/hachiware-bouncing-hachiware-jumping-hachiware-chiikawa-usagi-gif-5952144614043379929). [Original GIF](https://media.tenor.com/UppD_ZvPaNkAAAAj/hachiware-bouncing-hachiware-jumping.gif), retrieved 2026-11-14, 200 × 200, 14 frames, 700 ms. Original saved as `originals/hachiware.gif`; original frame timings and transparency retained. This is a community upload; an official origin or reuse license was not verified. Character rights remain with their respective owners, not this repository code license. SHA-256: `4d5d0a8ecf8b846e762a78d4f84003bd0108ee0fc517cc3ac6616681339c108c`.

## Directional presentation

`directional/` contains generated SVG wrappers for the text-free `idle`,
`momonga`, `hachiware`, `done` poses and the four text-free drinking frames (002–005) of `kurimanju`. Each wrapper embeds its corresponding
original PNG bytes unchanged and applies only an SVG horizontal transform.
Original animation timing, raster pixels, transparency and source attribution
are retained. Regenerate with `node scripts/build-sprite-directions.mjs`; check
with `node scripts/build-sprite-directions.mjs --check`.

Village residents choose the matching orientation from actual horizontal travel
(including dragging). Nearly vertical motion retains the prior facing. Cards
use the original pose. Frontal and lettered frames remain unchanged. Per-frame direction data keeps Kurimanju captions readable while turning the text-free side poses; it does not manufacture a walking animation from the original drinking animation.

## Expanded animated residents

Retrieved/checked 2026-11-15. Ten new animations are decoded from original public previews. Original bytes, dimensions, RGBA pixels, transparency and per-frame timings are retained; no crop, resizing, recoloring or generated artwork. FFmpeg source RGBA and decoded numbered PNG RGBA were compared byte for byte for every animation. All animations have multiple distinct frames.

| Asset | Character | Source | Original public preview | Canvas / frames / duration |
| --- | --- | --- | --- | --- |
| `rakko-sword` | Rakko | [einubs](https://tenor.com/view/rakko-chiikawa-usagi-hachiware-momonga-gif-7612991300417472473) | [Original](https://media.tenor.com/aabHQJuFx9kAAAAi/rakko-chiikawa.gif) | 274×274 / 127 / 6350 ms |
| `anoko` | Anoko | [Chimera111](https://tenor.com/view/transparent-anoko-chiikawa-gif-2415612012347946121) | [Original](https://media.tenor.com/IYX6U6cqdIkAAAAi/transparent-anoko.gif) | 498×498 / 17 / 930 ms |
| `chiikabu` | Chiikabu | [Miwuuuuuu](https://tenor.com/view/chiikabu-chiikawa-gif-9547867018433912183) | [Original](https://media.tenor.com/hIDWd2xr3XcAAAAi/chiikabu-chiikawa.gif) | 108×109 / 14 / 1680 ms |
| `momonga-heart` | Momonga | [K_isme](https://tenor.com/view/%EC%B9%98%EC%9D%B4%EC%B9%B4%EC%99%80-chiikawa-%EB%A8%BC%EC%9E%91%EA%B7%80-%ED%95%98%EB%8A%98%EB%8B%A4%EB%9E%8C%EC%A5%90-%EB%AA%A8%EB%AA%BD%EA%B0%80-gif-15055856194738441134) | [Original](https://media.tenor.com/0PElcJS_y64AAAAi/%EC%B9%98%EC%9D%B4%EC%B9%B4%EC%99%80-chiikawa.gif) | 282×282 / 18 / 1800 ms |
| `chiikawa-fairy` | Chiikawa | [meyoire](https://tenor.com/view/chiikawa-love-gif-chiikawa-love-chiikawa-fairy-chiikawa-wand-gif-1938037007611282315) | [Original](https://media.tenor.com/GuVKY-g7Q4sAAAAi/chiikawa-love-gif.gif) | 200×200 / 61 / 2560 ms |
| `usagi-dance` | Usagi | [UsagiEnjoyer](https://tenor.com/view/usagi-chiikawa-dance-fat-rabbit-gif-10827715909119384800) | [Original](https://media.tenor.com/lkPGQGvoHOAAAAAi/usagi-chiikawa.gif) | 446×480 / 18 / 800 ms |
| `hachiware-dance` | Hachiware | [Turtle00000](https://tenor.com/view/hachiware-dance-gif-8205439357428483133) | [Original](https://media.tenor.com/cd-Tnw2IxD0AAAAi/hachiware-dance.gif) | 450×443 / 140 / 14000 ms |
| `chiikawa-bounce` | Chiikawa | [meowingcx](https://tenor.com/view/chiikawa-gif-16440424583004264571) | [Original](https://media.tenor.com/5CgfDZqRmHsAAAAi/chiikawa.gif) | 300×276 / 20 / 1320 ms |
| `shisa` | Shisa | [Doga Kobo (動画工房)](https://store.line.me/stickershop/product/33799640/ja) | [Original](https://stickershop.line-scdn.net/stickershop/v1/sticker/838685767/iPhone/sticker_animation@2x.png?v=1) | 370×300 / 12 / 1000 ms |
| `yoroi` | Yoroi-san | [Doga Kobo (動画工房)](https://store.line.me/stickershop/product/33799640/ja) | [Original](https://stickershop.line-scdn.net/stickershop/v1/sticker/838685761/iPhone/sticker_animation@2x.png?v=1) | 370×300 / 20 / 1000 ms |

Each resource directory includes manifest.json containing its exact durations, original SHA-256, decoded RGBA SHA-256, union-alpha content bounds, facing hint and source attribution. Frame files use 001.png onward; originals are retained in originals/.

### Display guidance

- Rakko is text-free. Ground strokes touch all canvas edges, so alpha-union bounds alone cannot normalize its body size. Use approximate body reference [43, 34, 203, 210], scaling raw height by 274/210 for equal body height; 1.1× extra prominence is reasonable. This is layout sizing only, without cropping.
- Shisa and Yoroi-san retain original Japanese lettering and must not be mirrored. Their metadata includes separate approximate body bounds for display sizing.
- All selected poses are front-facing or front/back sequences. native_facing is 0. Avoid inventing a fixed left/right-facing default.
- Chiikabu source is small (108×109). Native village size is suitable; enlargement beyond source resolution will show the original pixel limits.

### Rights and exclusions

Official Shisa and Yoroi-san previews: ©nagano / chiikawa committee, Doga Kobo LINE animated sticker pack. Other additions are public community Tenor uploads; official origin and reuse permission are unverified. No open reuse license was found. Artwork is not covered by this repository code license.

Rejected: static Usagi barbell (1 frame); off-style Momonga spin; opaque/rectangular Shisa and Kani anime scene GIFs. No clean transparent animated Kani was located in this pass, so none was padded into the set.

Original bytes: 5,129,666. Decoded PNG bytes: 16,307,971. Total frames: 447.
