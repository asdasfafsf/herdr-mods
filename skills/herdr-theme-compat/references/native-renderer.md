# Optional live terminal surfaces

This is an isolated native renderer experiment, separate from the mod installer.
`install.sh` does not download or install a modified Herdr, Rust, Zig or Cargo
dependencies. Codex and Claude configuration and binaries remain unchanged.

Codex 0.169.0 retains its startup terminal palette. Theme changes can therefore
leave explicit composer/message backgrounds in the previous appearance.
Sources: [palette cache](https://github.com/openai/codex/blob/rust-v0.169.0/codex-rs/tui/src/terminal_palette.rs),
[focus event](https://github.com/openai/codex/blob/rust-v0.169.0/codex-rs/tui/src/tui/event_stream.rs),
[upstream issue](https://github.com/openai/codex/issues/45163).

The patch adds optional theme rules at Herdr's cell-to-frame boundary. It leaves
PTY bytes, stored cell styles, session input and the core unchanged. Switching
themes invalidates the existing frame cache; the same cells can immediately be
shown with different colors without another program write. Removing the rules
restores the original output.

## Theme contract

Add exact source colors to a native theme's existing `colors` object:

```json
{
  "terminal_bg_292929": "#f1dfbd",
  "terminal_bg_212922": "#e6efd9",
  "terminal_bg_3c170f": "#f9e2d9"
}
```

These are examples, not an exhaustive Codex palette. Composer colors depend on
the terminal background when that Codex process started. Additional exact
source colors require theme data changes only, not another native build.

Rules apply to matching explicit backgrounds in every terminal using that theme;
they do not identify a CLI. No rules means unchanged rendering. Other colors,
selection, inverse video, box/block graphics and sprites stay unchanged. A text
color already readable on a mapped background stays unchanged; otherwise it
blends toward theme foreground until it reaches 4.5:1 contrast. Syntax hues are
retained where possible rather than replacing all text with one color.

## Isolated verification

Use the commit and toolchain versions in
[upstream.json](../assets/herdr-app/upstream.json), with Ghostty's pinned submodule.
From the skill directory, inspect an isolated checkout before preparing it:

```sh
python3 scripts/check.py --source /path/to/isolated/herdr-app --json
python3 assets/herdr-app/prepare.py /path/to/isolated/herdr-app
rustc --edition=2024 --test assets/herdr-app/terminal_surfaces.rs -o /tmp/herdr-surfaces-test
/tmp/herdr-surfaces-test
```

In that checkout:

```sh
cargo test --locked explicit_surface_colors_reload_without_program_output
cargo test --locked terminal_surfaces
```

The helper has no third-party dependencies. Full integration tests use Herdr's
existing locked dependencies. `prepare.py` rejects mismatched upstream source
and preserves existing files. Keep Cargo/Zig caches and app/core homes isolated
when testing. Do not launch the test build on the user's current app home.

## Distribution boundary

A changed renderer needs one native build. Theme edits thereafter are live data
changes. The least maintenance burden is upstream inclusion: users then receive
the capability through normal Herdr updates. A separate binary distribution
would require its own platform builds, release verification and compatibility
maintenance after upstream changes. This repository does not enable that
distribution or silently replace the user's official app.

The integration patch is based on Herdr's Apache-2.0 source; see [LICENSE](../assets/herdr-app/LICENSE).

## Verification evidence

The packaged patch was checked against the pinned Herdr 0.1.15 source on macOS:
51 terminal engine tests and 4 standalone surface-rule tests passed. The engine
test changes existing cell colors without adding program output, then removes
the rules and checks restoration, selection, inverse video and graphics. This is
source-level evidence; it does not assert that any installed app contains the patch.
