// Presentation-only adapter. Session behavior lives in the shared view engine.
import { SPRITES } from "./theme-assets.js";
export const CHIIKAWA_PACK = {
  label: "Chiikawa", layout: "village",
  art: "mods/agents-plus/assets/chiikawa",
  frameAtlas: "atlases",
  residents: ["rakko", "hachiware", "idle", "done", "momonga", "kurimanju", "shisa", "yoroi", "anoko", "chiikabu", "momonga-heart", "chiikawa-fairy", "usagi-dance", "hachiware-dance", "chiikawa-bounce"],
  sprites: SPRITES,
  // Village-only optical balance against the unchanged Hachiware/Usagi poses:
  // Rakko/Shisa body-fit enlarges their faces and lettering; Kurimanju is a close-up.
  // A resident's scale applies to every motion resource, never individual frames.
  villageScale: { rakko: 0.8, kurimanju: 0.85, shisa: 0.75 },
  // 0 is a frontal pose; never mirror source lettering. Kurimanju only turns
  // during the four text-free drinking frames, keeping caption frames intact.
  facing: { idle: 1, momonga: -1, hachiware: -1, done: -1,
    kurimanju: [0, -1, -1, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  motions: {
    // These source poses look left while drinking; there is no rear-view walk.
    // Keep captioned/frontal poses at rest and use the side poses for travel.
    kurimanju: { directions: ["left", "right"], idle: { sprite: "kurimanju" },
      left: { sprite: "kurimanju", frames: [1, 2, 3, 4], facing: -1 },
      right: { sprite: "kurimanju", frames: [1, 2, 3, 4], facing: 1 } },
  },
  scene: {
    width: 1400, height: 900, background: "#c3dea0",
    layers: [
      { x: 0, y: 0, width: 1400, height: 224, color: "#e8f5f8" },
      { path: "village/field.png", x: 0, y: 0, width: 1400, height: 1400 * 1492 / 3840 },
      { path: "village/trees-left.png", x: -32, y: 468, width: 100, height: 262 },
      { path: "village/trees-right.png", x: 1332, y: 288, width: 100, height: 100 * 8706 / 916, clipHeight: 264 },
      { path: "village/stump.png", x: 910, y: 648, width: 64, height: 25 },
    ],
  },
};
