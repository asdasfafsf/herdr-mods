// The host redraws existing terminal cells when this setting changes. It works
// for Codex, Claude and other CLIs without changing their configs or sending keys.
import { appHome, readTextFile, writeTextFile, shared, setShared } from "herdr";

const KEY = "ag.themeContrastBackup";
// Match the host's gentle readability correction: repair nearly invisible
// cells without flattening syntax highlighting into black and white.
const CONTRAST = 1.6;
let desired = false, pending = null;

export function setThemeContrast(enabled) {
  desired = enabled;
  if (pending) return pending;
  pending = (async () => {
    let applied;
    do {
      const target = desired;
      let complete = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const file = `${appHome()}/settings.json`;
        const raw = await readTextFile(file);
        const settings = raw == null ? {} : JSON.parse(raw);
        if (!settings || Array.isArray(settings) || typeof settings !== "object") throw new Error("Invalid settings.json");
        let backup = shared(KEY);
        const current = settings.minimum_contrast;
        if (target) {
          // Preserve an existing stronger preference, including changes made
          // while Chiikawa is active. Never repeatedly override the user.
          if (backup) {
            const updated = Math.max(CONTRAST, Number(backup.value ?? 1));
            if (current !== backup.applied || current === updated) { complete = true; break; }
            // Migrate our earlier stronger correction, keeping its original
            // restore value and any stronger pre-existing user preference.
            backup = { ...backup, applied: updated };
            settings.minimum_contrast = updated;
          } else {
            if (Number(current ?? 1) >= CONTRAST) { complete = true; break; }
            backup = { present: Object.hasOwn(settings, "minimum_contrast"), value: current ?? null, applied: CONTRAST };
            settings.minimum_contrast = CONTRAST;
          }
        } else {
          if (!backup) { complete = true; break; }
          if (current !== backup.applied) { setShared(KEY, null); complete = true; break; }
          if (backup.present) settings.minimum_contrast = backup.value;
          else delete settings.minimum_contrast;
        }
        try {
          await writeTextFile(file, JSON.stringify(settings, null, 2) + "\n", raw);
          setShared(KEY, target ? backup : null);
          complete = true;
          break;
        } catch (error) {
          if (attempt === 2) throw error;
        }
      }
      if (complete) applied = target;
    } while (applied !== desired);
    setShared("ag.themeContrastError", null);
  })().catch((error) => {
    setShared("ag.themeContrastError", "Terminal contrast could not be updated.");
    console.warn(`agents-plus: theme contrast: ${error.message}`);
  }).finally(() => { pending = null; });
  return pending;
}
