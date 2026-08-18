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

// --- 6. every sound the game plays must actually be defined ---------------
// Sound.play falls through silently on an unknown name, so a typo is a sound
// that never plays and never complains.
const played = [...new Set([...html.matchAll(/Sound\.play\('([a-zA-Z_]+)'\)/g)].map(m => m[1]))];
// Any indent: the SFX table lives inside an IIFE, so its keys are nested
// deeper than a top-level object literal's would be.
const sfxKeys = new Set([...html.matchAll(/^\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*function/gm)].map(m => m[1]));
const switchCases = new Set([...html.matchAll(/case '([a-zA-Z_]+)':/g)].map(m => m[1]));
report('played sound names -> defined',
  played.filter(n => !sfxKeys.has(n) && !switchCases.has(n)),
  played.length);

// --- 7. every rebindable action must be read by real game code -------------
// The settings screen lets a player carefully configure a key. If nothing ever
// asks about that action, the row is a lie — the same dead-content bug as an
// upgrade whose effect nobody reads, wearing a menu. MOVE UP and MOVE DOWN sat
// there doing nothing until a test caught them.
const readActions = new Set([
  ...[...html.matchAll(/keyMatches\([^,]+,\s*'([a-zA-Z]+)'\)/g)].map(m => m[1]),
  ...[...html.matchAll(/held\('([a-zA-Z]+)'\)/g)].map(m => m[1])
]);
report('rebindable actions -> game code',
  C.BIND_ORDER.filter(a => !readActions.has(a)),
  C.BIND_ORDER.length);

// Two actions sharing a default key means one of them silently loses.
const claimed = new Map();
const clashes = [];
C.BIND_ORDER.forEach(action => {
  (C.DEFAULT_BINDS[action] || []).forEach(k => {
    if (claimed.has(k)) clashes.push(`"${k}" (${claimed.get(k)} vs ${action})`);
    else claimed.set(k, action);
  });
});
report('default keys are unique', clashes, claimed.size);

// The tier-reveal ladder is built by string concatenation, so it cannot be
// caught by the scan above — check it explicitly against the tier list.
const LOUD = ['APEX', 'OVERCLOCKED', 'HYPERCLOCKED', 'UBERCLOCKED', 'DYNACLOCKED', 'MYTHIC'];
report('tier reveal ladder -> defined',
  LOUD.filter(t => !html.includes('tierReveal_' + t)),
  LOUD.length);

console.log(problems
  ? `\n${problems} dead capabilities — something takes the player's scrap or credits and does nothing`
  : '\nno dead capabilities');
process.exit(problems ? 1 : 0);
