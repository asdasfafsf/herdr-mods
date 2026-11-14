// Generate host themes from the same palette used by the agent UI.
import { writeFileSync, readFileSync } from 'node:fs';
import { THEMES } from '../mods/agents-plus/themes.js';

const outputs = new Map();
for (const definition of Object.values(THEMES)) {
  if (!definition.native) continue;
  const { colors: c } = definition;
  outputs.set(`${definition.native}.json`, JSON.stringify({
    background: c.background, foreground: c.foreground, cursor: c.foreground,
    selection: c.selection, ansi: Array.from({ length: 16 }, (_, i) => c[`ansi${i}`]), colors: c,
  }, null, 2) + '\n');
}
for (const [name, content] of outputs) {
  const path = new URL(`../mods/agents-plus/themes/${name}`, import.meta.url);
  if (process.argv.includes('--check')) {
    if (readFileSync(path, 'utf8') !== content) throw new Error(`Regenerate ${name}: node scripts/build-agent-themes.mjs`);
  } else writeFileSync(path, content);
}
