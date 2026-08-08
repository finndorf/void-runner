// Splices boss definition files into void-runner.html, in front of the boss
// plumbing. Idempotent per key: re-running with an updated file replaces that
// boss's block rather than appending a second copy.
//
//   node tools/bossintegrate.mjs file1.js file2.js ...
//
// Each file must contain only `BOSS.<key> = {...}` assignments and helpers
// prefixed with their boss key. The splice is wrapped in sentinels so a later
// run can find and replace it.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const GAME = resolve(here, '..', 'void-runner.html');
const ANCHOR = 'const BOSS_W = 112, BOSS_H = 54;';

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: node tools/bossintegrate.mjs <file.js> ...'); process.exit(2); }

let html = readFileSync(GAME, 'utf8');

for (const f of files) {
  const path = resolve(f);
  const src = readFileSync(path, 'utf8').trim();
  const tag = basename(path, '.js');
  const open = `// ---- boss pack: ${tag} ----`;
  const close = `// ---- end boss pack: ${tag} ----`;
  const block = `${open}\n${src}\n${close}\n\n`;

  const keys = [...src.matchAll(/BOSS\.([a-zA-Z0-9_]+)\s*=/g)].map(m => m[1]);
  if (!keys.length) { console.error(`${tag}: no BOSS.<key> definitions — skipped`); continue; }

  const i = html.indexOf(open);
  if (i !== -1) {
    const j = html.indexOf(close);
    if (j === -1) { console.error(`${tag}: opening sentinel without a closing one`); process.exit(1); }
    html = html.slice(0, i) + block + html.slice(j + close.length + 1);
    console.log(`${tag}: replaced (${keys.join(', ')})`);
  } else {
    const a = html.indexOf(ANCHOR);
    if (a === -1) { console.error('anchor not found in game source'); process.exit(1); }
    html = html.slice(0, a) + block + html.slice(a);
    console.log(`${tag}: inserted (${keys.join(', ')})`);
  }
}

writeFileSync(GAME, html);

// Fail loudly rather than leaving a broken game on disk.
try {
  new Function(html.match(/<script>([\s\S]*)<\/script>/)[1]);
  console.log('\nsyntax OK — ' + html.length.toLocaleString() + ' bytes');
} catch (e) {
  console.error('\nSYNTAX ERROR after splice: ' + e.message);
  process.exit(1);
}
