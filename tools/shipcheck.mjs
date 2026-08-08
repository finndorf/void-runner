// Ship hull bench. Splices a file of SHIP_ART.<id> = function(...) definitions
// into a copy of the game, boots it DOM-free with a RECORDING canvas stub, and
// draws every ship.
//
//   node tools/shipcheck.mjs <shipart.js>
//
// It checks three things:
//   1. every ship has art and drawing it never throws
//   2. each hull is a meaningful amount of drawing, not a stub
//   3. no two hulls produce the same geometry — the "recolour" test. Colours
//      are excluded from the fingerprint on purpose: two ships that differ
//      only by palette must FAIL, because that is exactly the thing this
//      expansion exists to stop.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const GAME = resolve(here, '..', 'void-runner.html');

const artFile = process.argv[2];
if (!artFile) { console.error('usage: node tools/shipcheck.mjs <shipart.js>'); process.exit(2); }
const artSrc = readFileSync(resolve(artFile), 'utf8');

const html = readFileSync(GAME, 'utf8');
let src = html.match(/<script>([\s\S]*)<\/script>/)[1];
const anchor = 'function drawShip(x, y, invincible, shield, t, muzzle, shipDef) {';
if (!src.includes(anchor)) { console.error('anchor not found'); process.exit(2); }
src = src.replace(anchor, artSrc + '\n' + anchor);

// ---- recording canvas -----------------------------------------------------
let ops = [];
let recording = false;
const GEOMETRY = new Set(['moveTo', 'lineTo', 'arc', 'ellipse', 'rect', 'fillRect', 'strokeRect',
  'quadraticCurveTo', 'bezierCurveTo', 'arcTo', 'closePath', 'beginPath', 'fill', 'stroke',
  'translate', 'rotate', 'scale', 'save', 'restore']);

const noop = () => {};
const ctxStub = new Proxy({}, {
  get(_, k) {
    if (k === 'canvas') return { width: 480, height: 720 };
    if (k === 'measureText') return () => ({ width: 10 });
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: noop });
    if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
    if (typeof k === 'string' && GEOMETRY.has(k)) {
      return (...a) => { if (recording) ops.push(k + ':' + a.map(v => typeof v === 'number' ? v.toFixed(1) : '').join(',')); };
    }
    return noop;
  },
  set() { return true; }   // colours and styles are deliberately NOT recorded
});

const canvas = { width: 480, height: 720, style: {}, getContext: () => ctxStub, addEventListener: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 480, height: 720 }) };
const store = new Map();
const win = { addEventListener: noop, removeEventListener: noop, innerWidth: 1200, innerHeight: 900, devicePixelRatio: 1,
  localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
  requestAnimationFrame: () => 0, AudioContext: function () { throw new Error('audio off'); } };
const doc = { getElementById: () => canvas, querySelector: () => canvas, addEventListener: noop, removeEventListener: noop,
  createElement: () => canvas, body: { appendChild: noop, style: {} }, documentElement: { style: {} } };
const sandbox = { document: doc, window: win, localStorage: win.localStorage, requestAnimationFrame: win.requestAnimationFrame,
  AudioContext: win.AudioContext, webkitAudioContext: win.AudioContext, CanvasRenderingContext2D: function () {},
  devicePixelRatio: 1, console, Math, JSON, Date, isNaN, parseFloat, parseInt,
  Array, Object, String, Number, Boolean, Error, Set, Map, Proxy, Uint8ClampedArray, Float32Array,
  performance: { now: () => 0 } };
sandbox.CanvasRenderingContext2D.prototype = {};

const names = Object.keys(sandbox);
let api;
try {
  api = new Function(...names, src + '; return { CFG, SHIP_ART, drawShip, startGame };')(...names.map(k => sandbox[k]));
} catch (e) {
  console.error('BOOT FAILED — the spliced art file has a syntax or load error:\n' + e.message);
  console.error(e.stack.split('\n').slice(0, 5).join('\n'));
  process.exit(1);
}

let fails = 0;
const prints = new Map();

for (const ship of api.CFG.ships) {
  if (!api.SHIP_ART[ship.id]) { console.log(`  FAIL  ${ship.id}: no SHIP_ART entry`); fails++; continue; }
  ops = []; recording = true;
  let err = null;
  try { api.drawShip(240, 600, 0, 0, 30, 0, ship); } catch (e) { err = e; }
  recording = false;
  if (err) { console.log(`  FAIL  ${ship.id}: drawShip threw — ${err.message}`); fails++; continue; }

  // Only the art's own ops matter, but the shared chrome is a constant across
  // every ship, so it cannot mask a difference or manufacture one.
  const print = ops.join('|');
  if (ops.length < 24) { console.log(`  FAIL  ${ship.id}: only ${ops.length} drawing ops — that is a stub, not a hull`); fails++; continue; }

  const twin = [...prints.entries()].find(([, p]) => p === print);
  if (twin) { console.log(`  FAIL  ${ship.id}: identical geometry to ${twin[0]} — a recolour, not a hull`); fails++; continue; }
  prints.set(ship.id, print);
  console.log(`  ok    ${ship.id.padEnd(10)} ${String(ops.length).padStart(4)} drawing ops`);
}

console.log(fails ? `\n${fails} failed` : `\nall ${api.CFG.ships.length} hulls are distinct`);
process.exit(fails ? 1 : 0);
