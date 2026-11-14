// Pack unchanged PNG bytes into a code-native SVG, keeping one image resource
// per resident. Mirrored cells transform only poses without source lettering.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { THEMES } from '../mods/agents-plus/themes.js';
import { frameFacing } from '../mods/agents-plus/sprite-directions.js';

const check = process.argv.includes('--check');
let files = 0;
for (const definition of Object.values(THEMES)) {
  if (!definition.frameAtlas) continue;
  const root = new URL(`../${definition.art}/`, import.meta.url);
  const folder = new URL(`${definition.frameAtlas}/`, root);
  if (!check) mkdirSync(folder, { recursive: true });
  for (const [name, sprite] of Object.entries(definition.sprites)) {
    const directions = Array.from({ length: sprite.frames }, (_, i) => frameFacing(definition, name, i));
    if (sprite.animation && !directions.some(Boolean)) continue;
    const columns = Math.ceil(Math.sqrt(sprite.frames)), rows = Math.ceil(sprite.frames / columns);
    const { width, height } = sprite;
    const frames = Array.from({ length: sprite.frames }, (_, i) => readFileSync(new URL(`${name}/${String(i + 1).padStart(3, '0')}.png`, root)).toString('base64'));
    for (const facing of directions.some(Boolean) ? [0, -1, 1] : [0]) {
      const cells = frames.map((png, i) => {
        const x = (i % columns) * width, y = Math.floor(i / columns) * height;
        const mirror = facing && directions[i] && facing !== directions[i];
        return `<image width="${width}" height="${height}" transform="translate(${x + (mirror ? width : 0)} ${y})${mirror ? ' scale(-1 1)' : ''}" href="data:image/png;base64,${png}"/>`;
      });
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width * columns}" height="${height * rows}" viewBox="0 0 ${width * columns} ${height * rows}">${cells.join('')}</svg>\n`;
      const target = new URL(`${name}${facing ? facing < 0 ? '-left' : '-right' : ''}.svg`, folder);
      if (check) {
        if (readFileSync(target, 'utf8') !== svg) throw new Error(`Stale sprite atlas: ${target.pathname}`);
      } else writeFileSync(target, svg);
      files++;
    }
  }
}
console.log(`${check ? 'Checked' : 'Generated'} ${files} SVG frame atlases; original PNG bytes preserved.`);
