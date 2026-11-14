# Native themes and agent adapters

The standalone Chiikawa palette lives in
[theme-chiikawa/palette.js](../../theme-chiikawa/palette.js). Its `chiikawa` bundle
installs only `themes/herdr-chiikawa.json`: no agent view, layout, key bindings or
CLI configuration changes. Install with `./install.sh chiikawa`, then select it
in Settings → Look. Install `agents` separately for card/village presentation.

Herdr's effective native theme is the single authority. `../themes.js` maps
native theme IDs to optional agent artwork and layouts; it owns no active
palette. Cards and village consume native semantic colors unchanged. The
workspace toolbar contains view controls, not a second theme selector.

To add a theme, define its palette package and generate its native JSON with:

```sh
node scripts/build-agent-themes.mjs
node scripts/build-agent-themes.mjs --check
```

Declare the theme file in its own bundle. Add an agent adapter only if that theme
needs distinct artwork or presentation. Keep all 16 ANSI colors readable against
the theme background. The installer preserves user-owned theme files and keeps
Codex/Claude configuration unchanged. `legacy-theme.js` is a frozen migration
snapshot, not a second palette definition.

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

While the native Settings theme is Chiikawa, `theme-contrast.js` raises
Herdr's `minimum_contrast` to 1.6 (unless the user already chose a stronger
value). Herdr corrects unreadable text against each cell's actual background,
including existing user messages and diffs in Codex and Claude. This gentle
threshold keeps distinguishable syntax colors instead of flattening them into
black/white. It does not
replace the program's RGB backgrounds. Selecting another native theme restores the exact
previous setting, including an absent field; later manual changes are preserved.
Writes compare the settings snapshot and retry stale writes, preserving other keys.

This is a host-wide preference while enabled, not a per-terminal override.
Other Herdr windows also see it. The host currently has no per-layout contrast
or RGB-remapping API. Full, automatically reversible pastel backgrounds for
both CLIs therefore need a host renderer extension; palette tokens alone cannot
provide that behavior.

An isolated [native renderer experiment](../../../skills/herdr-theme-compat/references/native-renderer.md)
adds exact background replacement rules to theme data and redraws existing
cells without restarting a CLI. It is not part of the normal installer and
does not replace the official Herdr application. Its verification and upstream
version are recorded separately so this optional extension does not become a
dependency of the mods.
