// Boss bench. Splices a file of BOSS.<key> = {...} definitions into a copy of
// the game in memory, boots it DOM-free, and drives each named fight for
// thousands of frames — entering, every phase, taking fire, dying — asserting
// it never throws and that its health actually moves.
//
//   node tools/bosscheck.mjs <bossfile.js> [key ...]
//
// With no keys it checks every key the file defines. Exits non-zero on any
// failure, so it is usable as a gate.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const GAME = resolve(here, '..', 'void-runner.html');

const bossFile = process.argv[2];
if (!bossFile) {
  console.error('usage: node tools/bosscheck.mjs <bossfile.js> [key ...]');
  process.exit(2);
}
const bossSrc = readFileSync(resolve(bossFile), 'utf8');

// Keys the file defines, e.g. `BOSS.widow = {`
const defined = [...bossSrc.matchAll(/BOSS\.([a-zA-Z0-9_]+)\s*=/g)].map(m => m[1]);
const keys = process.argv.slice(3).length ? process.argv.slice(3) : defined;
// An empty splice file with explicit keys is the "bench what is already in the
// game" mode — used to re-verify the whole roster after integration, where
// re-splicing a pack would redeclare its helpers and fail to parse.
if (!keys.length) {
  console.error('no BOSS.<key> definitions in ' + bossFile + ', and no keys given.\n' +
    'Pass keys explicitly to bench bosses already present in the game.');
  process.exit(2);
}

// ---- splice: the new definitions go in right before the plumbing ----
const html = readFileSync(GAME, 'utf8');
let src = html.match(/<script>([\s\S]*)<\/script>/)[1];
const anchor = 'const BOSS_W = 112, BOSS_H = 54;';
if (!src.includes(anchor)) { console.error('anchor not found in game source'); process.exit(2); }
src = src.replace(anchor, bossSrc + '\n' + anchor);

// ---- DOM-free sandbox ----
const noop = () => {};
const ctxStub = new Proxy({}, {
  get(_, k) {
    if (k === 'canvas') return { width: 480, height: 720 };
    if (k === 'measureText') return () => ({ width: 10 });
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: noop });
    if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
    return noop;
  },
  set() { return true; }
});
const canvas = { width: 480, height: 720, style: {}, getContext: () => ctxStub, addEventListener: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 480, height: 720 }) };
const store = new Map();
const win = {
  addEventListener: noop, removeEventListener: noop, innerWidth: 1200, innerHeight: 900, devicePixelRatio: 1,
  localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
  requestAnimationFrame: () => 0,
  AudioContext: function () { throw new Error('audio off'); }
};
const doc = { getElementById: () => canvas, querySelector: () => canvas, addEventListener: noop,
  removeEventListener: noop, createElement: () => canvas, body: { appendChild: noop, style: {} }, documentElement: { style: {} } };
const sandbox = {
  document: doc, window: win, localStorage: win.localStorage, requestAnimationFrame: win.requestAnimationFrame,
  AudioContext: win.AudioContext, webkitAudioContext: win.AudioContext,
  CanvasRenderingContext2D: function () {}, devicePixelRatio: 1,
  console, Math, JSON, Date, isNaN, parseFloat, parseInt,
  Array, Object, String, Number, Boolean, Error, Set, Map, Proxy,
  Uint8ClampedArray, Float32Array, performance: { now: () => 0 }
};
sandbox.CanvasRenderingContext2D.prototype = {};

const names = Object.keys(sandbox);
const exposed = `; return {
  get state(){return state}, set state(v){state=v},
  get level(){return level}, set level(v){level=v},
  get boss(){return boss}, set boss(v){boss=v},
  get enemies(){return enemies}, set enemies(v){enemies=v},
  get enemyBullets(){return enemyBullets}, set enemyBullets(v){enemyBullets=v},
  get bullets(){return bullets}, set bullets(v){bullets=v},
  get bossActive(){return bossActive},
  get lives(){return lives}, set lives(v){lives=v},
  get player(){return player},
  get stats(){return stats},
  RLCore, BOSS, CFG, startGame, spawnBoss, updateBoss, drawBoss, drawBossBar, update, draw, bossDef
}`;

