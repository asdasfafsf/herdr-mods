// Generate independent native theme packages; agent views read the host palette.
import { writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
const mods = new URL('../mods/', import.meta.url);

const outputs = new Map();
for (const directory of readdirSync(mods).filter((name) => name.startsWith('theme-'))) {
  const path = new URL(`${directory}/palette.js`, mods);
  if (!existsSync(path)) continue;
  const module = await import(path.href);
  const definition = module.default || Object.values(module).find((value) => value?.native && value?.colors);
  if (!definition) throw new Error(`Missing palette definition in ${directory}`);
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
