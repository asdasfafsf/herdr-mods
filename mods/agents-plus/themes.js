// Register presentation data here; palettes remain independently installable.
import { CHIIKAWA_ADAPTER } from "./theme-chiikawa.js";
export const THEMES = {
  default: { label: "Default", layout: "cards" },
  chiikawa: CHIIKAWA_ADAPTER,
};
export const VIEW_LAYOUTS = [["cards", "Cards"], ["village", "Village"]];
export const themeDefinition = (skin) => THEMES[skin] || THEMES.default;
export function residentPool(skin) {
  const definition = themeDefinition(skin);
  if (!Array.isArray(definition.residents) || typeof definition.art !== "string") return [];
  return [...new Set(definition.residents)].filter((name) => {
    const sprite = definition.sprites?.[name];
    return typeof name === "string" && [sprite?.width, sprite?.height, sprite?.duration].every((value) => Number.isFinite(value) && value > 0)
      && Number.isInteger(sprite?.frames) && sprite.frames > 0 && Array.isArray(sprite.durations)
      && sprite.durations.length === sprite.frames && sprite.durations.every((ms) => Number.isFinite(ms) && ms > 0);
  });
}
export const hasResidents = (skin) => residentPool(skin).length > 0;
export const hasVillage = (skin) => hasResidents(skin)
  && [themeDefinition(skin).scene?.width, themeDefinition(skin).scene?.height].every((value) => Number.isFinite(value) && value > 0);
export function themeTokens(base) { return base; }
