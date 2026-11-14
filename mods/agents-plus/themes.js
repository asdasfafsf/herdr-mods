// Native app palette policies only; agent resource packs never select a palette.
export const THEMES = {
  default: { label: "Default" },
  chiikawa: { label: "Chiikawa", native: "herdr-chiikawa", contrast: true },
};
export const themeDefinition = (name) => THEMES[name] || THEMES.default;
