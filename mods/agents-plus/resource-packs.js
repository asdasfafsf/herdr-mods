// Character and scene metadata only. Native palettes live in themes.js.
import { CHIIKAWA_PACK } from "./pack-chiikawa.js";
export const RESOURCE_PACKS = {
  default: { label: "Plain", layout: "cards" },
  chiikawa: CHIIKAWA_PACK,
};
export const VIEW_LAYOUTS = [["cards", "Cards"], ["village", "Village"]];
export const packDefinition = (pack) => Object.hasOwn(RESOURCE_PACKS, pack) ? RESOURCE_PACKS[pack] : RESOURCE_PACKS.default;
export function residentPool(pack) {
  const definition = packDefinition(pack);
  if (!Array.isArray(definition.residents) || typeof definition.art !== "string") return [];
  return [...new Set(definition.residents)].filter((name) => {
    const sprite = definition.sprites?.[name];
    return typeof name === "string" && [sprite?.width, sprite?.height, sprite?.duration].every((value) => Number.isFinite(value) && value > 0)
      && Number.isInteger(sprite?.frames) && sprite.frames > 0 && Array.isArray(sprite.durations)
      && sprite.durations.length === sprite.frames && sprite.durations.every((ms) => Number.isFinite(ms) && ms > 0);
  });
}
export const hasResidents = (pack) => residentPool(pack).length > 0;
export const hasVillage = (pack) => hasResidents(pack)
  && [packDefinition(pack).scene?.width, packDefinition(pack).scene?.height].every((value) => Number.isFinite(value) && value > 0);
