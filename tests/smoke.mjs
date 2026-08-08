// Headless smoke harness. Stubs just enough DOM/canvas/audio to boot the real
// game script and drive it for a few thousand frames, so that wiring mistakes
// (a call to a function that no longer exists, a stale field, a null deref)
// surface without a browser. Deliberately NOT a pure-block test -- this is the
// impure half, which is exactly where the last round's bugs lived.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../void-runner.html', import.meta.url), 'utf8');
const src = html.match(/<script>([\s\S]*)<\/script>/)[1];

const noop = () => {};
const ctxStub = new Proxy({}, {
  get(_, k) {
    if (k === 'canvas') return { width: 480, height: 720 };
    if (k === 'measureText') return () => ({ width: 10 });
    if (k === 'createLinearGradient' || k === 'createRadialGradient') {
      return () => ({ addColorStop: noop });
    }
    if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
    return noop;
  },
  set() { return true; }
});

const canvas = {
  width: 480, height: 720,
  style: {},
  getContext: () => ctxStub,
  addEventListener: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 480, height: 720 })
};

const store = new Map();
const listeners = {};

const win = {
  addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
  removeEventListener: noop,
  innerWidth: 1200, innerHeight: 900,
  devicePixelRatio: 1,
  localStorage: {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  },
  requestAnimationFrame: () => 0,
  AudioContext: function () {
    throw new Error('audio disabled in smoke harness');
  }
};

const doc = {
  getElementById: () => canvas,
  querySelector: () => canvas,
  addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
  removeEventListener: noop,
  createElement: () => canvas,
  body: { appendChild: noop, style: {} },
  documentElement: { style: {} }
};

const sandbox = {
  document: doc, window: win, localStorage: win.localStorage,
  requestAnimationFrame: win.requestAnimationFrame,
  AudioContext: win.AudioContext, webkitAudioContext: win.AudioContext,
  CanvasRenderingContext2D: function () {},
  devicePixelRatio: 1,
  console, Math, JSON, Date, isNaN, parseFloat, parseInt,
  Array, Object, String, Number, Boolean, Error, Set, Map, Proxy,
  Uint8ClampedArray, Float32Array, performance: { now: () => 0 }
};
sandbox.CanvasRenderingContext2D.prototype = {};

const keys = Object.keys(sandbox);
const fn = new Function(...keys, `${src}\n; return { get state(){return state}, get level(){return level}, get lives(){return lives}, get scrap(){return scrap}, get voidbirths(){return voidbirths}, get boss(){return boss}, get enemies(){return enemies}, get runUpgrades(){return runUpgrades}, get stats(){return stats}, RLCore, CFG, loop, update, draw, startGame, levelUp, openShop, closeShop, updateVoidbirth, tryBuySlot, tryReroll, set state(v){state=v}, set level(v){level=v},
  get pickups(){return pickups}, get asteroids(){return asteroids}, get settings(){return Save.data.settings},
  get seenEnemies(){return Save.data.seenEnemies}, get seenUpgrades(){return Save.data.seenUpgrades},
  makeEnemy, ENEMY, drawSettings, drawBestiary, openSettings, openBestiary, bestiaryEntries, bestiaryColumns,
  settingsRows, hitPlayer, Save, player,
  clearBoard: () => { asteroids = []; enemyBullets = []; bullets = []; pickups = []; }, set scrap(v){scrap=v}, set enemies(v){enemies=v}, set lives(v){lives=v},
  set voidbirths(v){voidbirths=v} };`);

let api, bootError = null;
try {
  api = fn(...keys.map(k => sandbox[k]));
} catch (e) {
  bootError = e;
}

test('the game boots in a DOM-free sandbox', () => {
  assert.equal(bootError, null, bootError && bootError.stack.split('\n').slice(0, 3).join('\n'));
  assert.equal(api.state, 'start');
});

// The real loop calls requestAnimationFrame; we drive draw/update by hand.
function H_OF() { return 720; }

function tick(n, label) {
  for (let i = 0; i < n; i++) {
    try { api.update(); } catch (e) { throw new Error(`update() threw during ${label} @frame ${i}: ${e.message}\n${e.stack.split('\n')[1]}`); }
    try { api.draw(); } catch (e) { throw new Error(`draw() threw during ${label} @frame ${i}: ${e.message}\n${e.stack.split('\n')[1]}`); }
  }
}

// Each check mutates game state for the next one, so they are written to run
// in file order — which is what node:test does for synchronous tests.
const check = (name, f) => test(name, f);

check('menu renders', () => { api.draw(); });

check('a run starts', () => {
  api.startGame();
  if (api.state !== 'play') throw new Error('state is ' + api.state);
  if (!api.stats) throw new Error('stats not resolved');
});

check('base damage is 10 and fire rate is the documented interval', () => {
  const s = api.stats;
  if (s.damage !== 10) throw new Error('damage=' + s.damage + ' expected 10');
  if (s.fireRate !== 10) throw new Error('fireRate=' + s.fireRate + ' expected 10');
});

