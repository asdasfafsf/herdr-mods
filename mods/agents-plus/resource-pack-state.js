// One saved pack for every agent surface. Herdr persists shared preferences;
// choosing artwork never mutates layout, native focus, palette or CLI settings.
import { shared, setShared } from "herdr";
import { RESOURCE_PACKS } from "./resource-packs.js";

export const RESOURCE_PACK = "ag.resourcePack";
const registered = (key) => Object.hasOwn(RESOURCE_PACKS, key);

export function initResourcePack(legacy) {
  if (shared(RESOURCE_PACK) == null) setShared(RESOURCE_PACK, registered(legacy) ? legacy : "default");
}

// Keep an unavailable pack's saved ID so reinstalling it restores the choice.
// Until then the common engine renders ordinary cards.
export function selectedResourcePack() {
  const saved = shared(RESOURCE_PACK);
  return registered(saved) ? saved : "default";
}

export function selectResourcePack(key) {
  if (registered(key)) setShared(RESOURCE_PACK, key);
}
