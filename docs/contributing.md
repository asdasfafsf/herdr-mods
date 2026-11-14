# Contribution rules

## Commits and delivery

- Use Conventional Commits: `type(scope): imperative summary` in English.
- Types: `feat`, `fix`, `refactor`, `docs`, `test`, `build`, `chore`, `perf`.
- Prefer meaningful scopes such as `agents`, `theme`, `installer`, or `docs`.
- Examples: `fix(theme): preserve input contrast without losing syntax colors`,
  `refactor(agents): share status definitions across all views`.
- Keep each commit focused on one completed change. Run the checks relevant to
  that change, inspect their results, and then commit. Do not commit after a
  failed check just because a later command succeeded.
- When the user requests continuous delivery, commit and push each finished
  unit. Do not rewrite already-pushed history just to rename older messages.

## Shared presentation data

- Status names, priority, color roles, icons and fallback messages belong in one
  shared definition. Sidebar, cards, village and picker must consume it.
- Derive displayed status from the host state and shared read/seen metadata.
  Do not keep independent status state in each presentation.
- Application labels are English. User messages and agent output keep their
  original language. Keep `Seen`; hide only `Idle` in Agent mode unless selected.
- Terminal and Agent are presentations of one workspace with shared focus.
  Cards and Village share a header; their controls stay in the workspace toolbar.

## Themes and validation

- Preserve the selected theme's identity when improving readability. Use shared
  semantic palette tokens and [the theme template](../mods/agents-plus/themes/README.md).
- Changes specific to Chiikawa must restore the user's prior settings when
  selecting Default. Do not permanently change Codex or Claude configuration.
- Verify visible changes in the native app when possible, including input,
  submitted messages and Edit output. Do not claim screenshot verification from
  synthetic rendering tests alone.
- Never send test messages or test approval decisions to real agent sessions.
  Use synthetic transports for those checks.
- Never execute or test reset-credit redemption, even using mocks. Keep work in
  that area read-only and limited to diagnostic logs.
