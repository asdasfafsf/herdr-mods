// Agent presentation adapters keyed by the effective native theme.
// Palettes are independently installed theme packages, never agent-view state.
export const THEMES = {
  default: { label: "Default", layout: "cards" },
  chiikawa: {
    label: "Chiikawa", native: "herdr-chiikawa", layout: "village", art: "mods/agents-plus/assets/chiikawa",
    residents: ["done", "hachiware", "idle", "rakko", "momonga", "kurimanju"],
  },
};
export const VIEW_LAYOUTS = [["cards", "Cards"], ["village", "Village"]];
export function themeTokens(base) { return base; }