let api;
try {
  api = new Function(...names, src + exposed)(...names.map(k => sandbox[k]));
} catch (e) {
  console.error('BOOT FAILED — the spliced file has a syntax or load error:\n' + e.message);
  console.error(e.stack.split('\n').slice(0, 5).join('\n'));
  process.exit(1);
}

const table = api.RLCore.BOSS_TABLE;
let failures = 0;

function fail(key, msg) { console.log(`  FAIL  ${key}: ${msg}`); failures++; }

for (const key of keys) {
  const entry = table.find(b => b.key === key);
  // ARMADA/composite keys are not in the table; bench them at a level that
  // produces one.
  const lv = entry ? entry.level : (key === 'armada' ? 1300 : 100);

  if (!api.BOSS[key]) { fail(key, 'no BOSS.' + key + ' after splice'); continue; }
  const def = api.BOSS[key];
  if (typeof def.think !== 'function') { fail(key, 'missing think()'); continue; }
  if (typeof def.paint !== 'function') { fail(key, 'missing paint()'); continue; }

  api.startGame();
  api.level = lv;
  api.lives = 9999;                       // bench the boss, not the pilot
  let err = null, drewOk = true, phasesSeen = new Set();

  try { api.spawnBoss(lv); } catch (e) { fail(key, 'spawnBoss threw: ' + e.message); continue; }
  if (!api.boss) { fail(key, 'spawnBoss produced no boss'); continue; }
  if (api.boss.key !== key) { fail(key, `spawned key is "${api.boss.key}"` + (entry ? '' : ' (expected for a non-table key)')); }

  const maxHp = api.boss.maxHp;
  let frames = 0;
  const LIMIT = 30000;
  try {
    while (api.boss && frames < LIMIT) {
      frames++;
      // Chip it down so every phase is reached in reasonable time, and so the
      // damage hook (plates, ring gaps, bays) is exercised through real bullets.
      if (frames % 2 === 0 && api.boss) {
        api.bullets.push({
          x: api.boss.x + (Math.random() - 0.5) * 90, y: api.boss.y + (Math.random() - 0.5) * 30,
          vx: 0, vy: -1, w: 3, h: 10, pierce: 0, damage: maxHp / 260,
          homing: 0, splash: 0, split: false, burn: 0, chill: 0, bounces: 0, crit: false, dead: false
        });
      }
      api.updateBoss();
      if (api.boss) phasesSeen.add(api.boss.phase);
      try { if (api.boss) { api.drawBoss(api.boss); api.drawBossBar(api.boss); } }
      catch (e) { if (drewOk) { drewOk = false; fail(key, 'draw threw on frame ' + frames + ': ' + e.message); } }
      // keep the arrays from growing without bound over a long bench
      if (api.enemyBullets.length > 2000) api.enemyBullets = [];
      if (api.bullets.length > 2000) api.bullets = [];
      if (api.enemies.length > 60) api.enemies = [];
    }
  } catch (e) {
    err = e;
  }

  if (err) { fail(key, 'update threw on frame ' + frames + ': ' + err.message + '\n         ' + (err.stack || '').split('\n')[1]); continue; }
  if (frames >= LIMIT) { fail(key, `never died in ${LIMIT} frames — it is probably unkillable (check the damage() hook)`); continue; }

  const expectedPhases = entry ? entry.phases : 4;
  if (phasesSeen.size < expectedPhases) {
    fail(key, `only reached ${phasesSeen.size} of ${expectedPhases} phases`);
    continue;
  }
  console.log(`  ok    ${key.padEnd(13)} lv${String(lv).padEnd(5)} ${maxHp.toLocaleString().padStart(11)} HP  ${expectedPhases} phases  died in ${frames} frames`);
}

console.log(failures ? `\n${failures} failed` : `\nall ${keys.length} bosses passed the bench`);
process.exit(failures ? 1 : 0);
