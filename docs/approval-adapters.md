# Shared approval adapters

Cards and Village display the same approval choices, including unselected local
residents beside the native terminal dock. Viewing or polling a request never
chooses an option. Unsupported prompts remain available in the terminal.

`mods/agents-plus/approval-providers.js` owns provider matching, menu parsing and
key planning. The shared controller in `session-controls.js` owns polling,
request identity, feedback and transport; views only render its state.

## Add a provider

For a numbered menu with one selection marker and arrow/Enter navigation, add:

```js
numberedApprovalAdapter({ id: "example", programs: ["example", "example-cli"] })
```

Register it in `APPROVAL_ADAPTERS`. No Card/Village changes are needed. A custom
adapter supplies `id`, `version`, `matches(live)`, `parse(screen)` and
`keys(request, choiceNumber)`. Parsing returns `choices` (number, exact label,
selected flag) and optional `context`; key planning returns a bounded array of
key names. Adapters must not call transport or own session/UI state.

Codex, Claude and Gemini numbered profiles are included. Their use requires a
foreground identity matching the reported provider and a complete screen with
an unambiguous menu. Wrapped labels, ANSI escapes and common menu borders are
accepted. An old menu followed by a new prompt is rejected. Interpreter-hosted
CLIs require an identity-aware adapter; a reported provider alone is insufficient.

## Lifecycle and limits

The host must report a live process, PID, creation timestamp, turn and status
timestamp, with `blocked` / `permission`. A parser alone does not provide that
lifecycle. In particular, registering the Gemini menu profile does not install
a Gemini status bridge or establish end-to-end support on an unconfigured host.

Before sending a clicked choice, the controller rereads the process and screen
and compares the complete displayed fingerprint. A different request requires
another reviewed click. Attempted requests stay suppressed for that lifecycle,
including uncertain sends and screen redraws; a late poll cannot restore them.
Transport never retries a decision automatically. `hc keys` has no atomic
compare-and-send request ID, so a concurrent terminal action after revalidation
remains a host limitation.

Visible local blocked rows are polled even without selection. Hidden scenes,
filtered/page-hidden rows and external sessions are excluded. Composer creation
preserves a previously polled request. Approval bubbles reserve their full size
in village layout and avoid each other while roaming; their controls scroll.

## Validation

Run `node --experimental-vm-modules tests/session-controls.mjs` and
`node --experimental-vm-modules tests/agents-render.mjs`. These use synthetic
transports only. They cover provider conflicts, wrapped/stale menus, scope,
request changes, late polls, uncertain sends, duplicate clicks and bubble layout.
They do not establish real-provider or native hit-testing coverage. Never send
test messages or approval decisions to real sessions. Reset-credit execution is
outside this workflow and must not be tested, including with mocks.

`node --experimental-vm-modules tests/workspace-provider-parity.mjs` combines
the production Scene/Split/Terminal controller with the shared approval
controller and adapters in an isolated VM. It checks Codex, Claude (including
`claude-code` and an absolute executable path), and Gemini (`gemini-cli`) with
synthetic permission screens. Each case cycles 30 times without choosing a
permission, preserves the original native tab tree and focus, and verifies an
explicit decision still targets its displayed session when another provider
is focused. In-flight duplicate clicks, eight stale-request variants, uncertain
sends, seven unsupported/lifecycle fallbacks, and a synthetic adapter extension
are also covered. The VM allows only the four production modules needed for
this check and in-memory layout/focus/get/read/keys transports.

These cases establish source-level and synthetic controller parity, not current
CLI screen compatibility, live status-bridge availability, native focus/input
behavior or end-to-end approval delivery for any provider. The presentation
controller does not select an adapter or change provider permission policies.
