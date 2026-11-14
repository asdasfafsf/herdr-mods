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

Free-roaming residents use the single-character dancing Chiikawa, hopping Usagi and bouncing Hachiware animations. Each session keeps its character as its status changes. The other downloaded sticker sets are retained as available resources. The native renderer replays the PNG frames and offers a motion toggle.

## Village scenery

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
