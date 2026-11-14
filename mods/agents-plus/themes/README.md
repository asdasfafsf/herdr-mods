# Agent theme template

`../themes.js` owns each theme's UI colors and ANSI palette.
Layouts consume semantic colors; they must not replace the palette to repair a
terminal program's explicit RGB output.

To add a palette, copy the `chiikawa` registry entry, give it a unique `native`
name and fill all 16 `ansi0`–`ansi15` colors. Run:

```sh
node scripts/build-agent-themes.mjs
node scripts/build-agent-themes.mjs --check
```

Add the generated JSON to `agents.themes` in `bundles.json`. The installer
preserves user-owned files. CLI themes are not installed or selected:
a persistent CLI override would outlive Chiikawa mode.
Codex and Claude configuration files stay unchanged. Character artwork and scenery remain
Chiikawa-specific; adding another character world also needs its artwork adapter.

## Codex terminal rendering

Codex 0.169.0's `markup.inserted` / `markup.deleted` theme scopes can paint
pastel Edit fills, but `/theme` persists
inside Codex rather than following the Herdr mode toggle. Do not enable that
override automatically or send commands to working terminals.

Codex's input and submitted-message fills use the terminal background probed at
startup, independently of `/theme`. An already-running CLI can retain its old
dark fills after Herdr becomes light. A syntax-theme change alone cannot repair
that startup cache. Restart/resume only when the user is ready, or fix live
palette refresh upstream; do not interrupt a working session automatically.

## Immediate readability and restoration

While Chiikawa is selected in the workspace toolbar, `theme-contrast.js` raises
Herdr's `minimum_contrast` to 1.6 (unless the user already chose a stronger
value). Herdr corrects unreadable text against each cell's actual background,
including existing user messages and diffs in Codex and Claude. This gentle
threshold keeps distinguishable syntax colors instead of flattening them into
black/white. It does not
replace the program's RGB backgrounds. Selecting Default restores the exact
previous setting, including an absent field; later manual changes are preserved.
Writes compare the settings snapshot and retry stale writes, preserving other keys.

This is a host-wide preference while enabled, not a per-terminal override.
Other Herdr windows also see it. The host currently has no per-layout contrast
or RGB-remapping API. Full, automatically reversible pastel backgrounds for
both CLIs therefore need a host renderer extension; palette tokens alone cannot
provide that behavior.
