// Dead-effect audit. Twice now this project has shipped, or nearly shipped,
// content whose effect nothing ever read — a 2,100-scrap PHASE DRIVE that
// could not fire, and 22 upgrade effect keys resolveStats produced that no
// game code consumed. A grep came back clean both times.
//
// So this is the check instead: for every declared capability, prove something
// actually reads it. Run it after adding any upgrade, ship, or stat.
//
//   node tools/hookaudit.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(here, '..', 'void-runner.html'), 'utf8');

const PURE_START = '// ===== ROGUELIKE CORE (PURE) =====';
const PURE_END = '// ===== END ROGUELIKE CORE (PURE) =====';
const pure = html.slice(html.indexOf(PURE_START), html.indexOf(PURE_END));
const impure = html.slice(html.indexOf(PURE_END));

const sandbox = {};
new Function('Math', 'JSON', 'Object', 'Array', 'Error', 'exports',
  pure.replace(PURE_START, '') + '; exports.C = RLCore;')(Math, JSON, Object, Array, Error, sandbox);
const C = sandbox.C;

let problems = 0;
const report = (label, dead, total) => {
  if (dead.length) { console.log(`  FAIL  ${label}: ${dead.length} dead — ${dead.join(', ')}`); problems += dead.length; }
  else console.log(`  ok    ${label}: all ${total} are read`);
};

// --- 1. every upgrade effect key must be consumed by resolveStats ----------
const effectKeys = new Set();
C.UPGRADES.forEach(u => Object.keys(u.effect).forEach(k => effectKeys.add(k)));
const resolveSrc = C.resolveStats.toString();
report('upgrade effect keys -> resolveStats',
  [...effectKeys].filter(k => !new RegExp(`['".]${k}\\b`).test(resolveSrc)),
  effectKeys.size);

// --- 2. every stat resolveStats produces must be consumed somewhere --------
const stats = C.resolveStats({ fireMul: 1, speed: 5, spreadMul: 1 }, [], 0);
const shotsSrc = C.buildShots.toString();
report('resolved stats -> game code',
  Object.keys(stats).filter(s =>
    !impure.includes('stats.' + s) && !shotsSrc.includes('s.' + s) && !resolveSrc.includes('.' + s)),
  Object.keys(stats).length);

// --- 3. every ship hook must be read by real game code ---------------------
const shipsStart = html.indexOf('ships: [');
const shipsEnd = html.indexOf('\n};', shipsStart);
const shipsSrc = html.slice(shipsStart, shipsEnd);
const after = html.slice(shipsEnd);
const STANDARD = new Set(['id', 'name', 'cost', 'lives', 'speed', 'fireMul', 'hitW', 'hitH',
  'spreadMul', 'phase', 'hull', 'trim', 'blurb', 'ships']);
const hooks = [...new Set([...shipsSrc.matchAll(/([a-zA-Z]+):/g)].map(m => m[1]))].filter(k => !STANDARD.has(k));
report('ship hooks -> game code',
  hooks.filter(k => !new RegExp('\\.' + k + '\\b').test(after)),
  hooks.length);

// --- 4. every boss in the table must have a bespoke registry entry ---------
const bossKeys = new Set([...html.matchAll(/BOSS\.([a-zA-Z0-9_]+)\s*=\s*\{/g)].map(m => m[1]));
report('boss table -> registry',
  C.BOSS_TABLE.filter(b => !bossKeys.has(b.key)).map(b => b.key),
  C.BOSS_TABLE.length);

// --- 5. every ship must have hull art, or it borrows another ship's --------
const artKeys = new Set([...html.matchAll(/SHIP_ART\.([a-zA-Z0-9_]+)\s*=/g)].map(m => m[1]));
const shipIds = [...shipsSrc.matchAll(/\{ id: '([a-z]+)'/g)].map(m => m[1]);
report('ships -> hull art',
  shipIds.filter(id => !artKeys.has(id)),
  shipIds.length);

console.log(problems
  ? `\n${problems} dead capabilities — something takes the player's scrap or credits and does nothing`
  : '\nno dead capabilities');
process.exit(problems ? 1 : 0);
