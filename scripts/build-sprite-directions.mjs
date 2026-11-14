// Generate code-native SVG transforms, embedding the exact original PNG bytes.
// No raster decoding, pixel edits, recompression or additional artwork occurs.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RESOURCE_PACKS } from '../mods/agents-plus/resource-packs.js';
import { frameFacing } from '../mods/agents-plus/sprite-directions.js';

const check = process.argv.includes('--check');
let files = 0;
for (const definition of Object.values(RESOURCE_PACKS)) {
 if (!definition.art || !definition.sprites) continue;
 const root = new URL(`../${definition.art}/`, import.meta.url);
 for (const name of Object.keys(definition.facing || {})) {
  const { width, height, frames } = definition.sprites[name];
  const folder = new URL(`directional/${name}/`, root);
  if (!check) mkdirSync(folder, { recursive: true });
  for (let frame = 1; frame <= frames; frame++) {
    if (!frameFacing(definition, name, frame - 1)) continue;
    const number = String(frame).padStart(3, '0');
    const png = readFileSync(new URL(`${name}/${number}.png`, root));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image width="${width}" height="${height}" transform="translate(${width} 0) scale(-1 1)" href="data:image/png;base64,${png.toString('base64')}"/></svg>\n`;
    const target = new URL(`${number}.svg`, folder);
    if (check) {
      if (readFileSync(target, 'utf8') !== svg) throw new Error(`Stale sprite wrapper: ${fileURLToPath(target)}`);
    } else writeFileSync(target, svg);
    files++;
  }
}
}
console.log(`${check ? 'Checked' : 'Generated'} ${files} directional SVG wrappers; original PNG bytes preserved.`);
