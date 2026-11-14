---
name: herdr-theme-compat
description: Check Herdr theme integration and compatibility of the optional live terminal surface patch after app updates, or prepare the matching source patch when requested. Use for stale Codex input backgrounds or Settings and Agent theme drift. This skill does not install or distribute a replacement app.
---

# Herdr theme compatibility

Keep the mod installation independent of a modified Herdr binary. The bundled
checker needs Python's standard library only; it downloads nothing and changes
no app, configuration or session data.

Run from this skill's directory, adjusting paths to the user's environment:

```sh
python3 scripts/check.py --json
python3 scripts/check.py --app-home /path/to/herdr-app --json
python3 scripts/check.py --source /path/to/isolated/herdr-app --json
```

`--app-home` optionally inspects only theme-related fields in settings, shared
state and the selected layout. `--layout NAME` selects another layout to inspect.
`--executable PATH` selects the Herdr binary queried with `--version`.

Distinguish the report's three kinds of evidence:

- `installation`: the installed executable's version. A matching version does
  **not** establish that the optional renderer feature is installed. Its runtime
  support remains `unknown`; do not treat source verification as a binary probe.
- `source`: complete hashes of affected upstream files and the bundled module.
  `compatible` means the pinned patch can be prepared; `already_applied` means
  those source files exactly match the packaged patch. Neither proves a build
  was installed. Exit code 2 signals an incompatible or modified source checkout.
- `theme`: configuration evidence of a legacy palette override or duplicated
  `ag.workspaceTheme` state. System appearance or unsaved live changes may make
  the effective theme unknown. Diagnose that uncertainty rather than guessing.

If Settings and Agent disagree, fix the mod's shared theme ownership first:
Herdr's effective native theme must be the single authority. Do not add another
current-theme flag or permanently change Codex/Claude preferences.

If the requested work needs native surface rules, read
[the renderer contract and verification procedure](references/native-renderer.md).
Prepare only a matching, isolated checkout:

```sh
python3 assets/herdr-app/prepare.py /path/to/isolated/herdr-app
```

For an unsupported version, report the changed files and leave that checkout
untouched. Porting the patch is source development requiring new tests, not a
forced apply. Use the user's existing authorization for implementation; a
compatibility-check request alone does not authorize building, replacing or
restarting their app. Never send live test messages or approval responses, and
never run or test reset-credit redemption.

Report what was checked, what is compatible, and what remains unverified. A
successful source test is not a claim that the user's displayed colors changed.
