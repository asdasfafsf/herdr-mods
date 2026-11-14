# Optional live terminal surfaces

This optional native source patch stays separate from the mod installer.
`install.sh` does not download or install a replacement Herdr, Rust, Zig or Cargo
dependencies. Codex and Claude configuration and binaries remain unchanged.

Codex 0.169.0 retains its startup terminal palette. Theme changes can therefore
leave explicit composer/message backgrounds in the previous appearance.
Sources: [palette cache](https://github.com/openai/codex/blob/rust-v0.169.0/codex-rs/tui/src/terminal_palette.rs),
[focus event](https://github.com/openai/codex/blob/rust-v0.169.0/codex-rs/tui/src/tui/event_stream.rs),
[surface formulas](https://github.com/openai/codex/blob/rust-v0.169.0/codex-rs/tui/src/style.rs),
[diff palette](https://github.com/openai/codex/blob/rust-v0.169.0/codex-rs/tui/src/diff_render.rs).

The patch maps colors at Herdr's cell-to-frame boundary. PTY bytes, stored cell
styles, session input and core data remain unchanged. Changing theme tokens
invalidates the frame cache even when the base background is unchanged. Existing
cells refresh without another program write or a Codex restart.

## Theme contract

A theme opts foreground Codex processes in with all four hex-valued colors:

```json
{
  "terminal_codex_input": "#f1dfbd",
  "terminal_codex_history": "#f4ecdb",
  "terminal_codex_add": "#e6efd9",
  "terminal_codex_delete": "#f9e2d9"
}
```

The active foreground process's program key must be `codex`, with a valid PID.
A stale agent status report is insufficient. No complete opt-in means unchanged
rendering. These keys are inert in the official app without this patch.

The adapter learns exact composer, submitted-prompt, HUD, quiet and hover fills
from the backgrounds observed while that Codex process runs. It uses Codex
0.169's floating-point blend and truncation, preserving arbitrary observed light
and dark base palettes. Known Herdr 0.1.15 defaults, the bundled Chiikawa base,
Codex's fallback history, and known truecolor/ANSI-256 fallback diff fills also
cover common already-running sessions. Different light diff gutters retain their
own role. Up to 64 base palettes are retained; ambiguous source colors stay
unchanged instead of guessing a role.

After opt-in, selecting a plain theme derives native Codex surfaces from its
current background, including light/dark diff colors. Thus light-started Codex
cells repaint correctly on a dark theme, and dark-started cells repaint in
Chiikawa. Plain theme files do not need extra rules. Opt-in belongs to that
process: an external editor or other foreground program suspends mapping, and
returning to the same Codex PID resumes it. A different Codex PID starts without
the previous process's opt-in.

Unknown custom startup palettes from **before attachment** cannot be recovered
from Herdr core's terminal metadata. Such colors remain untouched. Arbitrary
syntax-theme diff backgrounds and quantized composer colors are not inferred.
An explicit, verified source rule can extend coverage without another build:

```json
{
  "terminal_bg_292929": "#f1dfbd"
}
```

Exact `terminal_bg_RRGGBB` rules apply to every terminal in that theme and take
precedence over semantic mappings on the original cell color. Removing an exact
rule restores its original output unless the Codex semantic adapter independently
matches that source. Exact rules alone have no cross-theme memory.

Other colors, selection, inverse video, box/block graphics and sprites remain
unchanged. Text readable on a mapped fill keeps its color; otherwise it blends
toward theme foreground until 4.5:1 contrast. Distinct syntax hues are preserved
where possible. This is a bounded adapter for verified Codex surfaces, not a
universal rewrite of arbitrary terminal RGB output. Claude follows the normal
native palette; no Codex-specific semantic mapping is applied to it.

## Isolated verification

Use the commit and toolchain versions in
[upstream.json](../assets/herdr-app/upstream.json), including Ghostty's submodule.
From the skill directory, inspect an isolated checkout before preparing it:

```sh
python3 scripts/check.py --source /path/to/isolated/herdr-app --json
python3 assets/herdr-app/prepare.py /path/to/isolated/herdr-app
rustc --edition=2024 --test assets/herdr-app/terminal_surfaces.rs -o /tmp/herdr-surfaces-test
/tmp/herdr-surfaces-test
```

In that checkout, using isolated Cargo/Zig caches and the locked toolchain:

```sh
cargo test --offline --locked --bin herdr-app terminal_surfaces --no-default-features
cargo test --offline --locked --bin herdr-app codex_surface --no-default-features
cargo test --offline --locked --bin herdr-app explicit_surface_colors_reload_without_program_output --no-default-features
cargo build --offline --locked --bin herdr-app
./target/debug/herdr-app --capabilities
```

`--bin herdr-app` keeps unrelated GUI screenshot harnesses out of these source
checks. The helper uses only Rust's standard library. Full integration tests use
Herdr's existing locked dependencies. `prepare.py` rejects changed upstream
files and preserves personal edits; it does not download, build or install.

The read-only capability command returns schema 1, `terminal_surface_rules: 1`,
`codex_semantic_surfaces: 1`, `paint_only: true` and the supported Codex style
version. It exits before GUI, configuration or core initialization. The checker
probes it only if `--help` advertises the command:

```sh
python3 scripts/check.py --executable /path/to/isolated/herdr-app/target/debug/herdr-app --json
```

`capabilities_verified` describes **that executable**, not a running window.
A version string or source hash alone does not prove native support.

## Activation and distribution

A changed renderer requires one native build. Theme edits thereafter are live
data changes. The preferred distribution path is upstream inclusion through
normal Herdr updates; this repository does not distribute replacement apps or
silently overwrite the official app.

Preparing and testing an isolated artifact does not activate it. Before using a
replacement app, review its platform build, capability report and source hashes;
retain the official app for rollback. Activating it requires an explicit app
replacement/restart decision. Do not stop or restart the user's current app/core
as part of a compatibility check. Any separate native UI verification must use
isolated app/core homes and synthetic terminal output, never live test messages,
approvals or reset-credit execution. Do not run a bare debug executable on the
user's current home.

## Verification evidence

The patch includes standalone source-role/contrast tests and real Ghostty cell
frame tests for observed arbitrary dark/light startup backgrounds, Chiikawa
opt-in, return to plain dark, source buffer preservation, same-base token edits,
exact-rule precedence, syntax contrast, selection, inverse video, graphics,
foreground suspension/resumption and fresh-process isolation. These tests feed
synthetic terminal bytes only. Passing source tests or a capability probe is not
screenshot verification and does not assert that the installed app was replaced.

The integration patch is based on Herdr's Apache-2.0 source; see
[LICENSE](../assets/herdr-app/LICENSE).