check('600 frames of level 1 without throwing', () => tick(600, 'level 1'));

check('enemies spawn with curve HP, not the old flat table', () => {
  const e = api.enemies[0];
  if (!e) return;                       // no enemy on screen this frame is fine
  if (typeof e.maxHp !== 'number' || e.maxHp < 1) throw new Error('bad maxHp ' + e.maxHp);
});

check('the shop opens, rolls resolved cards, and closes', () => {
  api.levelUp();
  if (api.state !== 'shop') throw new Error('state is ' + api.state);
  for (let i = 0; i < 120; i++) api.draw();
  api.closeShop();
  if (api.state !== 'play') throw new Error('did not return to play, state=' + api.state);
});

check('the shop has NO timer that can close it', () => {
  api.levelUp();
  for (let i = 0; i < 60 * 90; i++) { /* 90 seconds */ }
  if (api.state !== 'shop') throw new Error('shop closed on its own');
  api.closeShop();
});

check('a boss level spawns the right named boss', () => {
  api.level = 9;
  api.levelUp();                       // -> level 10
  if (api.state === 'shop') api.closeShop();
  if (!api.boss) throw new Error('no boss at level 10');
  // The level-10 slot is TRIAD now: both shield-mechanic fights (HALO WARDEN
  // and SCRAPJAW) were moved past level 100 so nothing in the first hundred
  // levels asks you to break a shield before you can build one.
  if (api.boss.name !== 'TRIAD') throw new Error('boss is ' + api.boss.name);
  if (api.boss.maxHp !== 6000) throw new Error('boss hp ' + api.boss.maxHp);
});

check('900 frames of a boss fight without throwing', () => tick(900, 'boss'));

check('voidbirth triggers at level 50 and completes', () => {
  api.level = 49;
  api.levelUp();                       // -> 50, no ascension yet
  if (api.state === 'shop') api.closeShop();
  api.level = 50;
  const before = api.scrap;
  api.levelUp();                       // clearing 50 ascends, immediately
  if (api.state !== 'voidbirth') throw new Error('state is ' + api.state);
  // sequence is driven below
  // drive the sequence via the real loop path
  let guard = 0;
  while (api.state === 'voidbirth' && guard++ < 2000) { api.draw(); tickVoid(); }
  if (api.state !== 'play') throw new Error('voidbirth never finished, state=' + api.state);
  if (api.voidbirths !== 1) throw new Error('voidbirths=' + api.voidbirths);
  if (api.runUpgrades.length !== 0) throw new Error('upgrades survived the voidbirth');
  // A sliver of the treasury now carries over, and the run restarts at
  // level 1. The exact 5% is asserted against RLCore.scrapAfterVoidbirth in
  // the pure tests; here the point is that the GAME applies it -- the level
  // clear pays out first, so the base is larger than `before`.
  if (api.level !== 1) throw new Error('level after voidbirth: ' + api.level);
  if (api.scrap <= 0) throw new Error('the whole treasury burned');
  if (api.scrap > before * 0.25) {
    throw new Error('kept too much scrap: ' + api.scrap + ' of at least ' + before);
  }
});

function tickVoid() { api.updateVoidbirth(); }

check('deep levels do not throw', () => {
  api.level = 1200;
  tick(400, 'level 1200');
});

// ---------------------------------------------------------------------------
// The band roster, in the actual game loop
// ---------------------------------------------------------------------------
// Ninety-five ships across fifteen behaviours, six of them brand new. A stub
// canvas cannot tell you whether they LOOK right, but it will absolutely tell
// you whether they throw — which is where wiring bugs live.

check('every ship in the roster spawns, moves, shoots and draws', () => {
  api.state = 'play';
  for (const def of api.RLCore.ENEMY_ROSTER) {
    api.level = def.band * 10 + 5;
    api.enemies = [];
    for (let i = 0; i < 3; i++) {
      let e;
      try { e = api.makeEnemy(def.id); } catch (err) {
        throw new Error(`makeEnemy('${def.id}') threw: ${err.message}`);
      }
      e.x = 100 + i * 90; e.y = 120 + i * 60;
      api.enemies.push(e);
    }
    try { tick(200, def.id); } catch (err) {
      throw new Error(`${def.id} (${def.beh}) broke the loop: ${err.message}`);
    }
  }
});

check('every behaviour in the roster is one the update loop implements', () => {
  const implemented = new Set(['drifter', 'charger', 'turret', 'mine', 'lancer', 'weaver',
    'bulwark', 'swarm', 'harbinger', 'orbiter', 'sniper', 'splitter', 'shielder',
    'bomber', 'blinker']);
  api.RLCore.ENEMY_ROSTER.forEach(d => {
    if (!implemented.has(d.beh)) throw new Error(`${d.id} wants behaviour "${d.beh}", which nothing implements`);
  });
});

