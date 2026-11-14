// Verify decoded resources and their recorded source without network or live UI.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SPRITES } from '../mods/agents-plus/theme-assets.js';
const root = new URL('../', import.meta.url);
const art = new URL('mods/agents-plus/assets/chiikawa/', root);
const index = JSON.parse(readFileSync(new URL('manifest.json', art), 'utf8'));
assert.deepEqual(SPRITES, index, 'runtime and recorded frame data agree');
let frames = 0, sources = 0;
for (const [name, sprite] of Object.entries(SPRITES)) {
  assert.equal(sprite.durations.length, sprite.frames, name);
  assert.ok(Math.abs(sprite.durations.reduce((a, b) => a + b, 0) - sprite.duration) < 0.001, name);
  for (let i = 1; i <= sprite.frames; i++) {
    const file = new URL(`${name}/${String(i).padStart(3, '0')}.png`, art);
    const png = readFileSync(file);
    assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a', name);
    assert.equal(png.readUInt32BE(16), sprite.width, name);
    assert.equal(png.readUInt32BE(20), sprite.height, name);
    frames++;
  }
  for (const field of ['content', 'body']) if (sprite[field]) {
    const [x, y, width, height] = sprite[field];
    assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= sprite.width && y + height <= sprite.height, `${name} ${field}`);
  }
  const sourceFile = new URL(`${name}/manifest.json`, art);
  if (!existsSync(sourceFile)) continue;
  const source = JSON.parse(readFileSync(sourceFile, 'utf8'));
  assert.equal(createHash('sha256').update(readFileSync(new URL(source.original_path, root))).digest('hex'), source.sha256, name);
  for (const field of ['width', 'height', 'frames', 'duration', 'durations']) assert.deepEqual(sprite[field], source[field], `${name} ${field}`);
  assert.equal(source.pixels_identical_to_source, true, name);
  sources++;
}
assert.ok(sources >= 10);
console.log(`resident assets: ${frames} PNG frames, timing/bounds and ${sources} original source hashes passed`);
