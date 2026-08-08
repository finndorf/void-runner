// Splices a rebuilt audio file into void-runner.html.
//
//   node tools/audiointegrate.mjs <audio.js>
//
// The file is expected to define `const Music = {...}` and `const SFX = {...}`.
// Two transformations happen on the way in:
//
//   1. The existing `const Music = {...}` block is REPLACED, not appended —
//      two Music objects in one scope is a redeclaration error, and the second
//      would silently win anyway.
//   2. `const SFX = {...}` becomes `Object.assign(SFX, {...})`, because the
//      game already declares `const SFX = {}` up beside Sound.play, which
//      holds a reference to it. Redeclaring it would throw; reassigning it
//      would leave Sound.play pointing at the old empty object.
//
// Idempotent: re-running replaces the previous splice rather than stacking.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const GAME = resolve(here, '..', 'void-runner.html');

const file = process.argv[2];
if (!file) { console.error('usage: node tools/audiointegrate.mjs <audio.js>'); process.exit(2); }
let audio = readFileSync(resolve(file), 'utf8').trim();

let html = readFileSync(GAME, 'utf8');

// --- find the existing Music block by brace matching ------------------------
const OPEN = '\nconst Music = {';
const start = html.indexOf(OPEN);
if (start === -1) { console.error('could not find `const Music = {` in the game'); process.exit(1); }
let i = html.indexOf('{', start), depth = 0, end = -1;
for (; i < html.length; i++) {
  const c = html[i];
  if (c === '{') depth++;
  else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
}
if (end === -1) { console.error('unbalanced braces in the existing Music block'); process.exit(1); }
// swallow the trailing `};`
const tail = html.indexOf(';', end);
const oldBlock = html.slice(start, tail + 1);

// --- transform the incoming file -------------------------------------------
const before = audio;
audio = audio.replace(/^\s*const\s+SFX\s*=\s*\{/m, 'Object.assign(SFX, {');
if (audio !== before) {
  // close the Object.assign( ... ) — find the matching brace of that literal
  const s = audio.indexOf('Object.assign(SFX, {');
  let j = audio.indexOf('{', s), d = 0, e = -1;
  for (; j < audio.length; j++) {
    if (audio[j] === '{') d++;
    else if (audio[j] === '}') { d--; if (d === 0) { e = j; break; } }
  }
  if (e === -1) { console.error('unbalanced braces in the incoming SFX block'); process.exit(1); }
  // replace the `}` (and any following `;`) with `});`
  const after = audio.slice(e + 1).replace(/^\s*;/, '');
  audio = audio.slice(0, e) + '});' + after;
  console.log('SFX: rewritten as Object.assign so Sound.play keeps its reference');
} else {
  console.log('SFX: no `const SFX = {` found — left as-is');
}

const OPEN_MARK = '// ---- audio pack ----';
const CLOSE_MARK = '// ---- end audio pack ----';
const block = `\n${OPEN_MARK}\n${audio}\n${CLOSE_MARK}`;

// If a previous splice exists, drop it first.
const prev = html.indexOf(OPEN_MARK);
if (prev !== -1) {
  const pend = html.indexOf(CLOSE_MARK);
  html = html.slice(0, prev) + html.slice(pend + CLOSE_MARK.length + 1);
  console.log('replaced a previous audio pack');
}

html = html.replace(oldBlock, block);
writeFileSync(GAME, html);

try {
  new Function(html.match(/<script>([\s\S]*)<\/script>/)[1]);
  console.log('syntax OK — ' + html.length.toLocaleString() + ' bytes');
} catch (e) {
  console.error('SYNTAX ERROR after splice: ' + e.message);
  process.exit(1);
}
