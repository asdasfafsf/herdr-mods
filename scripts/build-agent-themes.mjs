// Generate independent native theme packages; agent views read the host palette.
import { writeFileSync, readFileSync } from 'node:fs';
import { CHIIKAWA_THEME } from '../mods/theme-chiikawa/palette.js';

const outputs = new Map();
for (const [directory, definition] of [['theme-chiikawa', CHIIKAWA_THEME]]) {
  const { colors: c } = definition;
  outputs.set(`${directory}/${definition.native}.json`, JSON.stringify({
    background: c.background, foreground: c.foreground, cursor: c.foreground,
    selection: c.selection, ansi: Array.from({ length: 16 }, (_, i) => c[`ansi${i}`]), colors: c,
  }, null, 2) + '\n');
}
for (const [name, content] of outputs) {
  const path = new URL(`../mods/${name}`, import.meta.url);
  if (process.argv.includes('--check')) {
    if (readFileSync(path, 'utf8') !== content) throw new Error(`Regenerate ${name}: node scripts/build-agent-themes.mjs`);
  } else writeFileSync(path, content);
}