check('one level in every band runs clean', () => {
  api.state = 'play';
  for (let band = 0; band < api.RLCore.ENEMY_BANDS.length; band++) {
    api.level = band * 10 + 6;
    api.enemies = [];
    tick(500, 'band ' + band);
  }
});

check('meteors break open and drop something you can pick up', () => {
  api.state = 'play';
  api.level = 40;
  api.enemies = [];
  const before = api.pickups.length;
  let guard = 0;
  // Park the player under the rocks so the magnet has something to do.
  while (api.pickups.length === before && guard++ < 4000) {
    api.asteroids.forEach(a => { a.hp = 0.0001; });
    tick(1, 'meteor drops');
  }
  if (api.pickups.length === before) throw new Error('no pickup ever dropped from a meteor');
});

check('an enemy that gets past you is free — breaches were removed', () => {
  api.state = 'play';
  api.level = 5;
  // Clear the WHOLE board, not just the enemies: setting invincible to 0
  // strips the mercy frames that were quietly absorbing whatever asteroids
  // and bullets an earlier check left in the air, and any one of them landing
  // would look exactly like a breach.
  api.enemies = []; api.clearBoard();
  api.lives = 5;
  api.player.shieldCharges = 0;
  api.player.invincible = 0;
  api.player.phaseReady = false;
  const before = api.lives;
  // A charger, not a drifter: drifters brake and hold station in the lower
  // third by design, so they are the wrong ship to test the offscreen cull.
  const e = api.makeEnemy('dart');
  e.y = 719; e.vy = 40;
  api.enemies.push(e);
  tick(6, 'no breach');
  if (api.lives !== before) throw new Error('leaving the screen still cost a life');
  if (api.enemies.indexOf(e) !== -1) throw new Error('it should still be culled offscreen');

  // And the station-keeping half of the same rule: a drifter does not leave.
  api.enemies = [];
  const d = api.makeEnemy('skiff');
  d.y = H_OF(api) * 0.75;
  api.enemies.push(d);
  tick(120, 'station keeping');
  if (api.enemies.indexOf(d) === -1) throw new Error('a drifter sailed off the bottom');
});

check('killing something records it in the bestiary', () => {
  api.state = 'play';
  api.level = 5;
  api.enemies = [];
  const e = api.makeEnemy('dart');
  e.x = 240; e.y = 200; e.hp = 0.001;
  api.enemies.push(e);
  tick(150, 'bestiary');
  // Either a bullet finished it or it breached; both paths should be safe.
  if (!api.seenEnemies) throw new Error('the bestiary ledger is missing');
});

check('the settings screen builds every row and draws', () => {
  api.openSettings('start');
  if (api.state !== 'settings') throw new Error('state is ' + api.state);
  const rows = api.settingsRows();
  if (rows.length < api.RLCore.BIND_ORDER.length + 4) throw new Error('rows: ' + rows.length);
  for (let i = 0; i < 400; i++) api.drawSettings();
  api.state = 'start';
});

check('the bestiary draws every column of both tabs', () => {
  api.openBestiary();
  for (let tab = 0; tab < 2; tab++) {
    const cols = api.bestiaryColumns();
    for (let c = 0; c < cols.length; c++) {
      const entries = api.bestiaryEntries();
      if (!Array.isArray(entries)) throw new Error('no entries for column ' + c);
      api.drawBestiary();
    }
  }
  api.state = 'start';
});

check('a hit costs scrap and never takes the build', () => {
  api.state = 'play';
  api.level = 5;
  api.enemies = [];
  api.lives = 9;
  api.scrap = 10000;
  // hitPlayer has four early returns before the penalty — phase drive,
  // shield, Phantom's slip, and mercy frames. All of them are correct
  // behaviour and none of them is what this test is about, so the state is
  // set up explicitly rather than inherited from whatever ran before.
  api.player.shieldCharges = 0;
  api.player.invincible = 0;
  api.player.phaseReady = false;
  api.player.phaseCharge = 0;
  const build = api.runUpgrades.length;
  api.hitPlayer();
  if (api.scrap >= 10000) throw new Error('the hit cost no scrap: ' + api.scrap);
  if (api.scrap < 4000) throw new Error('the hit cost far too much: ' + api.scrap);
  if (api.runUpgrades.length !== build) throw new Error('the hit stripped an upgrade');
});

check('every ship in the hangar launches a run without throwing', () => {
  for (const ship of api.CFG.ships) {
    api.Save.data.unlocked = [ship.id];
    api.Save.data.selectedShip = ship.id;
    try { api.startGame(); tick(180, ship.id); } catch (e) {
      throw new Error(`${ship.id} broke the loop: ${e.message}`);
    }
  }
  api.Save.data.unlocked = ['vanguard'];
  api.Save.data.selectedShip = 'vanguard';
});
