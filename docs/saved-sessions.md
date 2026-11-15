# Saved-session sidebar integration

Saved history is appended after every live sidebar group, including Idle, for
both priority and grouped sorting. The shared presentation registry defines its
neutral label/color separately from live statuses. History is never published
to `ag.info` or `ag.order` and never creates Cards/Village residents.

The sidebar initially shows eight rows, with Show more up to the newest 60
eligible sessions. It refreshes every 45 seconds while the window is active and
the sidebar is expanded, or on Refresh. Provider ownership errors are visible;
unknown ownership does not imply a stopped session. This is recent history,
not an exhaustive archive browser.

`mods/agents-plus/saved.py` reads local files and process ownership only:

- `python3 -I saved.py` returns `{rows, errors}`. A row is
  `{agent, session, cwd, title, updated}`, with a UUID identity, absolute existing
  folder, title and epoch-seconds timestamp. It carries no executable argv.
- `python3 -I saved.py check JSON` re-reads the selected identity and folder,
  rejects removed/archived/internal/unsupported records, and returns
  `{running, record}`. Errors exit nonzero with a user-facing explanation.
- Transcript reads are bounded to 300 candidates per provider, 64 KiB head/tail
  excerpts, a 64 KiB Codex name-index tail and bounded SQLite queries. File-name
  and modification-time discovery can still enumerate the local history tree.

The UI validates the check response, rechecks Herdr attachment after the async
probe, and uses `savedResumeRecord` plus the shared `resumeArgv`. It preserves
the same provider/session/folder, strips session selectors and starting prompts,
does not fork or translate, and ignores argv supplied by history. Installed
launch settings remain the source of executable/model flags. Codex cwd/image
startup arguments are removed; a configured remote launch is rejected for local
history. Paths/titles are structured arguments, never shell text.

The existing `spaces-plus.resume@JSON` routing is used when available, with a
standalone local-space fallback. An exited terminal's stale LIVE mapping is not
focused. A pending click is locked until its check finishes, then suppressed for
15 seconds while the terminal appears. There is no atomic cross-app lease or
launch acknowledgement: another app can reopen a session after the ownership
probe, and a host launch failure can require Refresh/retry.

## Native Codex desktop dependency

The separate `feat/native-app-session` worker owns native desktop discovery,
source eligibility, writer ownership and bidirectional handoff semantics. Its
integration report is `/private/tmp/herdr-native-app-session-result.md`.

This feature intentionally retains CLI/legacy-only Codex discovery until that
adapter is available. An unrecognized/native source must not be made resumable
merely by broadening the source allowlist. Integrate the worker's read-only
metadata and ownership checks into both `codex_rows` and `check`; preserve the
row/check contract above so sidebar presentation remains independent. An idle
native server owning a conversation is still an owner: the worker must define
the safe handoff instead of treating it as stopped. The current UI reports a
running owner and asks the user to close it before refreshing.

`lib/agentfiles.py` adds optional `codex_metadata(limit=None, sessions=None)` and
`codex_names(tail=None)` bounds while retaining their existing default behavior.
Both workers may touch this shared module; retain those bounds when resolving
integration changes. No native return-to-app command or active-writer handoff is
implemented by the saved-history sidebar commit alone.

Synthetic verification is in `test_saved_sessions.py` and `agents-render.mjs`.
The workspace runner includes both. Real app appearance and actual native/CLI
round trips remain parent integration checks; no user session is resumed by
these tests.
