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
supports live surface roles for known Codex backgrounds. The four optional
colors in the standalone palette are:

| Color | Surface |
| --- | --- |
| `terminal_codex_input` | Current prompt |
| `terminal_codex_history` | Submitted messages |
| `terminal_codex_add` | Added diff lines |
| `terminal_codex_delete` | Deleted diff lines |

All four opt in together on a host that reports the adapter capability. Stock
Herdr ignores these names, so the same theme file remains compatible. The
adapter preserves the underlying terminal cells and redraws existing output
when theme data changes. It remembers the opt-in for that Codex process: after
leaving Chiikawa, recognized surfaces follow the new native palette instead of
retaining light fills in a dark theme. A different Codex process clears that
opt-in; temporarily opening another program suspends the adapter until the same
Codex process returns.
This intentionally corrects stale surfaces after a theme switch; it does not
change Codex preferences or rewrite terminal bytes. Other programs do not enter
the Codex adapter. Unknown startup/custom syntax colors remain unchanged.

Use the compatibility skill's read-only check to distinguish a source-tested
patch from an executable that actually reports the capability. The extension
is not part of the normal installer and does not replace or restart the official
Herdr application. Its pinned source, tests and build remain separate from the
mods' dependencies. Literal `terminal_bg_RRGGBB` rules remain available for
explicit custom mappings; those rules are not provider-specific.
