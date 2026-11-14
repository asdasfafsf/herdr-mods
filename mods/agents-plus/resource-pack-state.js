// One saved pack for every agent surface. Herdr persists shared preferences;
// choosing artwork never mutates layout, native focus, palette or CLI settings.
import { shared, setShared } from "herdr";
import { RESOURCE_PACKS } from "./resource-packs.js";

export const RESOURCE_PACK = "ag.resourcePack";
const MIGRATION = "ag.resourcePackMigration";
const registered = (key) => Object.hasOwn(RESOURCE_PACKS, key);

export function initResourcePack(legacy, source = "native") {
  // A choice made in the Pack selector always wins, including unknown IDs.
  if (shared(RESOURCE_PACK) != null) return;
  const migrated = shared(MIGRATION);
  // Native fallback is captured once. A later-mounted standalone overview can
  // contribute its explicit old preference, regardless of toolbar mount order.
  if (migrated && (source !== "overview" || migrated.source === "overview")) return;
  if (registered(legacy)) setShared(MIGRATION, { pack: legacy, source });
  else if (!migrated) setShared(MIGRATION, { pack: "default", source: "native" });
}

// Keep an unavailable pack's saved ID so reinstalling it restores the choice.
// Until then the common engine renders ordinary cards.
export function selectedResourcePack() {
  const saved = shared(RESOURCE_PACK) ?? shared(MIGRATION)?.pack;
  return registered(saved) ? saved : "default";
}

export function selectResourcePack(key) {
  if (registered(key)) setShared(RESOURCE_PACK, key);
}
