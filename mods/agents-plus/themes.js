// Theme tokens and artwork live here; layouts never choose their own palette.
export const THEMES = {
  default: { label: "Default", layout: "cards" },
  chiikawa: {
    label: "Chiikawa", layout: "village", art: "mods/agents-plus/assets/chiikawa",
    residents: ["done", "hachiware", "idle", "rakko", "momonga", "kurimanju"],
    colors: {
      background: "#f8f5ec", canvas: "#f4ecdb", surface: "#fffaf0", foreground: "#503c2e",
      terminal_foreground: "#503c2e", muted: "#7b6957", dim: "#95816b", raised: "#fffaf0",
      chrome: "#f4ecdb", popover: "#fffaf0", border: "#d7c8ad", input: "#bbaa8d",
      hover: "#f4ecd9", selected: "#f1dfbd", selection: "#e5d6ab", accent: "#8b6744",
      accent_foreground: "#fffaf0", solid: "#80603f", solid_foreground: "#fffaf0",
      working: "#58764b", blocked: "#ba5b4a", done: "#488aa0", idle: "#a09680", unknown: "#a09680",
    },
  },
};
export const VIEW_LAYOUTS = [["cards", "Cards"], ["village", "Village"]];
export function themeTokens(base, name) { return { ...base, ...(THEMES[name]?.colors ?? {}) }; }
