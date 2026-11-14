import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { SPRITES } from '../mods/agents-plus/theme-assets.js';
import { frameFacing, movementFacing } from '../mods/agents-plus/sprite-directions.js';

import { RESOURCE_PACKS } from '../mods/agents-plus/resource-packs.js';
const definition = RESOURCE_PACKS.chiikawa;
const root = new URL('../mods/agents-plus/assets/chiikawa/', import.meta.url);
let frames = 0;
for (const name of Object.keys(definition.facing)) {
  const sprite = SPRITES[name];
  for (let frame = 1; frame <= sprite.frames; frame++) {
    if (!frameFacing(definition, name, frame - 1)) {
      assert.equal(existsSync(new URL(`directional/${name}/${String(frame).padStart(3, "0")}.svg`, root)), false);
      continue;
    }
    const number = String(frame).padStart(3, '0');
    const svg = readFileSync(new URL(`directional/${name}/${number}.svg`, root), 'utf8');
    const embedded = svg.match(/href="data:image\/png;base64,([A-Za-z0-9+/=]+)"/);
    assert.ok(embedded, `${name} frame ${frame} embeds its source`);
    assert.deepEqual(Buffer.from(embedded[1], 'base64'), readFileSync(new URL(`${name}/${number}.png`, root)), 'source PNG bytes remain exact');
    assert.ok(svg.includes(`viewBox="0 0 ${sprite.width} ${sprite.height}"`));
    assert.ok(svg.includes(`transform="translate(${sprite.width} 0) scale(-1 1)"`));
    frames++;
  }
}
for (const name of ['rakko', 'shisa', 'yoroi']) {
  assert.equal(definition.facing[name], undefined);
  assert.equal(existsSync(new URL(`directional/${name}/`, root)), false, 'lettering is never mirrored');
}
assert.equal(movementFacing(8, 4, -1), 1);
assert.equal(movementFacing(-8, 4, 1), -1);
assert.equal(movementFacing(-0.01, 8, 1), 1);
assert.equal(movementFacing(0.01, -8, -1), -1);
assert.equal(movementFacing(0, 0, undefined), undefined);
console.log(`sprite directions: ${frames} exact-byte SVG wrappers, original lettering and vertical-motion stability passed`);
