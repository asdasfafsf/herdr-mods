// Synthetic host only: no real settings, terminal messages or CLI commands.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

async function fixture(initial, failOnce = false, backup = null) {
  let raw = JSON.stringify(initial), writes = 0;
  const state = new Map([['ag.themeContrastBackup', backup]]), context = vm.createContext({ console });
  const exports = {
    appHome: () => '/fixture', readTextFile: async () => raw,
    writeTextFile: async (_file, text, expected) => {
      if (failOnce) { failOnce = false; raw = JSON.stringify({ ...JSON.parse(raw), font_size: 18 }); throw new Error('stale'); }
      assert.equal(expected, raw); raw = text; writes++;
    },
    shared: key => state.get(key), setShared: (key, value) => state.set(key, structuredClone(value)),
  };
  const host = new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
  }, { context });
  const module = new vm.SourceTextModule(readFileSync(new URL('../mods/agents-plus/theme-contrast.js', import.meta.url), 'utf8'), { context });
  await module.link(() => host); await module.evaluate();
  return { set: module.namespace.setThemeContrast, read: () => JSON.parse(raw), edit: value => { raw = JSON.stringify(value); }, writes: () => writes };
}

for (const initial of [{ font_size: 12 }, { minimum_contrast: 1, font_size: 14 }, { minimum_contrast: 1.2 }]) {
  const env = await fixture(initial);
  await env.set(true); assert.equal(env.read().minimum_contrast, 1.6);
  await env.set(true); assert.equal(env.writes(), 1, 'no writes during unchanged selection');
  await env.set(false); assert.deepEqual(env.read(), initial, 'Default restores the exact original setting');
}
for (const original of [1, 2.2]) {
  const env = await fixture({ minimum_contrast: 4.5 }, false, { present: true, value: original, applied: 4.5 });
  await env.set(true); assert.equal(env.read().minimum_contrast, Math.max(original, 1.6));
  await env.set(false); assert.equal(env.read().minimum_contrast, original);
}
{
  const env = await fixture({ minimum_contrast: 7 });
  await env.set(true); await env.set(false);
  assert.equal(env.writes(), 0, 'keep stronger preferences');
}
{
  const env = await fixture({ minimum_contrast: 1 });
  await env.set(true); env.edit({ minimum_contrast: 3, font_size: 20 });
  await env.set(false); assert.deepEqual(env.read(), { minimum_contrast: 3, font_size: 20 });
}
{
  const env = await fixture({ minimum_contrast: 1 }, true);
  await env.set(true); assert.equal(env.read().font_size, 18, 'CAS retry preserves concurrent settings edits');
  await env.set(false); assert.equal(env.read().minimum_contrast, 1);
}
{
  const env = await fixture({ minimum_contrast: 1 });
  await Promise.all([env.set(true), env.set(false)]);
  assert.equal(env.read().minimum_contrast, 1, 'a rapid toggle ends with the latest requested value');
}
console.log('theme contrast: conditional application, exact restoration, manual changes, concurrent edits and rapid toggles passed');
