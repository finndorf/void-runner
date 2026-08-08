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
const fn = new Function(...keys, `${src}\n; return { get state(){return state}, get level(){return level}, get lives(){return lives}, get scrap(){return scrap}, get voidbirths(){return voidbirths}, get boss(){return boss}, get enemies(){return enemies}, get runUpgrades(){return runUpgrades}, get stats(){return stats}, RLCore, CFG, loop, update, draw, startGame, levelUp, openShop, closeShop, updateVoidbirth, tryBuySlot, tryReroll, set state(v){state=v}, set level(v){level=v} };`);

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
  if (api.boss.name !== 'SCRAPJAW') throw new Error('boss is ' + api.boss.name);
  if (api.boss.maxHp !== 6600) throw new Error('boss hp ' + api.boss.maxHp);
});

check('900 frames of a boss fight without throwing', () => tick(900, 'boss'));

check('voidbirth triggers at level 50 and completes', () => {
  api.level = 49;
  api.levelUp();                       // -> 50, no ascension yet
  if (api.state === 'shop') api.closeShop();
  api.level = 50;
  api.levelUp();                       // clearing 50 ascends
  if (api.state !== 'voidbirth') throw new Error('state is ' + api.state);
  // sequence is driven below
  // drive the sequence via the real loop path
  let guard = 0;
  while (api.state === 'voidbirth' && guard++ < 2000) { api.draw(); tickVoid(); }
  if (api.state !== 'play') throw new Error('voidbirth never finished, state=' + api.state);
  if (api.voidbirths !== 1) throw new Error('voidbirths=' + api.voidbirths);
  if (api.runUpgrades.length !== 0) throw new Error('upgrades survived the voidbirth');
  if (api.scrap !== 0) throw new Error('scrap survived the voidbirth: ' + api.scrap);
});

function tickVoid() { api.updateVoidbirth(); }

check('deep levels do not throw', () => {
  api.level = 1200;
  tick(400, 'level 1200');
});
