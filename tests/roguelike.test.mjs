// Tests for the pure roguelike core of Void Runner.
//
// These assert the DESIGN INVARIANTS from
// docs/superpowers/specs/2026-08-08-void-ascension-design.md, not merely
// whatever the code happens to return today. Where a test only restates the
// implementation it is worthless, so every assertion here is one a wrong
// change could break.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadCore } from './extract.mjs';

const core = loadCore();

const HTML = join(dirname(fileURLToPath(import.meta.url)), '..', 'void-runner.html');
const START = '// ===== ROGUELIKE CORE (PURE) =====';
const END = '// ===== END ROGUELIKE CORE (PURE) =====';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EPS = 1e-9;
const close = (a, b, msg) =>
  assert.ok(Math.abs(a - b) < 1e-6, msg || `expected ${a} ≈ ${b}`);

// mulberry32: a plain 32-bit integer generator. Every intermediate stays inside
// Math.imul / >>> 0, so nothing can silently drift past 2^53 and degenerate the
// way a naive float LCG does. Verified by the first three tests below.
function makeRnd(seed) {
  let a = seed >>> 0;
  return function rnd() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A stub that plays back a fixed script of values, then repeats the last one.
// Lets a test drive rollRarity to an exact tier and then pick from the pool.
function scripted(values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

// rollRarity draws the one-in-a-million SECRET check BEFORE it touches the
// ladder, so any sequence meant to land on a ladder tier has to start with a
// value outside that window. `ladder()` prepends one; `flat()` is the
// constant-value equivalent.
const ladder = values => scripted([0.5].concat(values));
const flat = v => scripted([0.5, v]);

const SHIP = { fireMul: 1, speed: 5, spreadMul: 1 };
// The LADDER, not TIERS: almost every rule in this file is about the eleven
// rungs you climb, and SECRET is deliberately not one of them.
const TIER_IDS = core.LADDER.map(t => t.id);

const DEFAULTS = () => ({
  version: core.SAVE_VERSION, hiScore: 0, bestLevel: 1, totalRuns: 0, totalKills: 0,
  credits: 0, unlocked: ['vanguard'], selectedShip: 'vanguard', muted: false,
  bestScrapSpent: 0, apexFound: 0,
  voidbirths: 0, bestVoidbirth: 0, tiersFound: {}, bossesKilled: {},
  seenUpgrades: {}, seenEnemies: {}, seenMeteors: {},
  settings: core.defaultSettings()
});

const baseStats = over => Object.assign({
  needle: false, extraShots: 0, spread: 1,
  rear: false, sides: false, twinCore: false
}, over);

// Everything owned in `tiers`, each entry pushed to its stack limit at vb 0.
function exhaust(tiers) {
  return core.UPGRADES
    .filter(u => tiers.indexOf(u.tier) !== -1)
    .map(u => ({ id: u.id, stacks: core.tierOf(u.tier).stackLimit }));
}

// ---------------------------------------------------------------------------
// 0. The harness itself
// ---------------------------------------------------------------------------

test('the pure block loads and exposes RLCore', () => {
  assert.equal(typeof core, 'object');
  assert.notEqual(core, null);
  assert.equal(typeof core.rarityWeights, 'function');
});

test('the seeded PRNG produces varied values inside [0,1)', () => {
  const rnd = makeRnd(0xC0FFEE);
  const seen = new Set();
  let min = 1, max = 0, sum = 0;
  for (let i = 0; i < 10000; i++) {
    const v = rnd();
    assert.ok(v >= 0 && v < 1, `PRNG produced ${v}, outside [0,1)`);
    seen.add(v); sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  assert.ok(seen.size > 9900, `PRNG degenerated: only ${seen.size} distinct values`);
  assert.ok(min < 0.01 && max > 0.99, 'PRNG never reaches the extremes of the range');
  assert.ok(Math.abs(sum / 10000 - 0.5) < 0.02, 'PRNG mean is not ~0.5');
});

test('the seeded PRNG is deterministic and seed-dependent', () => {
  const a = makeRnd(7), b = makeRnd(7), c = makeRnd(8);
  const seqA = [a(), a(), a()], seqB = [b(), b(), b()], seqC = [c(), c(), c()];
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
});

test('the pure block references no DOM, no game globals and no ambient randomness', () => {
  const src = readFileSync(HTML, 'utf8');
  const a = src.indexOf(START), b = src.indexOf(END);
  assert.ok(a !== -1 && b !== -1, 'pure block sentinels not found');
  // Strip comments first: the block's own prose legitimately talks about the
  // canvas, the player and randomness, and flagging that would be noise.
  const code = src.slice(a + START.length, b)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
  const banned = ['document', 'window', 'ctx', 'canvas', 'Save', 'Sound', 'Music', 'player'];
  for (const name of banned) {
    const hits = code.match(new RegExp('\\b' + name + '\\b', 'g'));
    assert.equal(hits, null, `pure block references ${name} (${hits && hits.length} times)`);
  }
  assert.equal(/\bMath\.random\b/.test(code), false, 'pure block calls Math.random');
});

test('the purity scan would still catch a real reference (the scan is not vacuous)', () => {
  const probe = 'const x = document.body;\n// a comment mentioning document\n'
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
  assert.equal(probe.match(/\bdocument\b/g).length, 1);
});

// ---------------------------------------------------------------------------
// 1. Save migration
// ---------------------------------------------------------------------------

test('SAVE_VERSION is 6, as the spec requires', () => {
  assert.equal(core.SAVE_VERSION, 6);
});

test('a v1 save keeps its credits, ships and lifetime records', () => {
  const v1 = {
    version: 1, hiScore: 12400, bestLevel: 7, totalRuns: 31, totalKills: 900,
    credits: 4250, unlocked: ['vanguard', 'needle'], selectedShip: 'needle', muted: true
  };
  const { data, ok } = core.migrateSave(v1, DEFAULTS());
  assert.equal(ok, true);
  assert.equal(data.credits, 4250);
  assert.equal(data.hiScore, 12400);
  assert.equal(data.totalRuns, 31);
  assert.equal(data.totalKills, 900);
  assert.equal(data.bestLevel, 7);
  assert.deepEqual(data.unlocked, ['vanguard', 'needle']);
  assert.equal(data.selectedShip, 'needle');
  assert.equal(data.muted, true);
});

test('a v1 save is stamped with the current version and gains every new field', () => {
  const { data } = core.migrateSave({ version: 1, credits: 100 }, DEFAULTS());
  assert.equal(data.version, core.SAVE_VERSION);
  assert.equal(data.voidbirths, 0);
  assert.equal(data.bestVoidbirth, 0);
  assert.deepEqual(data.tiersFound, {});
  assert.deepEqual(data.bossesKilled, {});
  assert.equal(data.bestScrapSpent, 0);
  assert.equal(data.apexFound, 0);
});

test('a v2 save keeps its credits, ships and v2-era records', () => {
  const v2 = {
    version: 2, hiScore: 55000, bestLevel: 12, totalRuns: 4, totalKills: 77,
    credits: 9999, unlocked: ['vanguard', 'bulwark'], selectedShip: 'bulwark',
    muted: false, bestScrapSpent: 8100, apexFound: 3
  };
  const { data, ok } = core.migrateSave(v2, DEFAULTS());
  assert.equal(ok, true);
  assert.equal(data.credits, 9999);
  assert.equal(data.hiScore, 55000);
  assert.deepEqual(data.unlocked, ['vanguard', 'bulwark']);
  assert.equal(data.selectedShip, 'bulwark');
  assert.equal(data.bestScrapSpent, 8100, 'v2 already had bestScrapSpent; it must not be reset');
  assert.equal(data.apexFound, 3, 'v2 already had apexFound; it must not be reset');
});

test('a v2 save gains the voidbirth fields and the current version', () => {
  const { data } = core.migrateSave({ version: 2, credits: 1 }, DEFAULTS());
  assert.equal(data.version, core.SAVE_VERSION);
  assert.equal(data.voidbirths, 0);
  assert.equal(data.bestVoidbirth, 0);
  assert.deepEqual(data.tiersFound, {});
  assert.deepEqual(data.bossesKilled, {});
});

// v4 adds the bestiary and the settings panel. An old save must come out
// playable: nothing seen, and every control at its default.
test('any older save gains an empty bestiary and default settings', () => {
  [1, 2, 3, 4, 5].forEach(version => {
    const { data, ok } = core.migrateSave({ version, credits: 5 }, DEFAULTS());
    assert.equal(ok, true, `v${version} should migrate, not be discarded`);
    assert.equal(data.version, core.SAVE_VERSION);
    assert.deepEqual(data.seenUpgrades, {}, `v${version} seenUpgrades`);
    assert.deepEqual(data.seenEnemies, {}, `v${version} seenEnemies`);
    assert.deepEqual(data.seenMeteors, {}, `v${version} seenMeteors`);
    assert.deepEqual(data.settings, core.defaultSettings(), `v${version} settings`);
    assert.equal(data.credits, 5, 'and it must not lose the credits');
  });
});

test('a v4 save keeps the bestiary it already had', () => {
  const { data } = core.migrateSave({
    version: 4, seenEnemies: { skiff: 1 }, seenUpgrades: { reload_coil: 'COMMON' }
  }, DEFAULTS());
  assert.deepEqual(data.seenEnemies, { skiff: 1 });
  assert.deepEqual(data.seenUpgrades, { reload_coil: 'COMMON' });
});

// ---- settings -------------------------------------------------------------

test('the default settings are three full-ish volumes and a full keymap', () => {
  const st = core.defaultSettings();
  ['volMusic', 'volAmbient', 'volAttack'].forEach(k => {
    assert.ok(st[k] > 0 && st[k] <= 1, `${k} is ${st[k]}`);
  });
  assert.equal(st.autoSkip, false);
  core.BIND_ORDER.forEach(k => {
    assert.ok(Array.isArray(st.binds[k]) && st.binds[k].length > 0, `${k} has no binding`);
    assert.ok(core.BIND_LABELS[k], `${k} has no label for the settings screen`);
  });
});

test('defaultSettings hands back a fresh object every time', () => {
  const a = core.defaultSettings();
  a.binds.left.push('zzz');
  assert.ok(core.defaultSettings().binds.left.indexOf('zzz') === -1,
    'the defaults were mutated through a returned reference');
});

// The settings blob is the one piece of save data a player can put into a
// bad state, so the normalizer always has to return something playable.
test('normalizeSettings survives anything', () => {
  [null, undefined, 42, 'nonsense', [], {}].forEach(bad => {
    const st = core.normalizeSettings(bad);
    assert.equal(typeof st.volMusic, 'number');
    core.BIND_ORDER.forEach(k => assert.ok(st.binds[k].length > 0, `${k} from ${JSON.stringify(bad)}`));
  });
});

test('normalizeSettings clamps volumes into range', () => {
  const st = core.normalizeSettings({ volMusic: 5, volAmbient: -3, volAttack: NaN });
  assert.equal(st.volMusic, 1);
  assert.equal(st.volAmbient, 0);
  assert.equal(st.volAttack, core.defaultSettings().volAttack, 'NaN falls back to the default');
});

// An empty binding list would leave an action unreachable with no way to fix
// it from inside the game.
test('an empty or malformed binding falls back to its default', () => {
  const st = core.normalizeSettings({ binds: { left: [], right: 'nope', up: [7], fire: ['z'] } });
  assert.deepEqual(st.binds.left, core.DEFAULT_BINDS.left);
  assert.deepEqual(st.binds.right, core.DEFAULT_BINDS.right);
  assert.deepEqual(st.binds.up, core.DEFAULT_BINDS.up);
  assert.deepEqual(st.binds.fire, ['z'], 'a good binding is kept');
});

test('normalizeSettings keeps a valid blob unchanged', () => {
  const st = core.defaultSettings();
  st.volMusic = 0.25; st.autoSkip = true; st.binds.fire = ['q'];
  assert.deepEqual(core.normalizeSettings(st), st);
});

test('a v3 save loads untouched, voidbirth progress and all', () => {
  const v3 = Object.assign(DEFAULTS(), {
    credits: 4000, voidbirths: 3, bestVoidbirth: 4, bestLevel: 612,
    tiersFound: { APEX: 2, DYNACLOCKED: 1 }, bossesKilled: { threshold: 1 },
    unlocked: ['vanguard', 'ascendant'], selectedShip: 'ascendant'
  });
  const { data, ok } = core.migrateSave(v3, DEFAULTS());
  assert.equal(ok, true);
  assert.equal(data.voidbirths, 3, 'a v3 voidbirth count must survive a v3 load');
  assert.equal(data.bestVoidbirth, 4);
  assert.equal(data.bestLevel, 612);
  assert.deepEqual(data.tiersFound, { APEX: 2, DYNACLOCKED: 1 });
  assert.deepEqual(data.bossesKilled, { threshold: 1 });
  assert.equal(data.selectedShip, 'ascendant');
});

test('a save from the future is refused, not silently downgraded', () => {
  const { data, ok } = core.migrateSave({ version: 99, credits: 500 }, DEFAULTS());
  assert.equal(ok, false, 'ok:false is what stops the game overwriting a save it did not understand');
  assert.deepEqual(data, DEFAULTS());
});

test('null is refused and returns the defaults', () => {
  const { data, ok } = core.migrateSave(null, DEFAULTS());
  assert.equal(ok, false);
  assert.deepEqual(data, DEFAULTS());
});

test('undefined is refused and returns the defaults', () => {
  const { data, ok } = core.migrateSave(undefined, DEFAULTS());
  assert.equal(ok, false);
  assert.deepEqual(data, DEFAULTS());
});

test('a bare string is refused and returns the defaults', () => {
  const { data, ok } = core.migrateSave('not a save at all', DEFAULTS());
  assert.equal(ok, false);
  assert.deepEqual(data, DEFAULTS());
});

test('a number is refused and returns the defaults', () => {
  const { data, ok } = core.migrateSave(42, DEFAULTS());
  assert.equal(ok, false);
  assert.deepEqual(data, DEFAULTS());
});

test('an object with no version is refused and returns the defaults', () => {
  const { data, ok } = core.migrateSave({}, DEFAULTS());
  assert.equal(ok, false);
  assert.deepEqual(data, DEFAULTS());
});

test('an array is refused even though typeof says object', () => {
  const { data, ok } = core.migrateSave([1, 2, 3], DEFAULTS());
  assert.equal(ok, false);
  assert.deepEqual(data, DEFAULTS());
});

test('version 0 and negative versions are refused', () => {
  assert.equal(core.migrateSave({ version: 0 }, DEFAULTS()).ok, false);
  assert.equal(core.migrateSave({ version: -1 }, DEFAULTS()).ok, false);
  assert.equal(core.migrateSave({ version: '3' }, DEFAULTS()).ok, false);
});

test('a corrupt unlocked list is repaired without losing credits', () => {
  const { data, ok } = core.migrateSave(
    { version: 1, credits: 800, unlocked: 'nonsense', selectedShip: 'ghost' },
    DEFAULTS()
  );
  assert.equal(ok, true);
  assert.equal(data.credits, 800);
  assert.deepEqual(data.unlocked, ['vanguard']);
  assert.equal(data.selectedShip, 'vanguard');
});

test('an empty unlocked list is repaired to the starter ship', () => {
  const { data } = core.migrateSave({ version: 3, unlocked: [] }, DEFAULTS());
  assert.deepEqual(data.unlocked, ['vanguard']);
});

test('a selected ship the player does not own falls back to the starter', () => {
  const { data } = core.migrateSave(
    { version: 3, unlocked: ['vanguard', 'needle'], selectedShip: 'wraith' }, DEFAULTS()
  );
  assert.equal(data.selectedShip, 'vanguard');
});

test('corrupt tiersFound and bossesKilled are replaced with empty maps', () => {
  const { data } = core.migrateSave(
    { version: 3, tiersFound: 'broken', bossesKilled: 7 }, DEFAULTS()
  );
  assert.deepEqual(data.tiersFound, {});
  assert.deepEqual(data.bossesKilled, {});
});

test('migration never mutates the object it was handed', () => {
  const v1 = Object.freeze({ version: 1, credits: 300, unlocked: Object.freeze(['vanguard']) });
  const { data } = core.migrateSave(v1, DEFAULTS());
  assert.equal(v1.version, 1, 'the input save was rewritten in place');
  assert.notEqual(data, v1);
});

test('a v1 bestLevel of 0 is floored at 1 rather than left invalid', () => {
  const { data } = core.migrateSave({ version: 1, bestLevel: 0 }, DEFAULTS());
  assert.equal(data.bestLevel, 1);
});

// ---------------------------------------------------------------------------
// 2. The tier ladder
// ---------------------------------------------------------------------------

const SPEC_TIERS = [
  ['COMMON', 240, 5], ['UNCOMMON', 500, 5], ['RARE', 900, 3], ['EPIC', 2100, 2],
  ['LEGENDARY', 4500, 1], ['MYTHIC', 7000, 1], ['APEX', 11000, 1],
  ['OVERCLOCKED', 20000, 1], ['HYPERCLOCKED', 34000, 1],
  ['UBERCLOCKED', 55000, 1], ['DYNACLOCKED', 90000, 1]
];

test('eleven tiers on the ladder, plus SECRET off it', () => {
  assert.equal(core.LADDER.length, 11);
  assert.equal(core.MAX_TIER_INDEX, 10);
  assert.equal(core.TIERS.length, 12);
  assert.equal(core.TIERS[11].id, 'SECRET');
});

test('the tiers appear in the documented order COMMON…DYNACLOCKED', () => {
  assert.deepEqual(core.LADDER.map(t => t.id), SPEC_TIERS.map(t => t[0]));
});

// The whole point of SECRET is that it sits outside every mechanism that
// walks the ladder. If any of these stop holding it has become an ordinary
// twelfth tier with a silly price.
test('SECRET is off the ladder entirely', () => {
  const secret = core.tierOf('SECRET');
  assert.equal(secret.offLadder, true);
  assert.equal(secret.price, 1, 'a SECRET card costs one scrap');
  assert.ok(!core.LADDER.some(t => t.id === 'SECRET'), 'SECRET must not be on the ladder');
});

test('SECRET never drifts, shifts or promotes with depth', () => {
  for (let vb = 0; vb <= core.MAX_VOIDBIRTH; vb++) {
    const w = core.rarityWeights(500, vb);
    assert.ok(!w.SECRET, `SECRET picked up ladder weight at voidbirth ${vb}`);
    const card = core.UPGRADES.find(u => u.tier === 'SECRET');
    assert.equal(core.effectiveTier(card, vb), 'SECRET',
      `a SECRET card was promoted off its own tier at voidbirth ${vb}`);
  }
});

test('SECRET comes up at one in a million, and only from its own draw', () => {
  assert.equal(core.SECRET_CHANCE, 1 / 1000000);
  // Just inside the window -> SECRET; just outside -> the ordinary ladder.
  assert.equal(core.rollRarity(1, 0, () => 0), 'SECRET');
  const seq = [core.SECRET_CHANCE, 0];
  let i = 0;
  assert.equal(core.rollRarity(1, 0, () => seq[i++]), 'COMMON');
});

test('every tier price matches the spec price table', () => {
  SPEC_TIERS.forEach(([id, price]) => {
    assert.equal(core.tierOf(id).price, price, `${id} price`);
  });
});

test('tier prices are strictly increasing up the ladder', () => {
  for (let i = 1; i < core.LADDER.length; i++) {
    assert.ok(core.LADDER[i].price > core.LADDER[i - 1].price,
      `${core.LADDER[i].id} (${core.LADDER[i].price}) must cost more than ${core.LADDER[i - 1].id}`);
  }
});

test('every tier stack limit matches the spec', () => {
  SPEC_TIERS.forEach(([id, , stacks]) => {
    assert.equal(core.tierOf(id).stackLimit, stacks, `${id} stackLimit`);
  });
});

test('stack limits never increase as the ladder rises', () => {
  for (let i = 1; i < core.LADDER.length; i++) {
    assert.ok(core.LADDER[i].stackLimit <= core.LADDER[i - 1].stackLimit,
      `${core.LADDER[i].id} stacks more than the tier below it`);
  }
});

test('tierIndexOf and tierOf round-trip for every tier', () => {
  core.LADDER.forEach((t, i) => {
    assert.equal(core.tierIndexOf(t.id), i);
    assert.equal(core.tierOf(t.id).id, t.id);
    assert.equal(core.tierOf(core.TIERS[core.tierIndexOf(t.id)].id), t);
  });
});

test('tierIndexOf throws on an unknown tier id', () => {
  assert.throws(() => core.tierIndexOf('PLATINUM'), /unknown tier id/);
});

test('tierOf throws on an unknown tier id', () => {
  assert.throws(() => core.tierOf('PLATINUM'), /unknown tier id/);
  assert.throws(() => core.tierOf(''), /unknown tier id/);
  assert.throws(() => core.tierOf(undefined), /unknown tier id/);
});

test('every tier carries two distinct display colours', () => {
  core.LADDER.forEach(t => {
    assert.match(t.color, /^#[0-9a-f]{6}$/i, `${t.id} color`);
    assert.match(t.color2, /^#[0-9a-f]{6}$/i, `${t.id} color2`);
  });
});

test('tier ids are unique', () => {
  assert.equal(new Set(TIER_IDS).size, core.LADDER.length);
});

// ---------------------------------------------------------------------------
// 3. Rarity weights — the heart of it
// ---------------------------------------------------------------------------

const sumWeights = w => TIER_IDS.reduce((a, id) => a + w[id], 0);

test('the base weight vector matches the spec', () => {
  assert.deepEqual(core.WEIGHT_VECTOR, [51.5, 27, 13, 6, 1.7, 0.49, 0.30, 0.01]);
  assert.equal(core.WEIGHT_VECTOR.reduce((a, b) => a + b, 0), 100);
});

for (let vb = 0; vb <= 5; vb++) {
  test(`weights sum to exactly 100 at voidbirth ${vb}`, () => {
    assert.ok(Math.abs(sumWeights(core.rarityWeights(1, vb)) - 100) < EPS);
  });

  test(`no weight is negative at voidbirth ${vb}`, () => {
    [1, 2, 7, 40, 120, 900, 2500].forEach(level => {
      const w = core.rarityWeights(level, vb);
      TIER_IDS.forEach(id => assert.ok(w[id] >= 0, `${id} is ${w[id]} at level ${level} vb ${vb}`));
    });
  });

  test(`the floor tier at voidbirth ${vb} is TIERS[${vb}] and everything below it is exactly 0`, () => {
    const w = core.rarityWeights(1, vb);
    const floor = core.TIERS[vb].id;
    assert.equal(core.floorTierIndex(vb), vb);
    assert.ok(w[floor] > 0, `${floor} must be offered at voidbirth ${vb}`);
    for (let i = 0; i < vb; i++) {
      assert.equal(w[TIER_IDS[i]], 0, `${TIER_IDS[i]} must be gone at voidbirth ${vb}`);
    }
  });

  test(`the floor tier stays exactly 0 below the floor at every level, voidbirth ${vb}`, () => {
    [1, 3, 60, 500, 2500].forEach(level => {
      const w = core.rarityWeights(level, vb);
      for (let i = 0; i < vb; i++) {
        assert.equal(w[TIER_IDS[i]], 0, `${TIER_IDS[i]} leaked back in at level ${level}`);
      }
    });
  });
}

test('the spec VB0 vector is reproduced exactly', () => {
  const w = core.rarityWeights(1, 0);
  assert.deepEqual(TIER_IDS.map(id => w[id]),
    [51.5, 27, 13, 6, 1.7, 0.49, 0.30, 0.01, 0, 0, 0]);
});

test('the spec VB1 vector is reproduced exactly', () => {
  const w = core.rarityWeights(1, 1);
  assert.deepEqual(TIER_IDS.map(id => w[id]),
    [0, 51.5, 27, 13, 6, 1.7, 0.49, 0.30, 0.01, 0, 0]);
});

test('the spec VB2 vector is reproduced exactly', () => {
  const w = core.rarityWeights(1, 2);
  assert.deepEqual(TIER_IDS.map(id => w[id]),
    [0, 0, 51.5, 27, 13, 6, 1.7, 0.49, 0.30, 0.01, 0]);
});

test('the spec VB3 vector is reproduced exactly', () => {
  const w = core.rarityWeights(1, 3);
  assert.deepEqual(TIER_IDS.map(id => w[id]),
    [0, 0, 0, 51.5, 27, 13, 6, 1.7, 0.49, 0.30, 0.01]);
});

test('at VB4 the overflow piles onto DYNACLOCKED rather than vanishing', () => {
  const w = core.rarityWeights(1, 4);
  assert.deepEqual(TIER_IDS.map(id => w[id]),
    [0, 0, 0, 0, 51.5, 27, 13, 6, 1.7, 0.49, 0.31]);
  close(sumWeights(w), 100);
});

test('at VB5 the overflow piles onto DYNACLOCKED rather than vanishing', () => {
  const w = core.rarityWeights(1, 5);
  assert.deepEqual(TIER_IDS.map(id => w[id]),
    [0, 0, 0, 0, 0, 51.5, 27, 13, 6, 1.7, 0.80]);
  close(sumWeights(w), 100);
});

for (let vb = 0; vb < 3; vb++) {
  test(`voidbirth ${vb} → ${vb + 1} shifts the whole vector up exactly one rung`, () => {
    const a = core.rarityWeights(1, vb), b = core.rarityWeights(1, vb + 1);
    for (let i = 0; i < core.MAX_TIER_INDEX; i++) {
      close(b[TIER_IDS[i + 1]], a[TIER_IDS[i]],
        `${TIER_IDS[i + 1]} at vb${vb + 1} should inherit ${TIER_IDS[i]}'s ${a[TIER_IDS[i]]} from vb${vb}`);
    }
  });
}

test('the shift still holds below the pile-on point at voidbirth 3 → 4', () => {
  const a = core.rarityWeights(1, 3), b = core.rarityWeights(1, 4);
  // Everything below DYNACLOCKED shifts cleanly; DYNACLOCKED absorbs the overflow.
  for (let i = 0; i < core.MAX_TIER_INDEX - 1; i++) {
    close(b[TIER_IDS[i + 1]], a[TIER_IDS[i]], TIER_IDS[i + 1]);
  }
  close(b.DYNACLOCKED, a.UBERCLOCKED + a.DYNACLOCKED);
});

test('the shift still holds below the pile-on point at voidbirth 4 → 5', () => {
  const a = core.rarityWeights(1, 4), b = core.rarityWeights(1, 5);
  for (let i = 0; i < core.MAX_TIER_INDEX - 1; i++) {
    close(b[TIER_IDS[i + 1]], a[TIER_IDS[i]], TIER_IDS[i + 1]);
  }
  close(b.DYNACLOCKED, a.UBERCLOCKED + a.DYNACLOCKED);
});

test('HYPERCLOCKED is unreachable before voidbirth 1, at every depth of level', () => {
  [1, 2, 15, 49, 200, 800, 2500].forEach(level => {
    assert.equal(core.rarityWeights(level, 0).HYPERCLOCKED, 0, `level ${level}`);
  });
  assert.equal(core.tierReachable('HYPERCLOCKED', 0), false);
  assert.equal(core.tierReachable('HYPERCLOCKED', 1), true);
});

test('UBERCLOCKED is unreachable before voidbirth 2, at every depth of level', () => {
  [1, 2, 99, 350, 1500, 2500].forEach(level => {
    assert.equal(core.rarityWeights(level, 0).UBERCLOCKED, 0, `vb0 level ${level}`);
    assert.equal(core.rarityWeights(level, 1).UBERCLOCKED, 0, `vb1 level ${level}`);
  });
  assert.equal(core.tierReachable('UBERCLOCKED', 1), false);
  assert.equal(core.tierReachable('UBERCLOCKED', 2), true);
});

test('DYNACLOCKED is unreachable before voidbirth 3, at every depth of level', () => {
  [1, 2, 199, 500, 2000, 2500].forEach(level => {
    for (const vb of [0, 1, 2]) {
      assert.equal(core.rarityWeights(level, vb).DYNACLOCKED, 0, `vb${vb} level ${level}`);
    }
  });
  assert.equal(core.tierReachable('DYNACLOCKED', 2), false);
  assert.equal(core.tierReachable('DYNACLOCKED', 3), true);
});

test('a locked tier cannot be rolled even with a random value pinned at the very top', () => {
  for (let i = 0; i < 200; i++) {
    const r = 1 - 1e-9 - i * 1e-4;
    assert.notEqual(core.rollRarity(2500, 0, () => r), 'HYPERCLOCKED');
    assert.notEqual(core.rollRarity(2500, 0, () => r), 'UBERCLOCKED');
    assert.notEqual(core.rollRarity(2500, 1, () => r), 'UBERCLOCKED');
    assert.notEqual(core.rollRarity(2500, 2, () => r), 'DYNACLOCKED');
  }
});

for (const level of [1, 2, 50, 500, 2500]) {
  test(`weights still sum to 100 at level ${level}, at every voidbirth depth`, () => {
    for (let vb = 0; vb <= 5; vb++) {
      close(sumWeights(core.rarityWeights(level, vb)), 100, `level ${level} vb ${vb}`);
    }
  });
}

test('weights sum to 100 across a broad sweep of levels and depths', () => {
  for (let vb = 0; vb <= 5; vb++) {
    for (let level = 1; level <= 600; level += 7) {
      close(sumWeights(core.rarityWeights(level, vb)), 100, `level ${level} vb ${vb}`);
    }
  }
});

test('drift moves weight off the floor tier as the segment goes on', () => {
  const l1 = core.rarityWeights(1, 0).COMMON;
  const l2 = core.rarityWeights(2, 0).COMMON;
  const l20 = core.rarityWeights(20, 0).COMMON;
  assert.equal(l1, 51.5);
  assert.ok(l2 < l1, 'the floor tier must thin out with depth');
  assert.ok(l20 < l2);
  close(l2, 51.0, 'one level of drift is DRIFT_PER_LEVEL off the floor');
});

test('drift is capped at DRIFT_MAX, so the floor tier never disappears', () => {
  const deep = core.rarityWeights(2500, 0);
  close(deep.COMMON, 51.5 - core.DRIFT_MAX);
  close(core.rarityWeights(41, 0).COMMON, 51.5 - core.DRIFT_MAX,
    'the cap is reached at 40 levels of drift and stays there');
});

test('drift never drives any weight negative, however deep the level', () => {
  for (let vb = 0; vb <= 5; vb++) {
    for (const level of [1, 2, 41, 200, 2500, 100000]) {
      const w = core.rarityWeights(level, vb);
      TIER_IDS.forEach(id => assert.ok(w[id] >= 0, `${id} negative at level ${level} vb ${vb}`));
    }
  }
});

test('drift adds to the middle tiers exactly what it takes from the floor', () => {
  const a = core.rarityWeights(1, 0), b = core.rarityWeights(2500, 0);
  const lost = a.COMMON - b.COMMON;
  const gained = ['UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY']
    .reduce((acc, id) => acc + (b[id] - a[id]), 0);
  close(gained, lost, 'drift must conserve weight, not create it');
  assert.ok(lost > 0);
});

for (let vb = 0; vb <= 5; vb++) {
  test(`the top three positions of the vector never move with level, voidbirth ${vb}`, () => {
    const at1 = core.rarityWeights(1, vb);
    for (const level of [2, 12, 50, 400, 2500]) {
      const w = core.rarityWeights(level, vb);
      for (let p = core.WEIGHT_VECTOR.length - core.UNDRIFTABLE_POSITIONS;
           p < core.WEIGHT_VECTOR.length; p++) {
        const id = core.TIERS[Math.min(core.MAX_TIER_INDEX, vb + p)].id;
        close(w[id], at1[id], `${id} drifted at level ${level}, vb ${vb}`);
      }
    }
  });
}

test('APEX odds are a fixed promise at voidbirth 0, level or no level', () => {
  [1, 2, 10, 49, 300, 2500].forEach(level => {
    assert.equal(core.rarityWeights(level, 0).APEX, 0.30, `level ${level}`);
    assert.equal(core.rarityWeights(level, 0).OVERCLOCKED, 0.01, `level ${level}`);
    assert.equal(core.rarityWeights(level, 0).MYTHIC, 0.49, `level ${level}`);
  });
});

test('drift resets at each voidbirth, so an ascension starts the odds fresh', () => {
  // An ascension now drops you back to level 1, so "fresh" is literally
  // level 1 at every depth rather than a per-segment origin.
  for (let vb = 0; vb <= core.MAX_VOIDBIRTH; vb++) {
    assert.equal(core.levelsIntoSegment(1, vb), 0, `depth ${vb}`);
  }
  const fresh = core.rarityWeights(1, 1);
  assert.equal(fresh.UNCOMMON, 51.5, 'the new floor tier must start undrifted');
  const drifted = core.rarityWeights(60, 1);
  assert.ok(drifted.UNCOMMON < fresh.UNCOMMON, 'and drift off it as the segment runs');
});

test('levelsIntoSegment counts from level 1, because an ascension resets there', () => {
  assert.equal(core.levelsIntoSegment(2, 0), 1);
  assert.equal(core.levelsIntoSegment(60, 1), 59, 'depth no longer shifts the origin');
  assert.equal(core.levelsIntoSegment(1, 5), 0, 'level 1 is always zero levels in');
  assert.equal(core.levelsIntoSegment(0, 0), 0, 'and it never goes negative');
  assert.equal(core.levelsIntoSegment(-9, 3), 0);
});

test('clampVoidbirth keeps depth inside 0..MAX_VOIDBIRTH', () => {
  assert.equal(core.clampVoidbirth(-3), 0);
  assert.equal(core.clampVoidbirth(0), 0);
  assert.equal(core.clampVoidbirth(5), 5);
  assert.equal(core.clampVoidbirth(99), core.MAX_VOIDBIRTH);
  assert.equal(core.clampVoidbirth(undefined), 0);
  assert.equal(core.clampVoidbirth(2.9), 2);
});

test('an out-of-range voidbirth still yields a valid 100-sum vector', () => {
  [-5, 99, 1e9].forEach(vb => {
    const w = core.rarityWeights(1, vb);
    close(sumWeights(w), 100, `vb ${vb}`);
    TIER_IDS.forEach(id => assert.ok(w[id] >= 0));
  });
});

for (let vb = 0; vb <= 5; vb++) {
  test(`rollRarity with rnd()=0 returns the floor tier at voidbirth ${vb}`, () => {
    assert.equal(core.rollRarity(1, vb, flat(0)), core.LADDER[vb].id);
    assert.equal(core.rollRarity(2500, vb, flat(0)), core.LADDER[vb].id,
      'drift must not change which tier the very bottom of the range maps to');
  });
}

test('rollRarity with rnd() just under 1 returns the deepest reachable tier', () => {
  const deepest = ['OVERCLOCKED', 'HYPERCLOCKED', 'UBERCLOCKED',
    'DYNACLOCKED', 'DYNACLOCKED', 'DYNACLOCKED'];
  deepest.forEach((id, vb) => {
    assert.equal(core.rollRarity(1, vb, flat(0.999999)), id, `voidbirth ${vb}`);
  });
});

test('rollRarity honours the tier boundaries of the cumulative distribution', () => {
  assert.equal(core.rollRarity(1, 0, flat(0.0)), 'COMMON');
  assert.equal(core.rollRarity(1, 0, flat(0.514)), 'COMMON');
  assert.equal(core.rollRarity(1, 0, flat(0.516)), 'UNCOMMON');
  assert.equal(core.rollRarity(1, 0, flat(0.784)), 'UNCOMMON');
  assert.equal(core.rollRarity(1, 0, flat(0.786)), 'RARE');
  assert.equal(core.rollRarity(1, 0, flat(0.916)), 'EPIC');
  assert.equal(core.rollRarity(1, 0, flat(0.978)), 'LEGENDARY');
  assert.equal(core.rollRarity(1, 0, flat(0.997)), 'APEX');
});

test('rollRarity always returns a tier that exists and is at or above the floor', () => {
  const rnd = makeRnd(1234);
  for (let vb = 0; vb <= 5; vb++) {
    for (let i = 0; i < 2000; i++) {
      const id = core.rollRarity(1 + (i % 400), vb, rnd);
      const idx = core.tierIndexOf(id);
      assert.ok(idx >= core.floorTierIndex(vb), `${id} is below the vb${vb} floor`);
    }
  }
});

test('APEX turns up at roughly its stated 0.30% over many rolls', () => {
  const rnd = makeRnd(20260808);
  const N = 200000;
  let apex = 0;
  for (let i = 0; i < N; i++) if (core.rollRarity(1, 0, rnd) === 'APEX') apex++;
  const pct = (apex / N) * 100;
  assert.ok(pct > 0.20 && pct < 0.42, `APEX came up ${pct}% of the time, expected ~0.30%`);
});

test('COMMON dominates at voidbirth 0 and is absent at voidbirth 1', () => {
  const rnd = makeRnd(99);
  let common = 0;
  for (let i = 0; i < 20000; i++) if (core.rollRarity(1, 0, rnd) === 'COMMON') common++;
  assert.ok(common / 20000 > 0.48 && common / 20000 < 0.55);
  for (let i = 0; i < 20000; i++) {
    assert.notEqual(core.rollRarity(1, 1, rnd), 'COMMON');
  }
});

// ---------------------------------------------------------------------------
// 4. The HP economy
// ---------------------------------------------------------------------------

const SPEC_ENEMY_HP = {
  swarmling: 8, kamikaze: 14, grunt: 20, mine: 24, weaver: 35,
  lancer: 45, elite: 60, turret: 90, bulwark: 160, harbinger: 400
};

test('the anchors of the HP economy are the spec numbers', () => {
  assert.equal(core.BASE_DAMAGE, 10, 'a base shot deals 10');
  assert.equal(core.enemyHp('grunt', 1), 20, 'a level-1 grunt is exactly two shots');
  assert.equal(core.HP_EXPONENT, 1.00);
  assert.equal(core.DAMAGE_EXPONENT, 0.92);
});

// The exponents are deliberately unequal: enemy health outruns the floor of
// your damage by level^0.08, so the deeper you go the more your build has to
// be carrying. When they were equal, relative difficulty was flat forever —
// which is exactly why the game stopped being hard.
test('enemy health outgrows the damage floor with depth', () => {
  assert.ok(core.HP_EXPONENT > core.DAMAGE_EXPONENT, 'the gap is the difficulty curve');
  let prev = 0;
  for (const lv of [10, 50, 100, 500, 2500]) {
    const hits = core.enemyHp('grunt', lv) / core.baseDamageAt(lv);
    assert.ok(hits > prev, `a grunt got relatively easier at level ${lv}`);
    prev = hits;
  }
});

// "make the game harder; but only after level 7 or so."
test('nothing below the pressure knee changes at all', () => {
  assert.equal(core.PRESSURE_KNEE, 7);
  for (let lv = 1; lv <= core.PRESSURE_KNEE; lv++) {
    assert.equal(core.pressureAt(lv), 1, `level ${lv} must be untouched`);
  }
  assert.ok(core.pressureAt(8) > 1, 'and it must start immediately after');
});

test('pressure rises for ever but never runs away', () => {
  let prev = 0;
  for (let lv = 1; lv <= 3000; lv += 7) {
    const p = core.pressureAt(lv);
    assert.ok(p >= prev, `pressure dropped at level ${lv}`);
    prev = p;
  }
  assert.ok(core.pressureAt(2500) < 6, 'the creep past the cap must stay gentle');
  assert.ok(core.pressureAt(2500) > core.PRESSURE_CAP, 'but it must not be flat either');
});

// The roster cycles past band 9, so a ship's own base HP would make level 101
// EASIER than level 100. It must not.
test('difficulty never dips where the roster wraps', () => {
  let prev = 0;
  for (let lv = 8; lv <= 3000; lv += 1) {
    const roster = core.rosterFor(lv);
    const lightest = roster.reduce((a, b) => (a.hp < b.hp ? a : b));
    const hits = core.enemyHp(lightest.id, lv) / core.baseDamageAt(lv);
    assert.ok(hits >= prev - 1e-9, `the lightest hull got easier at level ${lv}`);
    prev = hits;
  }
});

// This is the load-bearing fact of the whole expansion. A 1,000 HP first boss
// and a 1,000,000,000 HP Mothership can only both be true if the FLOOR of the
// player's damage rides the same curve enemy health does -- otherwise the
// final fight is a five-hour footrace. Your build is a multiple of the
// baseline, not a race against it.
test('the damage floor follows its own exponent', () => {
  assert.equal(core.baseDamageAt(1), core.BASE_DAMAGE);
  [1, 10, 100, 500, 2500].forEach(level => {
    close(core.baseDamageAt(level), 10 * Math.pow(level, core.DAMAGE_EXPONENT), `level ${level}`);
  });
  // The opening is still the opening: two bare shots kill a level-1 grunt.
  const shots = core.enemyHp('grunt', 1) / core.baseDamageAt(1);
  assert.ok(shots > 1.9 && shots < 2.1, `a grunt took ${shots} bare shots at level 1`);
});

test('baseDamageAt never returns less than the base shot', () => {
  [0, -10, 0.5, 1].forEach(level => {
    assert.ok(core.baseDamageAt(level) >= core.BASE_DAMAGE, `level ${level}`);
  });
});

// Nothing is deleted in a single frame, however large the multiplier stack.
test('a boss always takes at least MIN_BOSS_HITS hits', () => {
  assert.equal(core.MIN_BOSS_HITS, 14);
  const hp = 1000000;
  assert.equal(core.capDamage(1e12, hp, true), hp / 14);
  assert.equal(core.capDamage(100, hp, true), 100, 'an ordinary hit is untouched');
});

test('an enemy worth naming always takes at least two hits', () => {
  assert.equal(core.capDamage(1e9, 1000, false), 500);
  assert.equal(core.capDamage(40, 1000, false), 40);
});

test('the really weak early ones can still pop in one hit', () => {
  assert.equal(core.FRAGILE_HP, 16);
  assert.equal(core.capDamage(1e9, 8, false), 1e9, 'a level-1 swarmling is fragile');
  assert.equal(core.capDamage(1e9, 16, false), 1e9, 'the boundary is inclusive');
  assert.ok(core.capDamage(1e9, 17, false) < 1e9, 'one past it is not');
});

test('capDamage is a no-op on a target with no health', () => {
  assert.equal(core.capDamage(50, 0, true), 50);
  assert.equal(core.capDamage(50, -1, false), 50);
});

test('every enemy kind has the base HP the spec table gives it', () => {
  Object.keys(SPEC_ENEMY_HP).forEach(kind => {
    assert.equal(core.enemyHp(kind, 1), SPEC_ENEMY_HP[kind], kind);
  });
});

test('the ten legacy kinds are still resolvable — boss minions name them', () => {
  assert.deepEqual(Object.keys(core.ENEMY_HP).sort(), Object.keys(SPEC_ENEMY_HP).sort());
});

// ---- the band roster ------------------------------------------------------
// Ten bands of ten levels, each a wholly new set of ships, each one member
// larger than the band below it.

test('there are twelve bands and they grow by exactly one ship each', () => {
  assert.equal(core.ENEMY_BANDS.length, 12);
  core.ENEMY_BANDS.forEach((band, i) => {
    assert.equal(band.length, 5 + i, `band ${i} should hold ${5 + i} ships`);
  });
  assert.equal(core.ENEMY_ROSTER.length, 126);
});

test('every ship id is unique across the whole roster', () => {
  const ids = core.ENEMY_ROSTER.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length);
});

// The thing this expansion exists to prevent: 95 "different" enemies that
// are really a handful of shapes with the palette swapped.
test('no two ships anywhere in the roster share a silhouette', () => {
  const shapes = core.ENEMY_ROSTER.map(e => {
    const a = e.art;
    return [a.nose, a.body, a.wing, a.pods, a.eng, a.fin, a.cock, a.arm].join('/');
  });
  assert.equal(new Set(shapes).size, shapes.length,
    'two hulls have identical geometry — that is a recolour, not a ship');
});

test('bands share no ships with each other', () => {
  const seen = new Set();
  core.ENEMY_BANDS.forEach((band, i) => {
    band.forEach(e => {
      assert.ok(!seen.has(e.id), `${e.id} appears in band ${i} and an earlier one`);
      seen.add(e.id);
    });
  });
});

test('each band is tougher than the one below it', () => {
  for (let i = 1; i < core.ENEMY_BANDS.length; i++) {
    const lo = Math.min(...core.ENEMY_BANDS[i - 1].map(e => e.hp));
    const hi = Math.min(...core.ENEMY_BANDS[i].map(e => e.hp));
    assert.ok(hi > lo, `band ${i}'s lightest hull is not tougher than band ${i - 1}'s`);
  }
});

test('the first band is the five ships the brief names', () => {
  assert.deepEqual(core.ENEMY_BANDS[0].map(e => e.id),
    ['skiff', 'hauler', 'dart', 'picket', 'lance']);
});

test('bandIndex swaps the roster every ten levels', () => {
  assert.equal(core.bandIndex(1), 0);
  assert.equal(core.bandIndex(10), 0);
  assert.equal(core.bandIndex(11), 1);
  assert.equal(core.bandIndex(20), 1);
  assert.equal(core.bandIndex(91), 9);
  assert.equal(core.bandIndex(100), 9);
  assert.equal(core.bandIndex(101), 10, 'THE GLASS REACH');
  assert.equal(core.bandIndex(120), 11, 'THE LAST ORCHARD');
});

test('past level 100 the bands cycle rather than running out', () => {
  assert.equal(core.CYCLE_FROM, 4);
  assert.equal(core.bandIndex(121), 4, 'the cycle starts after the last band');
  assert.equal(core.bandIndex(131), 5);
  assert.equal(core.bandIndex(191), 11, 'the cycle runs up to the last band');
  assert.equal(core.bandIndex(201), 4, 'and then wraps back to CYCLE_FROM');
  for (let level = 1; level < 5000; level += 7) {
    const b = core.bandIndex(level);
    assert.ok(b >= 0 && b < core.ENEMY_BANDS.length, `level ${level} -> band ${b}`);
    assert.ok(core.rosterFor(level).length > 0);
  }
});

test('every band has a theme name and every level resolves to one', () => {
  assert.equal(core.BAND_THEMES.length, core.ENEMY_BANDS.length);
  [1, 15, 55, 99, 250, 2500].forEach(level => {
    assert.equal(typeof core.bandTheme(level), 'string');
    assert.ok(core.bandTheme(level).length > 0);
  });
});

test('enemyHp resolves every roster ship, not just the legacy ten', () => {
  core.ENEMY_ROSTER.forEach(e => {
    assert.equal(core.enemyHp(e.id, 1), e.hp, e.id);
    assert.ok(core.enemyHp(e.id, 100) > e.hp, e.id + ' at depth');
  });
});

test('a band-5 hull at level 50 is a real fight, not a popped balloon', () => {
  // The brief: by level 50 an enemy should take a serious number of hits.
  const band = core.ENEMY_BANDS[core.bandIndex(50)];
  const heavy = Math.max(...band.map(e => e.hp));
  const hits = (heavy * Math.pow(50, core.HP_EXPONENT)) / core.baseDamageAt(50);
  assert.ok(hits > 40, `the heaviest band-5 hull took only ${Math.round(hits)} bare shots`);
});

test('weights always cover the whole roster and are never zero', () => {
  [1, 12, 47, 96, 300].forEach(level => {
    const w = core.enemyWeightsFor(level);
    assert.equal(w.length, core.rosterFor(level).length, `level ${level}`);
    w.forEach(([id, weight]) => {
      assert.ok(core.ENEMY_BY_ID[id], `${id} is not in the roster`);
      assert.ok(weight > 0, `${id} had weight ${weight} at level ${level}`);
    });
  });
});

test('heavy hulls crowd in towards the end of a band', () => {
  const heaviest = core.ENEMY_BANDS[2].reduce((a, b) => (a.hp > b.hp ? a : b)).id;
  const at21 = core.enemyWeightsFor(21).find(x => x[0] === heaviest)[1];
  const at30 = core.enemyWeightsFor(30).find(x => x[0] === heaviest)[1];
  assert.ok(at30 > at21, 'the heaviest hull should be commoner late in its band');
});

test('enemyHp follows base * level * pressure at every depth', () => {
  ['grunt', 'elite', 'swarmling', 'harbinger'].forEach(kind => {
    [1, 10, 100, 500, 2500].forEach(level => {
      const want = Math.max(1, Math.round(
        SPEC_ENEMY_HP[kind] * Math.pow(level, core.HP_EXPONENT) * core.pressureAt(level)));
      assert.equal(core.enemyHp(kind, level), want, `${kind} at level ${level}`);
    });
  });
});

test('the level-2500 grunt is far past the level-1 one but not absurd', () => {
  assert.ok(core.enemyHp('grunt', 2500) > 100000);
  assert.ok(core.enemyHp('grunt', 2500) < 500000);
});

test('enemyHp is monotonically increasing in level for every kind', () => {
  Object.keys(core.ENEMY_HP).forEach(kind => {
    let prev = 0;
    for (let level = 1; level <= 600; level++) {
      const hp = core.enemyHp(kind, level);
      assert.ok(hp >= prev, `${kind} HP dropped at level ${level}`);
      prev = hp;
    }
  });
});

test('enemyHp keeps the relative ordering of the roster at every level', () => {
  const order = Object.keys(SPEC_ENEMY_HP).sort((a, b) => SPEC_ENEMY_HP[a] - SPEC_ENEMY_HP[b]);
  [1, 30, 300, 2500].forEach(level => {
    for (let i = 1; i < order.length; i++) {
      assert.ok(core.enemyHp(order[i], level) >= core.enemyHp(order[i - 1], level),
        `${order[i]} fell below ${order[i - 1]} at level ${level}`);
    }
  });
});

test('enemyHp never returns less than 1 and never returns a fraction', () => {
  Object.keys(core.ENEMY_HP).forEach(kind => {
    [0, -5, 0.5, 1].forEach(level => {
      const hp = core.enemyHp(kind, level);
      assert.ok(hp >= 1, `${kind} at level ${level}`);
      assert.equal(hp, Math.round(hp));
    });
  });
});

test('enemyHp throws on an unknown kind rather than returning NaN', () => {
  assert.throws(() => core.enemyHp('dreadnought', 10), /unknown kind/);
  assert.throws(() => core.enemyHp(undefined, 10), /unknown kind/);
  assert.throws(() => core.enemyHp('', 1), /unknown kind/);
});

test('enemyScale starts just above 1 and grows with level', () => {
  close(core.enemyScale(1), 1 + 1 / 11);
  assert.ok(core.enemyScale(1) > 1 && core.enemyScale(1) < 1.12);
  assert.ok(core.enemyScale(100) > core.enemyScale(10));
  assert.ok(core.enemyScale(2000) > core.enemyScale(100));
});

test('enemyScale matches the formula 1 + level^0.35 / 11', () => {
  [1, 10, 100, 500, 2000].forEach(level => {
    close(core.enemyScale(level), 1 + Math.pow(level, 0.35) / 11, `level ${level}`);
  });
});

// The divisor exists to make the cap reachable in play. At 22 the curve only
// reached 1.70x at the level-2500 Mothership and would not have touched 2.4x
// until past level 17,000 — a size curve no player would ever see.
test('enemy growth is actually visible across the playable range', () => {
  assert.ok(core.enemyScale(100) > 1.4, 'a level-100 enemy is noticeably bigger');
  assert.ok(core.enemyScale(2500) > 2.3, 'by the Mothership they are near the cap');
});

test('enemyScale never exceeds the 2.4x cap', () => {
  assert.equal(core.ENEMY_SCALE_CAP, 2.4);
  for (const level of [1, 100, 2500, 1e6, 1e12]) {
    assert.ok(core.enemyScale(level) <= 2.4, `level ${level}`);
  }
  assert.equal(core.enemyScale(1e12), 2.4, 'the cap must actually bind somewhere');
});

test('enemyScale is monotonically non-decreasing', () => {
  let prev = 0;
  for (let level = 1; level <= 5000; level += 3) {
    const s = core.enemyScale(level);
    assert.ok(s >= prev, `scale dropped at level ${level}`);
    prev = s;
  }
});

test('every meteorite class carries a payload, a weight and a behaviour', () => {
  assert.equal(core.METEORS.length, 13);
  const drops = ['scrap', 'shield', 'life', 'rage', 'freeze'];
  core.METEORS.forEach(m => {
    assert.ok(m.behaviour.length > 0, `${m.id} needs a behaviour`);
    assert.ok(drops.indexOf(m.drop) !== -1, `${m.id} drops "${m.drop}", which is not a pickup`);
    assert.ok(m.drops >= 1, `${m.id} drops nothing`);
    assert.ok(m.weight > 0, `${m.id} can never be rolled`);
    assert.equal(m.col.length, 3, `${m.id} needs three hull colours`);
  });
  assert.equal(new Set(core.METEORS.map(m => m.id)).size, 13, 'ids must be unique');
});

test('meteorite classes phase in as you descend, cheapest first', () => {
  for (let i = 1; i < core.METEORS.length; i++) {
    assert.ok(core.METEORS[i].from > core.METEORS[i - 1].from, 'the table must be ordered by depth');
    assert.ok(core.METEORS[i].hp > core.METEORS[i - 1].hp, 'and get tougher with it');
  }
  assert.equal(core.METEORS[0].from, 1, 'something must be available on level 1');
});

test('rollMeteor only ever returns a class the level has reached', () => {
  const rnd = makeRnd(7);
  [1, 5, 30, 150, 900].forEach(level => {
    const allowed = new Set(core.meteorsFor(level).map(m => m.id));
    for (let i = 0; i < 400; i++) {
      assert.ok(allowed.has(core.rollMeteor(level, rnd).id), `level ${level}`);
    }
  });
});

test('rollMeteor survives the boundaries of the random range', () => {
  assert.ok(core.rollMeteor(1, () => 0).id);
  assert.ok(core.rollMeteor(1, () => 0.999999).id);
  assert.ok(core.rollMeteor(0, () => 0.5).id, 'even below level 1 it returns something');
});

test('meteor health rides the same depth curve as everything else', () => {
  assert.ok(core.meteorHp('ice', 100) > core.meteorHp('ice', 1));
  assert.ok(core.meteorHp('shard', 300) > core.meteorHp('ice', 300));
  assert.throws(() => core.meteorHp('cheese', 1), /unknown meteor/);
});

test('meteorsFor only ever offers classes the level has reached', () => {
  assert.deepEqual(core.meteorsFor(1).map(m => m.id), ['ice']);
  assert.deepEqual(core.meteorsFor(5).map(m => m.id), ['ice']);
  assert.deepEqual(core.meteorsFor(6).map(m => m.id), ['ice', 'iron']);
  assert.equal(core.meteorsFor(1000).length, 13);
  assert.equal(core.meteorsFor(0).length, 0);
});

// ---------------------------------------------------------------------------
// 5. The boss table
// ---------------------------------------------------------------------------

// Health follows hp = 1000 * (level/10)^2.5, fitted to the two fixed points
// the brief gives: 1,000 for the first boss and 1,000,000,000 for the
// Mothership. The ORDER is also load-bearing -- both shield-mechanic fights
// sit past level 100.
const SPEC_BOSSES = [
  [10, 'MAGNETAR', 30000, 3], [20, 'RUSTFALL', 148000, 3], [30, 'TRIAD', 377000, 3],
  [40, 'THE LONG SILENCE', 731000, 4], [50, 'MIRRORGATE', 1200000, 4],
  [75, 'THE WIDOW', 3100000, 4], [100, 'PLASMA REVOLUTION', 6000000, 5],
  [150, 'SEVEN ANGLES', 15300000, 5], [200, 'HALO WARDEN', 29700000, 3],
  [250, 'SCRAPJAW TITAN', 49700000, 2], [300, 'HIVE EMPRESS', 75700000, 4],
  [350, 'THE CARTOGRAPHER', 107900000, 4], [400, 'NULLPOINT', 146800000, 4],
  [500, 'ASHEN CHOIRMASTER', 245400000, 5], [750, 'THE THRESHOLD', 624300000, 5],
  [1000, 'PALE HERALD', 1210900000, 5], [1500, 'IRON LITANY', 3080800000, 6],
  [2500, 'THE DREADED SCOURGE OF HUMANITY — WARR MOTHERSHIP', 10000000000, 7]
];

// The two shield fights are HALO WARDEN's rotating ring and SCRAPJAW's
// armour plates. Neither belongs in the first hundred levels, where the
// player has no build capable of breaking one quickly.
const SHIELD_BOSSES = ['halowarden', 'scrapjaw'];

test('there are eighteen hand-built bosses', () => {
  assert.equal(core.BOSS_TABLE.length, 18);
});

test('boss levels match the spec, in order and strictly increasing', () => {
  assert.deepEqual(core.BOSS_TABLE.map(b => b.level), SPEC_BOSSES.map(s => s[0]));
  for (let i = 1; i < core.BOSS_TABLE.length; i++) {
    assert.ok(core.BOSS_TABLE[i].level > core.BOSS_TABLE[i - 1].level);
  }
});

test('boss names match the spec table', () => {
  assert.deepEqual(core.BOSS_TABLE.map(b => b.name), SPEC_BOSSES.map(s => s[1]));
});

test('boss HP matches the spec table exactly', () => {
  SPEC_BOSSES.forEach(([level, name, hp]) => {
    const b = core.BOSS_TABLE.find(x => x.level === level);
    assert.equal(b.hp, hp, `${name} at level ${level}`);
  });
});

test('boss HP is strictly increasing up the table', () => {
  for (let i = 1; i < core.BOSS_TABLE.length; i++) {
    assert.ok(core.BOSS_TABLE[i].hp > core.BOSS_TABLE[i - 1].hp,
      `${core.BOSS_TABLE[i].name} is not tougher than ${core.BOSS_TABLE[i - 1].name}`);
  }
});

test('the level-2500 Mothership is exactly 10,000,000,000 HP — the anchor of the curve', () => {
  const m = core.BOSS_TABLE.find(b => b.level === 2500);
  assert.equal(m.hp, 10000000000);
  assert.equal(m.key, 'mothership');
  assert.equal(m.phases, 7);
});

// Raised from 1,000: a bare ship killed that in about a second and any real
// build in a third of one, which is a speed bump rather than a boss.
test('the first boss is exactly 30,000 HP — the other anchor', () => {
  const first = core.BOSS_TABLE[0];
  assert.equal(first.level, 10);
  assert.equal(first.hp, 30000);
  assert.equal(core.BOSS_HP_BASE, 30000);
});

// PLASMA REVOLUTION is the seventh fight, and the only one that restricts
// where the player may stand.
test('PLASMA REVOLUTION is the seventh boss', () => {
  assert.equal(core.BOSS_TABLE[6].key, 'plasma');
  assert.equal(core.BOSS_TABLE[6].name, 'PLASMA REVOLUTION');
  assert.equal(core.BOSS_TABLE[6].level, 100);
});

test('TRIAD is the level-30 fight', () => {
  const t = core.BOSS_TABLE.find(b => b.key === 'choir');
  assert.equal(t.level, 30);
  assert.equal(t.name, 'TRIAD');
});

test('boss health is strictly increasing down the table', () => {
  for (let i = 1; i < core.BOSS_TABLE.length; i++) {
    assert.ok(core.BOSS_TABLE[i].hp > core.BOSS_TABLE[i - 1].hp,
      `${core.BOSS_TABLE[i].name} is not tougher than ${core.BOSS_TABLE[i - 1].name}`);
    assert.ok(core.BOSS_TABLE[i].level > core.BOSS_TABLE[i - 1].level, 'and deeper');
  }
});

// Both damage-blocking fights belong past level 100. Before that the player
// has no build capable of breaking a shield in reasonable time, and "why is
// nothing happening" is the worst thing a first boss can teach.
test('no shield boss appears in the first hundred levels', () => {
  SHIELD_BOSSES.forEach(key => {
    const b = core.BOSS_TABLE.find(x => x.key === key);
    assert.ok(b, `${key} is missing from the table`);
    assert.ok(b.level > 100, `${b.name} sits at level ${b.level}`);
  });
});

test('no boss name contains the word void', () => {
  core.BOSS_TABLE.forEach(b => {
    assert.ok(!/void/i.test(b.name), `${b.name} still says "void"`);
  });
});

test('boss phase counts match the spec', () => {
  SPEC_BOSSES.forEach(([level, name, , phases]) => {
    assert.equal(core.BOSS_TABLE.find(b => b.level === level).phases, phases, name);
  });
});

test('every boss key is unique — they select distinct code paths', () => {
  const keys = core.BOSS_TABLE.map(b => b.key);
  assert.equal(new Set(keys).size, keys.length, `duplicate boss key in ${keys.join(', ')}`);
});

test('every boss has a non-empty name', () => {
  core.BOSS_TABLE.forEach(b => {
    assert.equal(typeof b.name, 'string');
    assert.ok(b.name.trim().length > 0, `boss at level ${b.level} has no name`);
  });
});

test('every boss has a non-empty mechanic, and no two share one', () => {
  core.BOSS_TABLE.forEach(b => {
    assert.equal(typeof b.mechanic, 'string');
    assert.ok(b.mechanic.trim().length > 0, `${b.name} has no mechanic`);
  });
  const m = core.BOSS_TABLE.map(b => b.mechanic);
  assert.equal(new Set(m).size, m.length, 'two bosses share a mechanic — they are recolours');
});

test('every boss has at least two phases', () => {
  core.BOSS_TABLE.forEach(b => {
    assert.ok(b.phases >= 2, `${b.name} has ${b.phases} phases`);
    assert.equal(b.phases, Math.round(b.phases));
  });
});

test('isBossLevel is true for every level in the table', () => {
  core.BOSS_TABLE.forEach(b => {
    assert.equal(core.isBossLevel(b.level), true, `level ${b.level} (${b.name})`);
  });
});

test('isBossLevel is true for the ARMADA levels past 1000', () => {
  [1100, 1200, 1700, 2400, 2600, 3000, 10000].forEach(level => {
    assert.equal(core.isBossLevel(level), true, `level ${level}`);
  });
});

test('isBossLevel is false for ordinary levels', () => {
  [1, 9, 11, 51, 1050, 99, 101, 999, 1001, 2499, 2501].forEach(level => {
    assert.equal(core.isBossLevel(level), false, `level ${level}`);
  });
});

test('isBossLevel rejects zero and negative levels', () => {
  assert.equal(core.isBossLevel(0), false);
  assert.equal(core.isBossLevel(-100), false);
  assert.equal(core.isBossLevel(undefined), false);
});

test('the hundreds below 1000 are not accidentally boss levels', () => {
  [600, 700, 800, 900].forEach(level => {
    assert.equal(core.isBossLevel(level), false,
      `level ${level} is not in the table and the every-100 rule only starts past 1000`);
  });
});

test('bossFor returns a fight for every boss level and null for every other', () => {
  for (let level = 1; level <= 3000; level++) {
    const b = core.bossFor(level);
    if (core.isBossLevel(level)) {
      assert.notEqual(b, null, `no boss for boss level ${level}`);
      assert.equal(b.level, level);
      assert.ok(b.hp > 0);
      assert.ok(b.name.length > 0);
      assert.ok(b.phases >= 2);
    } else {
      assert.equal(b, null, `level ${level} produced a boss it should not have`);
    }
  }
});

test('bossFor returns the hand-built entry verbatim on table levels', () => {
  core.BOSS_TABLE.forEach(b => {
    assert.equal(core.bossFor(b.level), b, `${b.name} should be the table object itself`);
  });
});

test('bossFor between 1100 and 2400 returns an ARMADA composite of two earlier bosses', () => {
  for (let level = 1100; level <= 2400; level += 100) {
    const b = core.bossFor(level);
    // 1500 is IRON LITANY: a hand-built boss inside the ARMADA stretch, and
    // the table has to win over the every-100 rule.
    if (core.BOSS_TABLE.some(x => x.level === level)) {
      assert.notEqual(b.key, 'armada', `level ${level} is a hand-built fight`);
      continue;
    }
    assert.equal(b.key, 'armada', `level ${level}`);
    assert.match(b.name, /^WARR ARMADA — /, `level ${level} name`);
    assert.ok(Array.isArray(b.composite) && b.composite.length === 2, `level ${level} composite`);
    b.composite.forEach(k => {
      const src = core.BOSS_TABLE.find(x => x.key === k);
      assert.notEqual(src, undefined, `composite key ${k} is not a real boss`);
      assert.ok(src.level <= 1000, 'ARMADA escorts composite bosses from level 1000 and below');
    });
  }
});

test('an ARMADA escort takes its HP from the fitted curve, not a second disagreeing one', () => {
  for (let level = 1100; level <= 2400; level += 100) {
    assert.equal(core.bossFor(level).hp, core.fittedBossHp(level), `level ${level}`);
  }
});

test('ARMADA HP sits between IRON LITANY and the Mothership', () => {
  const litany = core.BOSS_TABLE.find(b => b.level === 1000).hp;
  for (let level = 1100; level <= 2400; level += 100) {
    const hp = core.bossFor(level).hp;
    assert.ok(hp > litany, `level ${level} is easier than IRON LITANY`);
    assert.ok(hp < 10000000000, `level ${level} outguns the Mothership`);
  }
});

test('ARMADA HP rises strictly across the 1100-2400 stretch', () => {
  let prev = core.BOSS_TABLE.find(b => b.level === 1000).hp;
  for (let level = 1100; level <= 2400; level += 100) {
    const hp = core.bossFor(level).hp;
    assert.ok(hp > prev, `level ${level} (${hp}) is not tougher than the fight before it (${prev})`);
    prev = hp;
  }
});

test('past 2500 the Mothership returns scaled up and with another phase', () => {
  const base = core.BOSS_TABLE.find(b => b.level === 2500);
  const b26 = core.bossFor(2600);
  assert.equal(b26.key, 'mothership');
  assert.equal(b26.ascendant, 1);
  assert.equal(b26.hp, Math.round(base.hp * 1.6));
  assert.equal(b26.phases, base.phases + 1);
  assert.match(b26.name, /SCOURGE ASCENDANT ×1/);

  const b30 = core.bossFor(3000);
  assert.equal(b30.ascendant, 5);
  assert.equal(b30.hp, Math.round(base.hp * Math.pow(1.6, 5)));
  assert.equal(b30.phases, base.phases + 5);
});

test('the ascendant phase count is capped at twelve', () => {
  assert.equal(core.bossFor(3200).phases, 12);
  assert.equal(core.bossFor(10000).phases, 12);
  assert.ok(core.bossFor(10000).hp > core.bossFor(3200).hp,
    'the cap is on phases, not on HP — the summit keeps rising');
});

test('every boss level from 1000 up is at least as tough as the one before', () => {
  let prev = 0;
  for (let level = 10; level <= 4000; level++) {
    if (!core.isBossLevel(level)) continue;
    const hp = core.bossFor(level).hp;
    assert.ok(hp > prev, `boss at level ${level} (${hp}) is weaker than the previous boss (${prev})`);
    prev = hp;
  }
});

test('fittedBossHp is monotonically non-decreasing', () => {
  let prev = -1;
  for (let level = 1; level <= 3000; level++) {
    const hp = core.fittedBossHp(level);
    assert.ok(hp >= prev, `fittedBossHp dropped at level ${level}`);
    prev = hp;
  }
});

test('fittedBossHp lands near the hand-set numbers it was fitted from', () => {
  assert.equal(core.BOSS_HP_BASE, 30000);
  assert.equal(core.BOSS_HP_EXPONENT, 2.303);
  [[100, 6000000], [500, 245400000], [1000, 1210900000], [2500, 10000000000]].forEach(([level, actual]) => {
    const fit = core.fittedBossHp(level);
    assert.ok(Math.abs(fit - actual) / actual < 0.35,
      `fitted ${fit} is nowhere near the hand-set ${actual} at level ${level}`);
  });
});

test('fittedBossHp rounds to progressively coarser steps as the numbers grow', () => {
  assert.equal(core.fittedBossHp(5) % 100, 0);
  assert.equal(core.fittedBossHp(200) % 1000, 0);
  assert.equal(core.fittedBossHp(2000) % 100000, 0);
});

test('bossHp mirrors bossFor and is 0 where there is no boss', () => {
  core.BOSS_TABLE.forEach(b => assert.equal(core.bossHp(b.level), b.hp));
  assert.equal(core.bossHp(1100), core.bossFor(1100).hp);
  assert.equal(core.bossHp(11), 0);
  assert.equal(core.bossHp(1), 0);
});

test('nextBossLevel points at the next hand-built boss below level 1000', () => {
  assert.equal(core.nextBossLevel(1), 10);
  assert.equal(core.nextBossLevel(9), 10);
  assert.equal(core.nextBossLevel(10), 20);
  assert.equal(core.nextBossLevel(55), 75);
  assert.equal(core.nextBossLevel(500), 750);
  assert.equal(core.nextBossLevel(750), 1000);
});

test('nextBossLevel keeps the every-100 rhythm past the Mothership', () => {
  assert.equal(core.nextBossLevel(2500), 2600);
  assert.equal(core.nextBossLevel(2650), 2700);
  assert.equal(core.nextBossLevel(3000), 3100);
});

test('the ARMADA interval is 100 levels', () => {
  assert.equal(core.ARMADA_INTERVAL, 100);
});

// ---------------------------------------------------------------------------
// 6. Shop cadence
// ---------------------------------------------------------------------------

// Two rules that sound contradictory and are not: a voidbirth must never
// change the cadence, AND the cadence is every second level rather than every
// level. Levels are half as long as they were, so a shop after every one meant
// docking five times a minute.
test('the shop cadence is fixed, and depth never changes it', () => {
  // The exact number has moved twice; what must never move is that it is the
  // SAME number at every depth. Asserted against the constant so a retune
  // cannot silently reintroduce the voidbirth debuff.
  assert.equal(core.SHOP_EVERY, 4);
  for (let vb = 0; vb <= 8; vb++) {
    assert.equal(core.shopEvery(vb), core.SHOP_EVERY, `voidbirth ${vb}`);
  }
  // The same pattern at every depth is the property that matters most here.
  const at0 = [];
  for (let level = 1; level < 40; level++) at0.push(core.shopOpensAfter(level, 0));
  for (let vb = 1; vb <= 8; vb++) {
    for (let level = 1; level < 40; level++) {
      assert.equal(core.shopOpensAfter(level, vb), at0[level - 1],
        `level ${level} differs at voidbirth ${vb}`);
    }
  }
});

test('only every SHOP_EVERY-th ordinary level opens a shop', () => {
  // Levels 1..8 are clear of the level-10 boss, so the cadence is the only
  // thing deciding here.
  for (let level = 1; level <= 8; level++) {
    assert.equal(core.shopOpensAfter(level, 0), level % core.SHOP_EVERY === 0,
      `level ${level}`);
  }
});






test('a shop always opens before a boss', () => {
  // Shops open every level now, so this is a weaker claim than it was — but
  // it is the one that must never stop holding.
  core.BOSS_TABLE.forEach(b => {
    for (let vb = 0; vb <= 5; vb++) {
      assert.equal(core.shopOpensAfter(b.level - 1, vb), true,
        `no shop before ${b.name} at voidbirth ${vb}`);
    }
  });
});

test('every boss in the game is preceded by a shop at every voidbirth depth', () => {
  const bossLevels = core.BOSS_TABLE.map(b => b.level).concat([1100, 1500, 2400, 2600]);
  bossLevels.forEach(level => {
    for (let vb = 0; vb <= 5; vb++) {
      assert.equal(core.shopOpensAfter(level - 1, vb), true,
        `no shop before the level-${level} boss at voidbirth ${vb}`);
    }
  });
});

test('outside the pre-boss exception the cadence is followed to the letter', () => {
  for (let vb = 0; vb <= 5; vb++) {
    const every = core.shopEvery(vb);
    for (let level = 1; level <= 300; level++) {
      if (core.isBossLevel(level + 1)) continue;
      assert.equal(core.shopOpensAfter(level, vb), level % every === 0,
        `level ${level} at voidbirth ${vb}`);
    }
  }
});

test('shops thin out as you ascend — never more frequent at greater depth', () => {
  for (let vb = 1; vb <= 5; vb++) {
    assert.ok(core.shopEvery(vb) >= core.shopEvery(vb - 1),
      `voidbirth ${vb} shops more often than voidbirth ${vb - 1}`);
  }
});

// ---------------------------------------------------------------------------
// 7. Voidbirth
// ---------------------------------------------------------------------------

// Ascension is no longer five fixed levels. The first one is handed to you
// the moment the level-50 boss dies, and after that EVERY boss is an
// ascension point -- the ladder is climbed by beating things.
test('the first ascension is the level-50 boss, and it is a boss level', () => {
  assert.equal(core.FIRST_VOIDBIRTH_LEVEL, 50);
  assert.equal(core.MAX_VOIDBIRTH, 5);
  assert.equal(core.isBossLevel(50), true, 'level 50 must be a boss level');
  assert.equal(core.isVoidbirthLevel(50), true);
});

test('every boss from 50 up is an ascension point', () => {
  core.BOSS_TABLE.filter(b => b.level >= 50).forEach(b => {
    assert.equal(core.isVoidbirthLevel(b.level), true, `level ${b.level} (${b.name})`);
  });
});

test('nothing below level 50 is an ascension point, boss or not', () => {
  [1, 10, 20, 30, 40, 49].forEach(level => {
    assert.equal(core.isVoidbirthLevel(level), false, `level ${level}`);
  });
});

test('an ordinary level is never an ascension point', () => {
  [1, 11, 49, 51, 99, 101, 251, 501, 1001, 2499].forEach(level => {
    assert.equal(core.isVoidbirthLevel(level), core.isBossLevel(level) && level >= 50,
      `level ${level}`);
  });
});

test('clearing any qualifying boss grants the next ascension', () => {
  [50, 75, 100, 150, 250, 500, 1000, 2500].forEach(level => {
    for (let vb = 0; vb < core.MAX_VOIDBIRTH; vb++) {
      const vbirth = core.voidbirthAfterClearing(level, vb);
      assert.notEqual(vbirth, null, `level ${level} at depth ${vb}`);
      assert.equal(vbirth.to, vb + 1);
      assert.equal(vbirth.numeral, core.ROMAN[vb]);
    }
  });
});

test('a sliver of the treasury survives an ascension', () => {
  assert.equal(core.VOIDBIRTH_SCRAP_KEPT, 0.05);
  assert.equal(core.scrapAfterVoidbirth(10000), 500);
  assert.equal(core.scrapAfterVoidbirth(19), 0, 'rounds down');
  assert.equal(core.scrapAfterVoidbirth(0), 0);
  assert.equal(core.scrapAfterVoidbirth(-100), 0, 'never negative');
});

test('the roman numerals run I to V', () => {
  assert.deepEqual(core.ROMAN, ['I', 'II', 'III', 'IV', 'V']);
});

test('the ladder tops out — a sixth ascension is never granted', () => {
  [50, 100, 500, 2500].forEach(level => {
    assert.equal(core.voidbirthAfterClearing(level, core.MAX_VOIDBIRTH), null, `level ${level}`);
    assert.equal(core.voidbirthAfterClearing(level, 99), null, 'nor past it');
  });
});

test('an ascension always advances by exactly one, never skips', () => {
  for (let vb = 0; vb < core.MAX_VOIDBIRTH; vb++) {
    assert.equal(core.voidbirthAfterClearing(2500, vb).to, vb + 1,
      'a very deep boss must not grant more than one rung');
  }
});

test('ordinary levels never grant an ascension', () => {
  [1, 49, 51, 99, 101, 199, 351, 501, 1001, 2499].forEach(level => {
    for (let vb = 0; vb <= 5; vb++) {
      assert.equal(core.voidbirthAfterClearing(level, vb), null, `level ${level} vb ${vb}`);
    }
  });
});

test('each ascension reports the tier it newly unlocks', () => {
  assert.equal(core.voidbirthAfterClearing(50, 0).unlocks, 'HYPERCLOCKED');
  assert.equal(core.voidbirthAfterClearing(75, 1).unlocks, 'UBERCLOCKED');
  assert.equal(core.voidbirthAfterClearing(100, 2).unlocks, 'DYNACLOCKED');
  assert.equal(core.voidbirthAfterClearing(150, 3).unlocks, null, 'there is nothing above DYNACLOCKED');
  assert.equal(core.voidbirthAfterClearing(200, 4).unlocks, null);
});

test('tierUnlockedAt returns the three locked tiers at depths 1, 2 and 3', () => {
  assert.equal(core.tierUnlockedAt(1), 'HYPERCLOCKED');
  assert.equal(core.tierUnlockedAt(2), 'UBERCLOCKED');
  assert.equal(core.tierUnlockedAt(3), 'DYNACLOCKED');
});

test('tierUnlockedAt returns OVERCLOCKED at depth 0 and null past the top', () => {
  assert.equal(core.tierUnlockedAt(0), 'OVERCLOCKED', 'OVERCLOCKED is reachable from the start');
  assert.equal(core.tierUnlockedAt(4), null);
  assert.equal(core.tierUnlockedAt(5), null);
  assert.equal(core.tierUnlockedAt(99), null);
});

test('the tier a voidbirth unlocks was genuinely unreachable the depth before', () => {
  for (let vb = 1; vb <= 3; vb++) {
    const id = core.tierUnlockedAt(vb);
    assert.equal(core.tierReachable(id, vb - 1), false, `${id} was reachable at depth ${vb - 1}`);
    assert.equal(core.tierReachable(id, vb), true, `${id} is not reachable at depth ${vb}`);
  }
});

test('tierReachable agrees with the weight vector for every tier and depth', () => {
  for (let vb = 0; vb <= 5; vb++) {
    const w = core.rarityWeights(1, vb);
    TIER_IDS.forEach(id => assert.equal(core.tierReachable(id, vb), w[id] > 0, `${id} vb ${vb}`));
  }
});

// ---------------------------------------------------------------------------
// 8. Upgrades
// ---------------------------------------------------------------------------

test('every upgrade id is unique', () => {
  const ids = core.UPGRADES.map(u => u.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate upgrade id');
});

test('every upgrade sits on a tier that actually exists', () => {
  core.UPGRADES.forEach(u => {
    assert.doesNotThrow(() => core.tierIndexOf(u.tier), `${u.id} has tier ${u.tier}`);
  });
});

test('every upgrade has a non-empty name and description', () => {
  core.UPGRADES.forEach(u => {
    assert.equal(typeof u.name, 'string');
    assert.ok(u.name.trim().length > 0, `${u.id} has no name`);
    assert.equal(typeof u.desc, 'string');
    assert.ok(u.desc.trim().length > 0, `${u.id} has no description`);
  });
});

test('every upgrade has a non-empty effect object', () => {
  core.UPGRADES.forEach(u => {
    assert.equal(typeof u.effect, 'object');
    assert.notEqual(u.effect, null, `${u.id} effect is null`);
    assert.ok(Object.keys(u.effect).length > 0, `${u.id} does nothing`);
  });
});

test('every effect value is a number or a boolean, never a string or undefined', () => {
  core.UPGRADES.forEach(u => {
    Object.keys(u.effect).forEach(k => {
      const t = typeof u.effect[k];
      assert.ok(t === 'number' || t === 'boolean', `${u.id}.${k} is a ${t}`);
      if (t === 'number') assert.ok(Number.isFinite(u.effect[k]), `${u.id}.${k} is not finite`);
    });
  });
});

test('every tier of the ladder has upgrades on it', () => {
  TIER_IDS.forEach(id => {
    const n = core.UPGRADES.filter(u => u.tier === id).length;
    assert.ok(n > 0, `no upgrades at tier ${id}`);
  });
});

test('the catalogue is skewed toward the cheap tiers, as a shop economy needs', () => {
  const count = id => core.UPGRADES.filter(u => u.tier === id).length;
  assert.ok(count('COMMON') >= count('LEGENDARY'));
  assert.ok(count('UNCOMMON') >= count('MYTHIC'));
  assert.ok(count('RARE') >= count('DYNACLOCKED'));
});

test('byId finds every catalogue entry and returns null for anything else', () => {
  core.UPGRADES.forEach(u => assert.equal(core.byId(u.id), u));
  assert.equal(core.byId('no_such_upgrade'), null);
  assert.equal(core.byId(undefined), null);
});

test('LINEAGE_GROWTH is 2.2', () => {
  assert.equal(core.LINEAGE_GROWTH, 2.5);
});

test('effectiveTier climbs one rung per voidbirth', () => {
  core.UPGRADES.forEach(u => {
    const base = core.tierIndexOf(u.tier);
    for (let vb = 0; vb <= 5; vb++) {
      if (u.tier === 'SECRET') {
        assert.equal(core.effectiveTier(u, vb), 'SECRET', `${u.id} must never climb`);
        continue;
      }
      const want = core.LADDER[Math.min(core.MAX_TIER_INDEX, base + vb)].id;
      assert.equal(core.effectiveTier(u, vb), want, `${u.id} at voidbirth ${vb}`);
    }
  });
});

test('effectiveTier clamps at DYNACLOCKED and never falls off the top', () => {
  const apex = core.byId('twin_core');
  assert.equal(core.effectiveTier(apex, 4), 'DYNACLOCKED');
  assert.equal(core.effectiveTier(apex, 5), 'DYNACLOCKED');
  assert.equal(core.effectiveTier(core.byId('dc_apotheosis'), 5), 'DYNACLOCKED');
  assert.equal(core.effectiveTier(core.byId('dc_undying'), 99), 'DYNACLOCKED');
});

test('an out-of-range voidbirth is clamped to MAX_VOIDBIRTH, not run off the ladder', () => {
  // clampVoidbirth binds first, so depth 99 promotes exactly as far as depth 5.
  core.UPGRADES.forEach(u => {
    assert.equal(core.effectiveTier(u, 99), core.effectiveTier(u, core.MAX_VOIDBIRTH), u.id);
    assert.equal(core.effectiveName(u, 99), core.effectiveName(u, core.MAX_VOIDBIRTH), u.id);
  });
  assert.equal(core.effectiveTier(core.byId('reload_coil'), 99), 'MYTHIC');
});

test('a COMMON reaches every rung of the ladder as depth increases', () => {
  const seen = [0, 1, 2, 3, 4, 5].map(vb => core.effectiveTier(core.byId('reload_coil'), vb));
  assert.deepEqual(seen, ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC']);
});

test('effectiveName walks the lineage, one name per voidbirth depth', () => {
  const u = core.byId('reload_coil');
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(vb => core.effectiveName(u, vb)),
    ['RELOAD COIL', 'RELOAD ARRAY', 'RELOAD LATTICE', 'RELOAD CASCADE',
      'RELOAD SINGULARITY', 'CHRONOSTALL']);
});

test('the spec lineages named in the design doc are all present and correct at the ends', () => {
  const ends = {
    reload_coil: ['RELOAD COIL', 'CHRONOSTALL'],
    heavy_rounds: ['HEAVY ROUNDS', 'KINETIC VERDICT'],
    plating: ['PLATING', 'THE UNBROKEN'],
    scrap_magnet: ['SCRAP MAGNET', 'MIDAS FIELD'],
    tight_barrel: ['TIGHT BARREL', 'THE NEEDLE']
  };
  Object.keys(ends).forEach(id => {
    const u = core.byId(id);
    assert.notEqual(u, null, `${id} is missing from the catalogue`);
    assert.equal(core.effectiveName(u, 0), ends[id][0]);
    assert.equal(core.effectiveName(u, 5), ends[id][1]);
  });
});

test('every lineage array is long enough to cover voidbirth 0 through 5', () => {
  const lines = core.UPGRADES.filter(u => u.line);
  assert.ok(lines.length > 0, 'there are no lineages at all');
  lines.forEach(u => {
    assert.ok(u.line.length >= core.MAX_VOIDBIRTH + 1,
      `${u.id} lineage has ${u.line.length} names, needs ${core.MAX_VOIDBIRTH + 1}`);
    u.line.forEach((n, i) => {
      assert.equal(typeof n, 'string');
      assert.ok(n.trim().length > 0, `${u.id} lineage step ${i} is blank`);
    });
  });
});

test('no lineage repeats a name — every step must read as a promotion', () => {
  core.UPGRADES.filter(u => u.line).forEach(u => {
    assert.equal(new Set(u.line).size, u.line.length, `${u.id} repeats a lineage name`);
  });
});

test('a lineage starts at the upgrade its own name gives', () => {
  core.UPGRADES.filter(u => u.line).forEach(u => {
    assert.equal(u.line[0], u.name, `${u.id} lineage does not start at its own name`);
  });
});

test('effectiveName falls back to the base name when there is no lineage', () => {
  // Found rather than hardcoded: which upgrades carry a lineage changes as the
  // catalogue grows, and a test that names one becomes a maintenance trap.
  const plain = core.UPGRADES.filter(u => !u.line);
  assert.ok(plain.length, 'the catalogue should still contain un-lineaged upgrades');
  plain.forEach(u => {
    for (let vb = 0; vb <= 5; vb++) {
      assert.equal(core.effectiveName(u, vb), u.name, `${u.id} at voidbirth ${vb}`);
    }
  });
});

test('effectiveName never returns blank for any upgrade at any depth', () => {
  core.UPGRADES.forEach(u => {
    for (let vb = 0; vb <= 5; vb++) {
      const n = core.effectiveName(u, vb);
      assert.equal(typeof n, 'string');
      assert.ok(n.trim().length > 0, `${u.id} has no name at voidbirth ${vb}`);
    }
  });
});

test('effectiveEffect scales numbers by LINEAGE_GROWTH^voidbirth', () => {
  const u = core.byId('heavy_rounds');
  for (let vb = 0; vb <= 5; vb++) {
    const want = Math.round(0.06 * Math.pow(core.LINEAGE_GROWTH, vb) * 100) / 100;
    assert.equal(core.effectiveEffect(u, vb).damageMul, want, `voidbirth ${vb}`);
  }
});

test('RELOAD COIL grows into a genuinely different upgrade, as the spec promises', () => {
  const u = core.byId('reload_coil');
  assert.equal(core.effectiveEffect(u, 0).fireRateMul, 0.05);
  // LINEAGE_GROWTH is 2.5 now, raised alongside the boss curve so the deepest
  // fights stay finishable. Asserted against the constant rather than a frozen
  // literal, so the relationship is what is under test.
  const g = core.LINEAGE_GROWTH;
  assert.equal(core.effectiveEffect(u, 1).fireRateMul, Math.round(0.05 * g * 100) / 100);
  assert.equal(core.effectiveEffect(u, 2).fireRateMul, Math.round(0.05 * g * g * 100) / 100);
  assert.ok(core.effectiveEffect(u, 4).fireRateMul > 1.0, 'by VB4 it is worth more than doubling');
});

test('effectiveEffect leaves booleans exactly alone', () => {
  ['split_shot', 'tracer_rounds', 'thorns', 'rear_cannon', 'side_pods',
    'twin_core', 'oc_needle', 'hc_absolution', 'dc_apotheosis'].forEach(id => {
    const u = core.byId(id);
    for (let vb = 0; vb <= 5; vb++) {
      const e = core.effectiveEffect(u, vb);
      Object.keys(u.effect).forEach(k => {
        if (typeof u.effect[k] === 'boolean') {
          assert.equal(e[k], u.effect[k], `${id}.${k} at voidbirth ${vb}`);
        }
      });
    }
  });
});

test('effectiveEffect keeps integer-typed effects whole at every depth', () => {
  core.UPGRADES.forEach(u => {
    for (let vb = 0; vb <= 5; vb++) {
      const e = core.effectiveEffect(u, vb);
      core.INTEGER_EFFECTS.forEach(k => {
        if (typeof e[k] === 'number') {
          assert.equal(e[k], Math.round(e[k]), `${u.id}.${k} is fractional at voidbirth ${vb}`);
          assert.ok(e[k] >= 1, `${u.id}.${k} collapsed to ${e[k]} at voidbirth ${vb}`);
        }
      });
    }
  });
});

test('a promoted upgrade is never a downgrade — its numbers only grow', () => {
  core.UPGRADES.forEach(u => {
    Object.keys(u.effect).forEach(k => {
      if (typeof u.effect[k] !== 'number') return;
      let prev = Math.abs(u.effect[k]);
      for (let vb = 1; vb <= 5; vb++) {
        const now = Math.abs(core.effectiveEffect(u, vb)[k]);
        assert.ok(now >= prev, `${u.id}.${k} shrank between voidbirth ${vb - 1} and ${vb}`);
        prev = now;
      }
    });
  });
});

test('effectiveEffect keeps the sign of a number effect', () => {
  const u = core.byId('tight_barrel');
  for (let vb = 0; vb <= 5; vb++) {
    assert.ok(core.effectiveEffect(u, vb).spreadMul < 0, `voidbirth ${vb}`);
  }
});

test('effectiveEffect rounds multipliers to two decimals so cards read cleanly', () => {
  core.UPGRADES.forEach(u => {
    for (let vb = 0; vb <= 5; vb++) {
      const e = core.effectiveEffect(u, vb);
      Object.keys(e).forEach(k => {
        if (typeof e[k] !== 'number' || core.INTEGER_EFFECTS.indexOf(k) !== -1) return;
        assert.ok(Math.abs(e[k] * 100 - Math.round(e[k] * 100)) < 1e-9,
          `${u.id}.${k} is ${e[k]} at voidbirth ${vb}`);
      });
    }
  });
});

test('resolve produces the full shop-card shape at every depth', () => {
  core.UPGRADES.forEach(u => {
    for (let vb = 0; vb <= 5; vb++) {
      const r = core.resolve(u, vb);
      assert.equal(r.id, u.id);
      assert.equal(r.tier, core.effectiveTier(u, vb));
      assert.equal(r.name, core.effectiveName(u, vb));
      assert.equal(r.desc, u.desc);
      assert.deepEqual(r.effect, core.effectiveEffect(u, vb));
      assert.deepEqual(Object.keys(r).sort(), ['desc', 'effect', 'id', 'name', 'tier']);
    }
  });
});

test('HUNTER ROUNDS is an OVERCLOCKED with its homing strength unchanged', () => {
  const u = core.byId('hunter_rounds');
  // Moved up from APEX: homing removes the most important skill in the game,
  // and at APEX it turned up often enough to define most deep builds.
  assert.equal(u.tier, 'OVERCLOCKED');
  assert.equal(u.effect.homing, 0.03);
});

test('TRACER ROUNDS gives information, not aim, and moved up with the family', () => {
  const u = core.byId('tracer_rounds');
  // EPIC now. It does not steer a shot, but knowing exactly where the lead is
  // is most of what aim assist buys you, so it moved with the rest of them.
  assert.equal(u.tier, 'EPIC');
  assert.equal(u.effect.tracer, true);
  assert.equal(u.effect.homing, undefined, 'a tracer must never actually steer');
});

test('the nerf pass numbers from the spec are in the catalogue', () => {
  assert.equal(core.byId('reload_coil').effect.fireRateMul, 0.05);
  assert.equal(core.byId('heavy_rounds').effect.damageMul, 0.06);
  assert.equal(core.byId('thrusters').effect.speedMul, 0.05);
  assert.equal(core.byId('twin_feed').effect.fireRateMul, 0.10);
  assert.equal(core.byId('ap_rounds').effect.damageMul, 0.12);
  assert.equal(core.byId('evasion').effect.speedMul, 0.08);
  assert.equal(core.byId('evasion').effect.hitScaleMul, -0.06);
  assert.equal(core.byId('vampiric').effect.lifePerKills, 60, 'VAMPIRIC CORE was nerfed to 60 kills');
});

// ---------------------------------------------------------------------------
// 9. Rolling
// ---------------------------------------------------------------------------

test('eligible only returns upgrades whose effective tier matches', () => {
  for (let vb = 0; vb <= 5; vb++) {
    TIER_IDS.forEach(id => {
      core.eligible(id, [], vb).forEach(u => {
        assert.equal(core.effectiveTier(u, vb), id, `${u.id} listed under ${id} at vb ${vb}`);
      });
    });
  }
});

test('eligible at voidbirth 1 offers the promoted COMMONs as UNCOMMONs', () => {
  const ids = core.eligible('UNCOMMON', [], 1).map(u => u.id);
  assert.ok(ids.indexOf('reload_coil') !== -1, 'RELOAD COIL must still be in the game after VB1');
  assert.equal(core.eligible('COMMON', [], 1).length, 0, 'no COMMON ever appears after VB1');
});

test('eligible drops an upgrade once it hits its stack limit', () => {
  const limit = core.tierOf('COMMON').stackLimit;
  const partial = core.eligible('COMMON', [{ id: 'reload_coil', stacks: limit - 1 }], 0);
  assert.ok(partial.some(u => u.id === 'reload_coil'), 'one short of the limit is still buyable');
  const full = core.eligible('COMMON', [{ id: 'reload_coil', stacks: limit }], 0);
  assert.equal(full.some(u => u.id === 'reload_coil'), false, 'a maxed upgrade must leave the pool');
});

test('rollSlot never returns null while eligible upgrades exist', () => {
  const rnd = makeRnd(555);
  for (let vb = 0; vb <= 5; vb++) {
    for (let i = 0; i < 800; i++) {
      const u = core.rollSlot(1 + (i % 300), vb, [], rnd, []);
      assert.notEqual(u, null, `null slot at voidbirth ${vb}, iteration ${i}`);
      assert.notEqual(core.byId(u.id), null);
    }
  }
});

test('rollSlot never returns an upgrade already at its stack limit', () => {
  const rnd = makeRnd(777);
  const owned = exhaust(['COMMON']);
  for (let i = 0; i < 1500; i++) {
    const u = core.rollSlot(1, 0, owned, rnd, []);
    assert.notEqual(u, null);
    assert.notEqual(u.tier, 'COMMON', `${u.id} was offered despite every COMMON being maxed`);
  }
});

test('rollSlot never returns an upgrade at its limit when only some are maxed', () => {
  const rnd = makeRnd(31337);
  const owned = [{ id: 'reload_coil', stacks: 5 }, { id: 'piercing', stacks: 3 }];
  for (let i = 0; i < 3000; i++) {
    const u = core.rollSlot(1, 0, owned, rnd, []);
    assert.notEqual(u.id, 'reload_coil');
    assert.notEqual(u.id, 'piercing');
  }
});

test('rollSlot respects the exclude list', () => {
  const rnd = makeRnd(4242);
  const exclude = core.UPGRADES.filter(u => u.tier === 'COMMON' || u.tier === 'RARE').map(u => u.id);
  for (let i = 0; i < 2000; i++) {
    const u = core.rollSlot(1, 0, [], rnd, exclude);
    assert.notEqual(u, null);
    assert.equal(exclude.indexOf(u.id), -1, `${u.id} was excluded but came back anyway`);
  }
});

test('an exhausted tier promotes upward rather than coming up empty', () => {
  const owned = exhaust(['COMMON']);
  const u = core.rollSlot(1, 0, owned, ladder([0, 0]), []);
  assert.notEqual(u, null);
  assert.equal(u.tier, 'UNCOMMON',
    'a COMMON roll with every COMMON maxed must show better goods, not filler');
});

test('promotion walks up one tier at a time', () => {
  const owned = exhaust(['COMMON', 'UNCOMMON', 'RARE']);
  const u = core.rollSlot(1, 0, owned, ladder([0, 0]), []);
  assert.equal(u.tier, 'EPIC');
});

test('promotion stops below the three undriftable top positions', () => {
  const owned = exhaust(['COMMON', 'UNCOMMON', 'RARE', 'EPIC']);
  const u = core.rollSlot(1, 0, owned, ladder([0, 0]), []);
  assert.equal(u.tier, 'LEGENDARY', 'LEGENDARY is the highest promotion can reach at voidbirth 0');
});

test('promotion must NOT reach into MYTHIC, APEX or OVERCLOCKED from a low roll', () => {
  // Everything up to LEGENDARY is maxed out; MYTHIC and above are wide open.
  // A COMMON roll must still refuse to climb into them: their odds are a fixed
  // promise, and promotion is not a back door into the fixed promise.
  const owned = exhaust(['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY']);
  assert.ok(core.eligible('MYTHIC', owned, 0).length > 0, 'MYTHIC must be available for this to mean anything');
  assert.ok(core.eligible('APEX', owned, 0).length > 0);
  const rnd = makeRnd(8080);
  for (let i = 0; i < 400; i++) {
    const u = core.rollSlot(1, 0, owned, ladder([0, rnd()]), []);
    assert.equal(u, null, `promotion leaked into ${u && u.tier}`);
  }
});

test('a roll that lands directly on MYTHIC is still honoured', () => {
  // 0.994 * 100 = 99.4, which falls inside the MYTHIC band at voidbirth 0.
  const u = core.rollSlot(1, 0, [], ladder([0.994, 0]), []);
  assert.equal(u.tier, 'MYTHIC', 'a direct roll into the top three is not blocked, only promotion is');
});

test('promotion at voidbirth 3 stops three rungs below the top of the shifted vector', () => {
  // At voidbirth 3 the floor is EPIC and the undriftable trio is
  // HYPER/UBER/DYNACLOCKED, so promotion may reach OVERCLOCKED and no further.
  const maxed = core.UPGRADES
    .filter(u => ['EPIC', 'LEGENDARY', 'MYTHIC', 'APEX'].indexOf(core.effectiveTier(u, 3)) !== -1)
    .map(u => ({ id: u.id, stacks: core.tierOf(core.effectiveTier(u, 3)).stackLimit }));
  const u = core.rollSlot(1, 3, maxed, ladder([0, 0]), []);
  assert.equal(u && core.effectiveTier(u, 3), 'OVERCLOCKED');
});

test('when nothing above is available the slot falls back downward', () => {
  // Roll straight into OVERCLOCKED with every OVERCLOCKED upgrade already owned.
  const owned = exhaust(['OVERCLOCKED']);
  const u = core.rollSlot(1, 0, owned, ladder([0.999999, 0]), []);
  assert.notEqual(u, null);
  assert.equal(u.tier, 'APEX', 'a top roll with nothing to give should step down, not vanish');
});

test('rollSlot never returns an upgrade below the voidbirth floor', () => {
  const rnd = makeRnd(2468);
  for (let vb = 1; vb <= 5; vb++) {
    for (let i = 0; i < 500; i++) {
      const u = core.rollSlot(1, vb, [], rnd, []);
      const idx = core.tierIndexOf(core.effectiveTier(u, vb));
      assert.ok(idx >= core.floorTierIndex(vb), `${u.id} resolved below the vb${vb} floor`);
    }
  }
});

test('rollShop returns the base three slots by default', () => {
  const rnd = makeRnd(11);
  for (let i = 0; i < 200; i++) {
    assert.equal(core.rollShop(1, 0, [], rnd).length, core.BASE_SHOP_SLOTS);
  }
  assert.equal(core.BASE_SHOP_SLOTS, 3);
});

test('rollShop returns the requested slot count', () => {
  const rnd = makeRnd(12);
  [1, 2, 3, 4, 5, 6].forEach(n => {
    for (let i = 0; i < 50; i++) {
      assert.equal(core.rollShop(1, 0, [], rnd, n).length, n, `${n} slots`);
    }
  });
});

test('rollShop never shows the same upgrade twice in one visit', () => {
  const rnd = makeRnd(13);
  for (let vb = 0; vb <= 5; vb++) {
    for (let i = 0; i < 300; i++) {
      const cards = core.rollShop(1 + i, vb, [], rnd, 5);
      const ids = cards.map(c => c.id);
      assert.equal(new Set(ids).size, ids.length, `duplicate card at voidbirth ${vb}: ${ids}`);
    }
  }
});

test('rollShop returns fully resolved cards, not raw catalogue entries', () => {
  const rnd = makeRnd(14);
  for (let vb = 0; vb <= 5; vb++) {
    core.rollShop(60, vb, [], rnd, 4).forEach(c => {
      assert.equal(typeof c.id, 'string');
      assert.equal(typeof c.tier, 'string');
      assert.doesNotThrow(() => core.tierOf(c.tier));
      assert.ok(c.name.length > 0);
      assert.ok(c.desc.length > 0);
      assert.equal(typeof c.effect, 'object');
      assert.ok(Object.keys(c.effect).length > 0);
      assert.equal(c.line, undefined, 'a resolved card should not leak the raw lineage array');
      assert.equal(c.name, core.effectiveName(core.byId(c.id), vb));
      assert.equal(c.tier, core.effectiveTier(core.byId(c.id), vb));
    });
  }
});

test('rollShop never offers something already at its stack limit', () => {
  const rnd = makeRnd(15);
  const owned = exhaust(['COMMON', 'UNCOMMON']);
  for (let i = 0; i < 400; i++) {
    core.rollShop(1, 0, owned, rnd, 3).forEach(c => {
      const have = owned.find(o => o.id === c.id);
      assert.equal(have, undefined, `${c.id} is maxed but was offered anyway`);
    });
  }
});

test('rollShop distinguishes an absent slot count from an explicit zero', () => {
  const rnd = makeRnd(16);
  // Absent means "use the default"...
  assert.equal(core.rollShop(1, 0, [], rnd, undefined).length, core.BASE_SHOP_SLOTS);
  assert.equal(core.rollShop(1, 0, [], rnd, null).length, core.BASE_SHOP_SLOTS);
  // ...but an explicit number is honoured, and never opens an empty shop.
  assert.equal(core.rollShop(1, 0, [], rnd, 0).length, 1, 'zero clamps to one card, not to the default');
  assert.equal(core.rollShop(1, 0, [], rnd, -5).length, 1, 'a negative count still opens one slot');
  assert.equal(core.rollShop(1, 0, [], rnd, 4).length, 4, 'BROKER LICENCE gets its fourth card');
});

// ---------------------------------------------------------------------------
// 10. resolveStats
// ---------------------------------------------------------------------------

test('with no upgrades the stats are the bare baseline', () => {
  const s = core.resolveStats(SHIP, [], 0, 1);
  assert.equal(s.damage, core.BASE_DAMAGE);
  assert.equal(s.fireRate, core.BASE_FIRE_RATE * SHIP.fireMul);
  assert.equal(s.speed, SHIP.speed);
  assert.equal(s.spread, SHIP.spreadMul);
  assert.equal(s.hitScale, 1);
  assert.equal(s.bulletSpeedMul, 1);
  assert.equal(s.scrapMul, 1);
  assert.equal(s.enemyBulletMul, 1);
  assert.equal(s.shopSlots, core.BASE_SHOP_SLOTS);
  assert.equal(s.scrapLoss, core.HIT_SCRAP_LOSS);
  assert.equal(s.critMul, 2);
  assert.equal(s.bulletSize, 1);
});

test('with no upgrades every counter is zero and every flag is false', () => {
  const s = core.resolveStats(SHIP, [], 0, 1);
  ['shieldCharges', 'extraShots', 'extraLives', 'scrapPerLevel', 'scrapPerSecond',
    'critChance', 'pierce', 'homing', 'splash', 'burn', 'chill', 'ricochet',
    'execute', 'verdict', 'shieldRegen', 'drones', 'chain', 'fortress',
    'singularityCount', 'chronostall', 'priceDiscount', 'freeRerolls', 'aimCone']
    .forEach(k => assert.equal(s[k], 0, `${k} should start at 0`));
  ['split', 'rear', 'sides', 'tracer', 'thorns', 'needle',
    'dronesCopyGun', 'phaseDrive', 'twinCore', 'apotheosis', 'singularity',
    'upsideDown', 'mirrored']
    .forEach(k => assert.equal(s[k], false, `${k} should start false`));
  ['dropBonus', 'contactDamage', 'slowField', 'revengeShots',
    'startScrap', 'luck', 'overkill']
    .forEach(k => assert.equal(s[k], 0, `${k} should start at 0`));
});

test('the ship fireMul sets the baseline interval', () => {
  assert.equal(core.resolveStats({ fireMul: 0.7, speed: 5, spreadMul: 1 }, [], 0, 1).fireRate, 7);
  assert.equal(core.resolveStats({ fireMul: 1.3, speed: 5, spreadMul: 1 }, [], 0, 1).fireRate, 13);
});

test('fire rate is an interval, so a bonus makes it smaller', () => {
  const base = core.resolveStats(SHIP, [], 0, 1).fireRate;
  const one = core.resolveStats(SHIP, [{ id: 'reload_coil', stacks: 1 }], 0, 1).fireRate;
  assert.ok(one < base, 'a fire-rate bonus must shorten the interval');
  close(one, 10 / 1.05);
});

test('fire rate bonuses add before they divide, and scale with stacks', () => {
  const s = core.resolveStats(SHIP, [{ id: 'reload_coil', stacks: 3 }], 0, 1);
  close(s.fireRate, 10 / 1.15);
  const s2 = core.resolveStats(SHIP,
    [{ id: 'reload_coil', stacks: 2 }, { id: 'twin_feed', stacks: 1 }], 0, 1);
  close(s2.fireRate, 10 / 1.20);
});

test('fire rate is floored at MIN_FIRE_RATE so aiming never stops mattering', () => {
  assert.equal(core.MIN_FIRE_RATE, 6, 'the spec raised the floor from 4 frames to 6');
  const s = core.resolveStats(SHIP,
    [{ id: 'reload_coil', stacks: 5 }, { id: 'twin_feed', stacks: 5 }], 0, 1);
  assert.equal(s.fireRate, core.MIN_FIRE_RATE);
  const absurd = core.resolveStats(SHIP,
    [{ id: 'reload_coil', stacks: 5 }, { id: 'twin_feed', stacks: 5 },
      { id: 'reload_sing', stacks: 1 }], 5, 1);
  assert.equal(absurd.fireRate, core.MIN_FIRE_RATE, 'no build becomes a solid beam');
});

test('damage multipliers add across stacks and across upgrades', () => {
  close(core.resolveStats(SHIP, [{ id: 'heavy_rounds', stacks: 1 }], 0, 1).damage, 10.6);
  close(core.resolveStats(SHIP, [{ id: 'heavy_rounds', stacks: 3 }], 0, 1).damage, 11.8);
  close(core.resolveStats(SHIP,
    [{ id: 'heavy_rounds', stacks: 2 }, { id: 'ap_rounds', stacks: 1 }], 0, 1).damage, 12.4);
});

test('stat resolution scales with voidbirth depth', () => {
  const at0 = core.resolveStats(SHIP, [{ id: 'heavy_rounds', stacks: 1 }], 0, 1).damage;
  const at1 = core.resolveStats(SHIP, [{ id: 'heavy_rounds', stacks: 1 }], 1, 1).damage;
  const at3 = core.resolveStats(SHIP, [{ id: 'heavy_rounds', stacks: 1 }], 3, 1).damage;
  close(at1, 10 * (1 + 0.06 * core.LINEAGE_GROWTH));
  assert.ok(at1 > at0 && at3 > at1, 'the same upgrade must be worth more the deeper you are');
});

test('shield charges are capped at MAX_SHIELD_CHARGES', () => {
  // Tightened from 4. A four-charge stack was four free mistakes between
  // shops, which is most of why the mid-game stopped being dangerous.
  assert.equal(core.MAX_SHIELD_CHARGES, 3);
  assert.equal(core.resolveStats(SHIP, [{ id: 'plating', stacks: 2 }], 0, 1).shieldCharges, 2);
  assert.equal(core.resolveStats(SHIP, [{ id: 'plating', stacks: 5 }], 0, 1).shieldCharges, 3);
  assert.equal(core.resolveStats(SHIP, [{ id: 'uc_phalanx', stacks: 1 }], 0, 1).shieldCharges, 3);
  assert.equal(core.resolveStats(SHIP,
    [{ id: 'plating', stacks: 5 }, { id: 'aegis_lattice', stacks: 1 }], 0, 1).shieldCharges, 3);
});

test('repair kits stack once, not twice', () => {
  assert.equal(core.REPAIR_KIT_MAX, 1);
  assert.equal(core.resolveStats(SHIP, [{ id: 'repair_kit', stacks: 5 }], 0, 1).extraLives, 1);
});

// Kill-count shields and lives cost 80% more kills than the card face says.
test('upkeep from kills is scarcer than the card reads', () => {
  assert.equal(core.UPKEEP_SCARCITY, 1.8);
  const s = core.resolveStats(SHIP, [{ id: 'field_kit', stacks: 1 }], 0, 1);
  assert.equal(s.shieldPerKills, 60 * 1.8);
  const l = core.resolveStats(SHIP, [{ id: 'vampiric', stacks: 1 }], 0, 1);
  assert.equal(l.lifePerKills, 60 * 1.8);
});

// Aim assist turns "can you hit it" into "is it on screen", so every card that
// grants it sits one rung higher than it used to.
test('every auto-targeting card is at least RARE', () => {
  const assist = core.UPGRADES.filter(u =>
    u.effect.homing !== undefined || u.effect.aimCone !== undefined || u.effect.tracer === true);
  assert.ok(assist.length >= 10, 'expected the whole aim-assist family');
  assist.forEach(u => {
    // Each moved up exactly one rung from where it was, so the weakest one
    // (a 9-degree nudge) sits at UNCOMMON and nothing grants it at COMMON.
    assert.ok(core.tierIndexOf(u.tier) >= core.tierIndexOf('UNCOMMON'),
      `${u.id} grants aim assist at ${u.tier}`);
  });
  assert.equal(core.byId('hunter_rounds').tier, 'OVERCLOCKED');
});

test('REPAIR KIT cannot contribute more than the spec cap of +1 life', () => {
  // Tightened from +2. Lives are supposed to be scarce now.
  assert.equal(core.REPAIR_KIT_MAX, 1);
  assert.equal(core.resolveStats(SHIP, [{ id: 'repair_kit', stacks: 1 }], 0, 1).extraLives, 1);
  assert.equal(core.resolveStats(SHIP, [{ id: 'repair_kit', stacks: 2 }], 0, 1).extraLives, 1);
  assert.equal(core.resolveStats(SHIP, [{ id: 'repair_kit', stacks: 5 }], 0, 1).extraLives, 1);
});

test('IMMORTAL ENGINE stacks on top of the REPAIR KIT cap, not inside it', () => {
  const s = core.resolveStats(SHIP,
    [{ id: 'repair_kit', stacks: 5 }, { id: 'immortal', stacks: 1 }], 0, 1);
  assert.equal(s.extraLives, 2);
  const u = core.resolveStats(SHIP,
    [{ id: 'repair_kit', stacks: 5 }, { id: 'dc_undying', stacks: 1 }], 0, 1);
  assert.equal(u.extraLives, 4, 'UNDYING grants three on top of the repair-kit ceiling');
});

test('APOTHEOSIS doubles summed numeric stats', () => {
  const plain = core.resolveStats(SHIP, [{ id: 'heavy_rounds', stacks: 1 }], 0, 1);
  const doubled = core.resolveStats(SHIP,
    [{ id: 'heavy_rounds', stacks: 1 }, { id: 'dc_apotheosis', stacks: 1 }], 0, 1);
  close(plain.damage, 10.6);
  close(doubled.damage, 11.2, 'every stat you own counts twice');
  assert.equal(doubled.apotheosis, true);
  assert.equal(plain.apotheosis, false);
});

test('APOTHEOSIS does not double booleans into something meaningless', () => {
  const s = core.resolveStats(SHIP,
    [{ id: 'split_shot', stacks: 1 }, { id: 'rear_cannon', stacks: 1 },
      { id: 'dc_apotheosis', stacks: 1 }], 0, 1);
  assert.equal(s.split, true);
  assert.equal(s.rear, true);
  assert.equal(typeof s.split, 'boolean');
  assert.equal(typeof s.rear, 'boolean');
});

test('APOTHEOSIS doubles shots and drones, which are counted not flagged', () => {
  const plain = core.resolveStats(SHIP,
    [{ id: 'wide_mount', stacks: 2 }, { id: 'orbital_drone', stacks: 1 }], 0, 1);
  const doubled = core.resolveStats(SHIP,
    [{ id: 'wide_mount', stacks: 2 }, { id: 'orbital_drone', stacks: 1 },
      { id: 'dc_apotheosis', stacks: 1 }], 0, 1);
  assert.equal(plain.extraShots, 2);
  assert.equal(doubled.extraShots, 4);
  assert.equal(plain.drones, 1);
  assert.equal(doubled.drones, 2);
});

test('critChance is clamped at 1 however hard the build pushes', () => {
  const s = core.resolveStats(SHIP,
    [{ id: 'targeting_fin', stacks: 5 }, { id: 'hardened_hull', stacks: 5 },
      { id: 'deadeye', stacks: 1 }, { id: 'dc_apotheosis', stacks: 1 }], 0, 1);
  assert.equal(s.critChance, 1);
  close(core.resolveStats(SHIP, [{ id: 'targeting_fin', stacks: 2 }], 0, 1).critChance, 0.06);
});

test('priceDiscount is clamped at 60%', () => {
  close(core.resolveStats(SHIP, [{ id: 'war_chest', stacks: 1 }], 0, 1).priceDiscount, 0.12);
  close(core.resolveStats(SHIP, [{ id: 'war_chest', stacks: 3 }], 0, 1).priceDiscount, 0.36);
  assert.equal(core.resolveStats(SHIP,
    [{ id: 'war_chest', stacks: 3 }, { id: 'dc_apotheosis', stacks: 1 }], 0, 1).priceDiscount, 0.6);
});

test('hitScale is floored at 0.4 so a hitbox never disappears', () => {
  close(core.resolveStats(SHIP, [{ id: 'ablative_trim', stacks: 2 }], 0, 1).hitScale, 0.92);
  const tiny = core.resolveStats(SHIP,
    [{ id: 'ablative_trim', stacks: 5 }, { id: 'evasion', stacks: 5 },
      { id: 'dc_apotheosis', stacks: 1 }], 0, 1);
  assert.equal(tiny.hitScale, 0.4);
});

test('enemyBulletMul is floored at 0.25 so bullets never stop moving', () => {
  close(core.resolveStats(SHIP, [{ id: 'time_dilation', stacks: 1 }], 0, 1).enemyBulletMul, 0.7);
  assert.equal(core.resolveStats(SHIP, [{ id: 'time_dilation', stacks: 1 }], 2, 1).enemyBulletMul, 0.25);
});

test('the max() combinator reads the raw effect value, not a sum and not zero', () => {
  const s = core.resolveStats(SHIP, [{ id: 'overcharge', stacks: 3 }], 0, 1);
  assert.equal(s.overcharge, 5, 'max() must ignore stack count');
  assert.equal(core.resolveStats(SHIP, [{ id: 'chain', stacks: 1 }], 0, 1).chain, 2);
  assert.equal(core.resolveStats(SHIP, [{ id: 'flak_burst', stacks: 1 }], 0, 1).splash, 30);
  assert.equal(core.resolveStats(SHIP, [{ id: 'incendiary', stacks: 1 }], 0, 1).burn, 0.4);
  assert.equal(core.resolveStats(SHIP, [{ id: 'cryo_rounds', stacks: 1 }], 0, 1).chill, 0.35);
  assert.equal(core.resolveStats(SHIP, [{ id: 'hunter_rounds', stacks: 1 }], 0, 1).homing, 0.03);
});

test('max() picks the stronger of two competing upgrades', () => {
  const s = core.resolveStats(SHIP,
    [{ id: 'executioner', stacks: 1 }, { id: 'dc_lastword', stacks: 1 }], 0, 1);
  assert.equal(s.execute, 0.40, 'THE LAST WORD must not be dragged down by EXECUTIONER');
});

test('drones sum across upgrades but chain does not', () => {
  const s = core.resolveStats(SHIP,
    [{ id: 'orbital_drone', stacks: 1 }, { id: 'mirror_drones', stacks: 1 }], 0, 1);
  assert.equal(s.drones, 3);
  assert.equal(s.dronesCopyGun, true);
});

test('singularityCount is zero without a singularity and 3 with EVENT HORIZON', () => {
  assert.equal(core.resolveStats(SHIP, [], 0, 1).singularityCount, 0);
  assert.equal(core.resolveStats(SHIP, [{ id: 'singularity', stacks: 1 }], 0, 1).singularityCount, 1);
  const eh = core.resolveStats(SHIP, [{ id: 'uc_eventhorizon', stacks: 1 }], 0, 1);
  assert.equal(eh.singularityCount, 3);
  assert.equal(eh.singularity, true);
});

test('the shop-slot and reroll upgrades feed straight into the stats', () => {
  assert.equal(core.resolveStats(SHIP, [{ id: 'fourth_slot', stacks: 1 }], 0, 1).shopSlots, 4);
  assert.equal(core.resolveStats(SHIP, [{ id: 'free_reroll', stacks: 1 }], 0, 1).freeRerolls, 1);
});

test('GREED ENGINE doubles scrap and deepens the scrap penalty, as its card says', () => {
  const s = core.resolveStats(SHIP, [{ id: 'greed', stacks: 1 }], 0, 1);
  assert.equal(s.scrapMul, 2);
  assert.equal(s.scrapLoss, core.GREED_SCRAP_LOSS);
});

test('every boolean flag in the catalogue reaches the stats when owned', () => {
  const flags = {
    split_shot: 'split', rear_cannon: 'rear', side_pods: 'sides', tracer_rounds: 'tracer',
    thorns: 'thorns', oc_needle: 'needle',
    s_upside_down: 'upsideDown', s_mirror: 'mirrored',
    twin_core: 'twinCore', phase_drive: 'phaseDrive', singularity: 'singularity'
  };
  Object.keys(flags).forEach(id => {
    const s = core.resolveStats(SHIP, [{ id, stacks: 1 }], 0, 1);
    assert.equal(s[flags[id]], true, `${id} did not set ${flags[id]}`);
  });
});

test('an unknown upgrade in the owned list is ignored rather than crashing', () => {
  const s = core.resolveStats(SHIP,
    [{ id: 'ghost_upgrade', stacks: 3 }, { id: 'heavy_rounds', stacks: 1 }], 0, 1);
  close(s.damage, 10.6);
});

test('scrap multipliers accumulate across both scrap upgrades', () => {
  const s = core.resolveStats(SHIP,
    [{ id: 'scrap_magnet', stacks: 2 }, { id: 'salvage_rig', stacks: 1 }], 0, 1);
  close(s.scrapMul, 1 + 0.16 + 0.16);
});

test('PHASE DRIVE is a self-contained flag with its own recharge period', () => {
  assert.ok(core.PHASE_DRIVE_FRAMES > 0);
  const on = core.resolveStats(SHIP, [{ id: 'phase_drive', stacks: 1 }], 0, 1);
  assert.equal(on.phaseDrive, true);
  assert.equal('phaseBoost' in on, false, 'the old boost-gated key must be gone, not merely unused');
  assert.equal(core.byId('phase_drive').effect.phaseBoost, undefined);
  assert.equal(/boost/i.test(core.byId('phase_drive').desc), false);
});

test('resolveStats does not mutate the owned list it is given', () => {
  const owned = [Object.freeze({ id: 'heavy_rounds', stacks: 2 })];
  Object.freeze(owned);
  assert.doesNotThrow(() => core.resolveStats(SHIP, owned, 3, 1));
  assert.equal(owned[0].stacks, 2);
});

// ---------------------------------------------------------------------------
// 11. The cost of a hit
// ---------------------------------------------------------------------------
// A hit used to strip an upgrade off the build. It now takes half the
// treasury instead. stripCheapest/stripN were deleted with the rule; what
// depended on them was hitPlayer, stats.strips, stats.noStrip, two card
// texts, and this section.

test('a hit costs half the treasury by default', () => {
  assert.equal(core.HIT_SCRAP_LOSS, 0.5);
  assert.equal(core.scrapAfterHit(1000), 500);
  assert.equal(core.scrapAfterHit(999), 499, 'rounds down, never up');
});

test('GREED ENGINE deepens the loss rather than costing upgrades', () => {
  assert.equal(core.GREED_SCRAP_LOSS, 0.75);
  assert.equal(core.scrapAfterHit(1000, core.GREED_SCRAP_LOSS), 250);
});

test('a hit can never take more than there is, or leave a negative', () => {
  assert.equal(core.scrapAfterHit(0), 0);
  assert.equal(core.scrapAfterHit(-50), 0);
  assert.equal(core.scrapAfterHit(100, 1), 0);
  assert.equal(core.scrapAfterHit(100, 5), 0, 'a fraction above 1 clamps');
  assert.equal(core.scrapAfterHit(100, -1), 100, 'a negative fraction clamps');
});

test('ABSOLUTION zeroes the loss entirely', () => {
  const owned = [{ id: 'hc_absolution', stacks: 1 }];
  assert.equal(core.resolveStats(SHIP, owned, 0, 1, 1).scrapLoss, 0);
});

test('GREED ENGINE resolves to the deeper loss', () => {
  const owned = [{ id: 'greed', stacks: 1 }];
  assert.equal(core.resolveStats(SHIP, owned, 0, 1, 1).scrapLoss, core.GREED_SCRAP_LOSS);
});

test('a bare build takes the ordinary loss', () => {
  assert.equal(core.resolveStats(SHIP, [], 0, 1, 1).scrapLoss, core.HIT_SCRAP_LOSS);
});

// ---------------------------------------------------------------------------
// 12. buildShots
// ---------------------------------------------------------------------------

test('the base pattern is two parallel forward shots', () => {
  const shots = core.buildShots(baseStats());
  assert.equal(shots.length, 2);
  shots.forEach(s => {
    assert.equal(s.a, 0, 'the base shots fly parallel, not fanned');
    assert.ok(s.dy < 0, 'shots travel up the screen');
  });
});

test('the base pattern is 20px wide and centred on the hull', () => {
  const shots = core.buildShots(baseStats());
  const xs = shots.map(s => s.dx);
  assert.equal(Math.max(...xs) - Math.min(...xs), 20);
  close(xs.reduce((a, b) => a + b, 0), 0, 'the pattern must be centred on straight-up');
});

test('WIDE MOUNT adds a shot for each stack', () => {
  [1, 2, 3, 5].forEach(n => {
    assert.equal(core.buildShots(baseStats({ extraShots: n })).length, 2 + n, `${n} extra`);
  });
});

test('extra shots fan out instead of staying parallel', () => {
  const fanned = core.buildShots(baseStats({ extraShots: 2 }));
  const angles = fanned.map(s => s.a);
  assert.ok(angles.some(a => a < 0) && angles.some(a => a > 0), 'the pattern must open outward');
  close(angles.reduce((a, b) => a + b, 0), 0, 'the fan must be symmetric');
});

test('the pattern stays 20px wide however many shots there are', () => {
  [1, 3, 6].forEach(n => {
    const xs = core.buildShots(baseStats({ extraShots: n })).map(s => s.dx);
    close(Math.max(...xs) - Math.min(...xs), 20, `${n} extra shots`);
  });
});

test('TIGHT BARREL narrows the fan without changing the shot count', () => {
  const wide = core.buildShots(baseStats({ extraShots: 2, spread: 1 }));
  const tight = core.buildShots(baseStats({ extraShots: 2, spread: 0.5 }));
  assert.equal(wide.length, tight.length);
  for (let i = 0; i < wide.length; i++) {
    assert.ok(Math.abs(tight[i].a) <= Math.abs(wide[i].a) + 1e-12, `shot ${i}`);
  }
  close(Math.max(...tight.map(s => Math.abs(s.a))),
    Math.max(...wide.map(s => Math.abs(s.a))) / 2);
});

test('THE NEEDLE returns exactly one shot', () => {
  const shots = core.buildShots(baseStats({ needle: true }));
  assert.equal(shots.length, 1);
  assert.equal(shots[0].needle, true);
  assert.equal(shots[0].a, 0);
  assert.equal(shots[0].dx, 0);
});

test('THE NEEDLE overrides every other firing pattern', () => {
  const shots = core.buildShots(baseStats({
    needle: true, extraShots: 5, rear: true, sides: true, twinCore: true
  }));
  assert.equal(shots.length, 1, 'one shot means one shot');
});

test('REAR CANNON adds exactly two shots, both pointing backwards', () => {
  const base = core.buildShots(baseStats());
  const withRear = core.buildShots(baseStats({ rear: true }));
  assert.equal(withRear.length, base.length + 2);
  const rear = withRear.slice(base.length);
  rear.forEach(s => {
    close(Math.abs(s.a), Math.PI, 'a rear shot fires straight back');
    assert.ok(s.dy > 0, 'a rear muzzle sits behind the hull');
  });
});

test('SIDE PODS add exactly two shots, one to each side', () => {
  const base = core.buildShots(baseStats());
  const withSides = core.buildShots(baseStats({ sides: true }));
  assert.equal(withSides.length, base.length + 2);
  const sides = withSides.slice(base.length);
  assert.deepEqual(sides.map(s => s.a).sort((a, b) => a - b), [-Math.PI / 2, Math.PI / 2]);
  assert.ok(sides[0].dx < 0 && sides[1].dx > 0, 'the pods sit on opposite flanks');
});

test('REAR CANNON and SIDE PODS together add four shots', () => {
  assert.equal(core.buildShots(baseStats({ rear: true, sides: true })).length, 6);
});

test('TWIN CORE doubles whatever pattern it is handed', () => {
  [baseStats(), baseStats({ extraShots: 3 }), baseStats({ rear: true, sides: true }),
    baseStats({ extraShots: 2, rear: true, sides: true })].forEach(s => {
    const one = core.buildShots(s);
    const two = core.buildShots(Object.assign({}, s, { twinCore: true }));
    assert.equal(two.length, one.length * 2, 'every weapon effect fires twice');
  });
});

test('TWIN CORE copies preserve the angles of the originals', () => {
  const s = baseStats({ extraShots: 2, rear: true });
  const one = core.buildShots(s);
  const two = core.buildShots(Object.assign({}, s, { twinCore: true }));
  for (let i = 0; i < one.length; i++) {
    assert.equal(two[one.length + i].a, one[i].a, `copy ${i} points elsewhere`);
  }
});

// ---------------------------------------------------------------------------
// 13. Economy
// ---------------------------------------------------------------------------

test('creditsForScore floors at the divisor', () => {
  assert.equal(core.CREDIT_DIVISOR, 110);
  assert.equal(core.creditsForScore(0), 0);
  assert.equal(core.creditsForScore(109), 0, 'a score below the divisor earns nothing');
  assert.equal(core.creditsForScore(110), 1);
  assert.equal(core.creditsForScore(219), 1);
  assert.equal(core.creditsForScore(12400), 112);
  assert.equal(core.creditsForScore(-500), 0, 'a negative score never pays');
});

// Credits are the slowest tap in the game, and deliberately compressive: the
// hangar is meant to take many runs to fill, not one very good one.
test('credits compress hard above the knee', () => {
  assert.equal(core.CREDIT_KNEE, 60000);
  const atKnee = core.creditsForScore(core.CREDIT_KNEE);
  assert.equal(atKnee, Math.floor(core.CREDIT_KNEE / core.CREDIT_DIVISOR),
    'the curve is continuous at the knee');
  // Twenty times the score must not be twenty times the payout.
  const twenty = core.creditsForScore(core.CREDIT_KNEE * 20);
  assert.ok(twenty < atKnee * 8, `a 20x score paid ${twenty / atKnee}x the credits`);
});

test('creditsForScore never decreases as the score rises', () => {
  let prev = -1;
  for (let sc = 0; sc < 2000000; sc += 977) {
    const c = core.creditsForScore(sc);
    assert.ok(c >= prev, `payout dropped at score ${sc}`);
    prev = c;
  }
});

test('creditsForScore always returns a whole number', () => {
  [0, 1, 55, 12345, 987654].forEach(score => {
    const c = core.creditsForScore(score);
    assert.equal(c, Math.round(c), `score ${score}`);
  });
});

test('scrapForKill scales with the level you are on', () => {
  const flat = core.scrapForKill(100, 1, 1);
  assert.ok(core.scrapForKill(100, 1, 10) > flat);
  assert.ok(core.scrapForKill(100, 1, 100) > core.scrapForKill(100, 1, 10));
  assert.ok(core.scrapForKill(100, 1, 2500) > core.scrapForKill(100, 1, 500));
});

test('scrapForKill follows the tightened depth curve', () => {
  assert.equal(core.SCRAP_DEPTH_EXPONENT, 0.42);
  assert.equal(core.SCRAP_RATE, 0.34);
  [1, 10, 100, 500, 2500].forEach(level => {
    assert.equal(core.scrapForKill(100, 1, level),
      Math.max(1, Math.round(100 * Math.pow(level, core.SCRAP_DEPTH_EXPONENT) * core.SCRAP_RATE)),
      `level ${level}`);
  });
});

// The screenshot that started this: level 22, ninety-nine upgrades, a screen
// so full of the player's own bullets that nothing could reach them. The path
// there was reroll-and-rebuy — buy every slot, reroll, buy again — which flat
// prices made unlimited. This models it and pins the outcome.
function greedyBuildSize(maxLevel) {
  let owned = 0, purse = 0;
  for (let lv = 1; lv <= maxLevel; lv++) {
    purse += 40 * core.scrapForKill(160, 1, lv) + 400;
    if (lv % core.SHOP_EVERY !== 0) continue;
    let rerolls = 0;
    for (let round = 0; round < 60; round++) {
      let bought = 0;
      for (let slot = 0; slot < 5; slot++) {
        const p = core.priceFor('RARE', 0, owned);
        if (purse < p) break;
        purse -= p; owned++; bought++;
      }
      const rc = core.rerollCost(rerolls);
      if (purse < rc) break;
      purse -= rc; rerolls++;
      if (bought === 0 && rerolls > 6) break;
    }
  }
  return owned;
}

test('a run cannot buy its way to a hundred upgrades', () => {
  assert.ok(greedyBuildSize(22) < 40, `level 22 reached ${greedyBuildSize(22)} upgrades`);
  assert.ok(greedyBuildSize(100) < 70, `level 100 reached ${greedyBuildSize(100)} upgrades`);
});

test('a build still GROWS — the cap is soft, not a wall', () => {
  assert.ok(greedyBuildSize(50) > greedyBuildSize(22), 'depth must still buy you more');
  assert.ok(greedyBuildSize(22) > 12, 'and level 22 must still afford a real build');
});

// The shape that matters: income grows with depth, but the cost of the NEXT
// card grows faster, so a build converges instead of running away.
test('build size converges rather than running away', () => {
  const affordable = level => {
    const income = 40 * core.scrapForKill(160, 1, level) + 400;
    let owned = 0;
    // Spend a whole level's income on commons and see where it stops.
    let purse = income;
    while (purse >= core.priceFor('COMMON', 0, owned) && owned < 500) {
      purse -= core.priceFor('COMMON', 0, owned);
      owned++;
    }
    return owned;
  };
  [10, 22, 50, 100].forEach(lv => {
    assert.ok(affordable(lv) < 30, `a single level at ${lv} still buys ${affordable(lv)} cards`);
  });
});

test('scrapForKill is monotonically non-decreasing in level', () => {
  let prev = 0;
  for (let level = 1; level <= 800; level++) {
    const s = core.scrapForKill(10, 1, level);
    assert.ok(s >= prev, `scrap dropped at level ${level}`);
    prev = s;
  }
});

test('scrapForKill scales linearly with the scrap multiplier', () => {
  assert.equal(core.scrapForKill(100, 2, 1), 2 * core.scrapForKill(100, 1, 1));
});

test('scrapForKill never returns less than 1', () => {
  assert.equal(core.scrapForKill(0, 1, 1), 1);
  assert.equal(core.scrapForKill(1, 0.0001, 1), 1);
  assert.equal(core.scrapForKill(0, 0, 1), 1, 'a kill is always worth something');
  assert.equal(core.scrapForKill(1, 1, 0), 1, 'level 0 clamps to level 1');
});

test('reroll cost doubles from 300', () => {
  assert.equal(core.rerollCost(0), 300);
  assert.equal(core.rerollCost(1), 600);
  assert.equal(core.rerollCost(2), 1200);
  assert.equal(core.rerollCost(3), 2400);
  for (let n = 1; n < 10; n++) {
    assert.equal(core.rerollCost(n), core.rerollCost(n - 1) * 2, `use ${n}`);
  }
});

test('priceFor returns the tier price when there is no discount', () => {
  SPEC_TIERS.forEach(([id, price]) => {
    assert.equal(core.priceFor(id, 0), price, id);
    assert.equal(core.priceFor(id), price, `${id} with no argument at all`);
  });
});

test('priceFor applies the discount', () => {
  assert.equal(core.priceFor('COMMON', 0.5), 120);
  assert.equal(core.priceFor('APEX', 0.1), 9900);
  assert.equal(core.priceFor('DYNACLOCKED', 0.25), 67500);
});

test('priceFor clamps the discount at 60%', () => {
  assert.equal(core.priceFor('COMMON', 0.6), 96);
  assert.equal(core.priceFor('COMMON', 0.9), 96, 'a bigger discount must not go past the cap');
  assert.equal(core.priceFor('COMMON', 5), 96);
  assert.equal(core.priceFor('DYNACLOCKED', 1), 36000);
});

test('priceFor never returns less than 1, and always a whole number', () => {
  TIER_IDS.forEach(id => {
    [0, 0.3, 0.6, 1].forEach(d => {
      const p = core.priceFor(id, d);
      assert.ok(p >= 1, `${id} at ${d}`);
      assert.equal(p, Math.round(p));
    });
  });
});

test('priceFor throws on an unknown tier rather than pricing at NaN', () => {
  assert.throws(() => core.priceFor('PLATINUM', 0), /unknown tier id/);
});

test('a deeper voidbirth costs more, because the ladder shifted up', () => {
  const floor0 = core.priceFor(core.TIERS[core.floorTierIndex(0)].id, 0);
  const floor3 = core.priceFor(core.TIERS[core.floorTierIndex(3)].id, 0);
  assert.ok(floor3 > floor0, 'the cheapest card on offer must cost more after three ascensions');
});

// ---------------------------------------------------------------------------
// 14. Enemy firing arcs
// ---------------------------------------------------------------------------

test('the arc rule takes effect at level 15 with a ±0.70 rad cone', () => {
  assert.equal(core.ARC_FROM_LEVEL, 15);
  assert.equal(core.ARC_HALF_ANGLE, 0.70);
  // Keyed on BEHAVIOUR now, not on three hardcoded hull names — the roster
  // holds ninety-five ships and naming them individually would not scale.
  assert.deepEqual(core.ARC_KINDS, ['drifter', 'lancer']);
});

test('below ARC_FROM_LEVEL anything may fire in any direction', () => {
  for (let level = 1; level < core.ARC_FROM_LEVEL; level++) {
    core.ARC_KINDS.concat(['turret', 'weaver']).forEach(kind => {
      assert.equal(core.canFireAt(kind, level, Math.PI), true, `${kind} at level ${level}`);
      assert.equal(core.canFireAt(kind, level, -3), true, `${kind} at level ${level}`);
    });
  }
});

test('from ARC_FROM_LEVEL onward the restricted kinds cannot shoot sideways', () => {
  core.ARC_KINDS.forEach(kind => {
    [15, 16, 100, 2500].forEach(level => {
      assert.equal(core.canFireAt(kind, level, 1.5), false, `${kind} at level ${level}`);
      assert.equal(core.canFireAt(kind, level, -1.5), false, `${kind} at level ${level}`);
      assert.equal(core.canFireAt(kind, level, Math.PI), false, `${kind} at level ${level}`);
    });
  });
});

test('the restricted kinds may still fire straight down', () => {
  core.ARC_KINDS.forEach(kind => {
    assert.equal(core.canFireAt(kind, 2500, 0), true, kind);
  });
});

test('only the listed kinds are restricted', () => {
  ['turret', 'weaver', 'kamikaze', 'swarmling', 'bulwark', 'harbinger', 'mine']
    .forEach(kind => {
      assert.equal(core.canFireAt(kind, 2500, Math.PI), true, `${kind} must be unrestricted`);
    });
});

test('the arc boundary is inclusive on the positive side', () => {
  assert.equal(core.canFireAt('drifter', 15, core.ARC_HALF_ANGLE), true);
  assert.equal(core.canFireAt('drifter', 15, core.ARC_HALF_ANGLE + 1e-6), false);
});

test('the arc boundary is inclusive on the negative side', () => {
  assert.equal(core.canFireAt('drifter', 15, -core.ARC_HALF_ANGLE), true);
  assert.equal(core.canFireAt('drifter', 15, -core.ARC_HALF_ANGLE - 1e-6), false);
});

test('the arc is symmetric about straight down', () => {
  for (let a = 0; a <= 3; a += 0.05) {
    assert.equal(core.canFireAt('elite', 100, a), core.canFireAt('elite', 100, -a),
      `angle ${a} is not treated the same on both sides`);
  }
});

test('the level below the threshold is unrestricted and the threshold itself is not', () => {
  assert.equal(core.canFireAt('drifter', core.ARC_FROM_LEVEL - 1, 3), true);
  assert.equal(core.canFireAt('drifter', core.ARC_FROM_LEVEL, 3), false);
});

// ---------------------------------------------------------------------------
// DIFFICULTY CURVE
// ---------------------------------------------------------------------------
// These exist because the original curves were linear and unbounded, which is
// fine for eight levels and catastrophic for 2,500: at the Mothership an enemy
// bullet crossed the whole screen in under two frames. Not hard — undodgeable.

test('the early difficulty curve is unchanged from the hand-tuned original', () => {
  // Below the knees the formulas must still be exactly 1.2 + 0.2*lv and
  // 2.5 + 0.15*lv, so the opening levels play as they were tuned to.
  for (let lv = 1; lv <= core.ENEMY_SPEED_KNEE; lv++) {
    close(core.difficultyAt(lv).enemySpeed, 1.2 + lv * 0.2, `enemy speed at ${lv}`);
  }
  for (let lv = 1; lv <= core.BULLET_SPEED_KNEE; lv++) {
    close(core.difficultyAt(lv).bulletSpeed, 2.5 + lv * 0.15, `bullet speed at ${lv}`);
  }
});

test('both speed curves are continuous across their knee', () => {
  close(core.difficultyAt(core.ENEMY_SPEED_KNEE).enemySpeed, core.ENEMY_SPEED_CAP);
  close(core.difficultyAt(core.BULLET_SPEED_KNEE).bulletSpeed, core.BULLET_SPEED_CAP);
  // No jump on either side of the join — one level past the knee the curve has
  // only crept, not stepped. (close() is exact to 1e-6; a knee is a change of
  // slope, not of value, so this needs a slope-sized tolerance instead.)
  const eStep = core.difficultyAt(core.ENEMY_SPEED_KNEE + 1).enemySpeed - core.ENEMY_SPEED_CAP;
  const bStep = core.difficultyAt(core.BULLET_SPEED_KNEE + 1).bulletSpeed - core.BULLET_SPEED_CAP;
  assert.ok(eStep >= 0 && eStep < 0.02, `enemy speed steps by ${eStep} across the knee`);
  assert.ok(bStep >= 0 && bStep < 0.02, `bullet speed steps by ${bStep} across the knee`);
});

test('speeds saturate rather than growing without bound', () => {
  for (const lv of [100, 500, 1000, 2500, 100000, 1e9]) {
    const d = core.difficultyAt(lv);
    assert.ok(d.enemySpeed <= core.ENEMY_SPEED_CAP + 1.5 + 1e-9, `enemy speed at ${lv} is ${d.enemySpeed}`);
    assert.ok(d.bulletSpeed <= core.BULLET_SPEED_CAP + 0.5 + 1e-9, `bullet speed at ${lv} is ${d.bulletSpeed}`);
  }
});

test('an enemy bullet is always dodgeable — it never crosses the screen in under a second', () => {
  // 720px canvas at 60fps. Anything under ~60 frames is not a reaction, it is
  // a coin flip. The old curve managed 1.9 frames at level 2500.
  for (const lv of [1, 50, 200, 500, 1000, 2500, 10000]) {
    const frames = 720 / core.difficultyAt(lv).bulletSpeed;
    assert.ok(frames >= 60, `at level ${lv} a bullet crosses in ${frames.toFixed(1)} frames`);
  }
});

test('enemy bullets never outrun the player own bullets', () => {
  for (const lv of [1, 24, 50, 500, 2500, 1e6]) {
    assert.ok(core.difficultyAt(lv).bulletSpeed < core.PLAYER_BULLET_SPEED,
      `enemy bullet speed at level ${lv} reaches the player's own ${core.PLAYER_BULLET_SPEED}`);
  }
});

test('speeds are monotonically non-decreasing with depth', () => {
  let pe = 0, pb = 0;
  for (let lv = 1; lv <= 3000; lv++) {
    const d = core.difficultyAt(lv);
    assert.ok(d.enemySpeed >= pe - 1e-9, `enemy speed dipped at ${lv}`);
    assert.ok(d.bulletSpeed >= pb - 1e-9, `bullet speed dipped at ${lv}`);
    pe = d.enemySpeed; pb = d.bulletSpeed;
  }
});

test('spawn and asteroid rates stay clamped at their floors', () => {
  for (const lv of [1, 20, 100, 2500]) {
    const d = core.difficultyAt(lv);
    assert.ok(d.spawnRate >= core.SPAWN_FLOOR, `level ${lv} spawn`);
    assert.ok(d.asteroidRate >= 28, `level ${lv} asteroid`);
  }
});

// ---------------------------------------------------------------------------
// 18. Spawn density — the fix for "it stops being hard"
// ---------------------------------------------------------------------------
// The interval used to floor at 35 frames from level 11 and never move again:
// 1.71 ships a second at level 20 and the same 1.71 at level 2,500. Health is
// not threat — an enemy needs about a second and a half before it fires, so
// anything killed faster than that contributes nothing however tough it was.

test('the opening is untouched below the spawn knee', () => {
  assert.equal(core.SPAWN_KNEE, 11);
  for (let lv = 1; lv <= core.SPAWN_KNEE; lv++) {
    assert.equal(core.spawnRateAt(lv), Math.max(35, 90 - lv * 5), `level ${lv}`);
  }
});

test('spawn density keeps climbing past the knee', () => {
  let prev = Infinity;
  for (let lv = 1; lv <= 3000; lv += 7) {
    const r = core.spawnRateAt(lv);
    assert.ok(r <= prev + 1e-9, `interval grew at level ${lv}`);
    assert.ok(r >= core.SPAWN_FLOOR, `level ${lv} fell through the floor`);
    prev = r;
  }
  // The whole point: it must actually be denser at depth, not merely non-worse.
  assert.ok(core.spawnRateAt(100) < core.spawnRateAt(20) * 0.75, 'level 100 is barely denser than 20');
  assert.equal(core.spawnRateAt(3000), core.SPAWN_FLOOR, 'and it does bottom out');
});

test('ships arrive in groups at depth, one at a time early on', () => {
  assert.equal(core.spawnBurstAt(1), 1);
  assert.equal(core.spawnBurstAt(core.BURST_FROM - 1), 1, 'nothing before the knee');
  assert.ok(core.spawnBurstAt(90) > 1);
  let prev = 0;
  for (let lv = 1; lv <= 3000; lv += 3) {
    const b = core.spawnBurstAt(lv);
    assert.ok(b >= prev, `burst shrank at level ${lv}`);
    assert.ok(b <= core.BURST_MAX, `burst ran away at level ${lv}`);
    prev = b;
  }
});

test('effective pressure rises many times over across the run', () => {
  const at = lv => (60 / core.spawnRateAt(lv)) * core.spawnBurstAt(lv);
  assert.ok(at(90) > at(20) * 5, 'level 90 must be several times level 20');
  assert.ok(at(1000) > at(90), 'and it must keep climbing');
});

test('enemies arrive nearly ready to fire at depth, never early on', () => {
  assert.equal(core.spawnReadiness(1), 0);
  assert.equal(core.spawnReadiness(core.READY_FROM), 0, 'the early game is untouched');
  assert.ok(core.spawnReadiness(60) > 0.3);
  assert.equal(core.spawnReadiness(9999), core.READY_CAP, 'and it caps');
  let prev = -1;
  for (let lv = 1; lv <= 3000; lv += 11) {
    const r = core.spawnReadiness(lv);
    assert.ok(r >= prev && r <= 1, `level ${lv}`);
    prev = r;
  }
});

// ---------------------------------------------------------------------------
// 19. Invulnerability
// ---------------------------------------------------------------------------
// The measured cause of immortality. A fully-built ship spent 87% of a
// two-minute fight invulnerable: it WAS being hit — 32 times — but each block
// bought a mercy window nearly as long as the gap until the next hit, so the
// windows chained into permanent immunity.

test('a shield can never regrow faster than the mercy it grants', () => {
  const shieldCards = core.UPGRADES.filter(u => u.effect.shieldRegen);
  const mercyCards = core.UPGRADES.filter(u => u.effect.shieldIframes);
  // Every regen card against every mercy card, at every depth. If any pair
  // locks, the run is unkillable.
  shieldCards.forEach(a => mercyCards.concat([{ id: null }]).forEach(b => {
    const owned = [{ id: a.id, stacks: 1 }].concat(b.id ? [{ id: b.id, stacks: 1 }] : []);
    for (let vb = 0; vb <= 5; vb++) {
      const s = core.resolveStats(SHIP, owned, vb, 60);
      const mercy = Math.min(core.MAX_SHIELD_MERCY, Math.max(60, s.shieldIframes));
      assert.ok(s.shieldRegen > mercy,
        `${a.id} + ${b.id} at vb${vb}: regen ${s.shieldRegen} <= mercy ${mercy}`);
    }
  }));
});

test('the mercy window is capped however many cards stack', () => {
  assert.equal(core.MAX_SHIELD_MERCY, 90);
  const every = core.UPGRADES.filter(u => u.effect.shieldIframes).map(u => ({ id: u.id, stacks: 1 }));
  const s = core.resolveStats(SHIP, every, 5, 60);
  assert.ok(Math.min(core.MAX_SHIELD_MERCY, Math.max(60, s.shieldIframes)) <= core.MAX_SHIELD_MERCY);
});

test('repeated blocks give steadily less mercy, but never nothing', () => {
  const base = core.MAX_SHIELD_MERCY;
  let prev = Infinity;
  for (let streak = 0; streak < 12; streak++) {
    const m = core.mercyFor(base, streak);
    assert.ok(m <= prev, `streak ${streak} gave more than ${streak - 1}`);
    assert.ok(m >= core.MERCY_FLOOR, `streak ${streak} fell below the floor`);
    prev = m;
  }
  assert.equal(core.mercyFor(base, 0), base, 'a first block is untouched');
});

test('grace is a breath, not a nap', () => {
  assert.equal(core.MAX_GRACE_SECONDS, 2.5);
  const every = core.UPGRADES.filter(u => u.effect.graceSeconds).map(u => ({ id: u.id, stacks: 1 }));
  assert.ok(core.resolveStats(SHIP, every, 5, 60).graceSeconds <= core.MAX_GRACE_SECONDS);
});

test('lives from kills are capped, and so are lives', () => {
  assert.equal(core.MAX_LIVES_FROM_KILLS, 3);
  assert.equal(core.MAX_LIVES, 9);
  assert.ok(core.MAX_LIVES_FROM_KILLS < core.MAX_LIVES);
});

// ---------------------------------------------------------------------------
// BOSS ROSTER COMPLETENESS
// ---------------------------------------------------------------------------
// The whole point of the roster is that every named boss is hand-built. A
// table entry silently falling through to BOSS.generic would be a recolour
// wearing a name, which is exactly what this expansion exists to avoid.

test('every boss in the table has its own registry entry, not the fallback', () => {
  const html = readFileSync(HTML, 'utf8');
  const keys = new Set([...html.matchAll(/BOSS\.([a-zA-Z0-9_]+)\s*=\s*\{/g)].map(m => m[1]));
  assert.ok(keys.has('generic'), 'the fallback should still exist');
  for (const b of core.BOSS_TABLE) {
    assert.ok(keys.has(b.key), `${b.name} (${b.key}) has no bespoke BOSS entry`);
  }
  assert.ok(keys.has('armada'), 'the ARMADA composite needs its own entry too');
});

test('every registry entry supplies the two required hooks', () => {
  const html = readFileSync(HTML, 'utf8');
  // Each block runs from `BOSS.key = {` to the start of the next definition.
  const marks = [...html.matchAll(/BOSS\.([a-zA-Z0-9_]+)\s*=\s*\{/g)];
  marks.forEach((m, i) => {
    const body = html.slice(m.index, i + 1 < marks.length ? marks[i + 1].index : m.index + 20000);
    assert.match(body, /\bthink\s*[:(]/, `BOSS.${m[1]} has no think()`);
    assert.match(body, /\bpaint\s*[:(]/, `BOSS.${m[1]} has no paint()`);
  });
});

// ---------------------------------------------------------------------------
// 15. Waypoints
// ---------------------------------------------------------------------------
// Reach a checkpoint five times and you may start there. Capped at level 40:
// past that the run has to be earned, and each one hands you a starting build
// because arriving at level 40 with nothing is a death sentence, not a
// shortcut.

test('there are four waypoints and none is past level 40', () => {
  assert.equal(core.WAYPOINTS.length, 4);
  assert.deepEqual(core.WAYPOINTS.map(w => w.level), [10, 20, 30, 40]);
  core.WAYPOINTS.forEach(w => {
    assert.ok(w.level <= core.MAX_WAYPOINT_LEVEL, `${w.level} is past the cap`);
    assert.equal(w.needed, 5, 'five arrivals, as the brief says');
  });
});

test('the grants are 5, 10, 20, 20', () => {
  assert.deepEqual(core.WAYPOINTS.map(w => w.grants), [5, 10, 20, 20]);
});

test('every waypoint is a level a boss actually sits on', () => {
  core.WAYPOINTS.forEach(w => {
    assert.equal(core.isBossLevel(w.level), true, `level ${w.level}`);
  });
});

test('a waypoint needs exactly five arrivals, and never regresses', () => {
  let p = {};
  for (let i = 1; i <= 4; i++) {
    const r = core.recordWaypoint(p, 20);
    p = r.progress;
    assert.equal(r.unlocked, false, `arrival ${i} should not unlock it`);
    assert.equal(core.waypointUnlocked(p, 20), false);
  }
  const fifth = core.recordWaypoint(p, 20);
  assert.equal(fifth.unlocked, true, 'the fifth arrival unlocks it');
  assert.equal(core.waypointUnlocked(fifth.progress, 20), true);
});

test('recording never mutates the map it was given', () => {
  const before = { 10: 2 };
  const r = core.recordWaypoint(before, 10);
  assert.deepEqual(before, { 10: 2 }, 'the caller\'s map must be untouched');
  assert.equal(r.progress[10], 3);
});

test('an already-unlocked waypoint stops counting', () => {
  const p = { 10: 5 };
  const r = core.recordWaypoint(p, 10);
  assert.equal(r.unlocked, false, 'it was already unlocked; this is not a new unlock');
  assert.equal(r.progress[10], 5, 'and the count does not run away');
});

test('a level with no waypoint records nothing', () => {
  const r = core.recordWaypoint({}, 17);
  assert.deepEqual(r.progress, {});
  assert.equal(r.unlocked, false);
  assert.equal(core.waypointAt(17), null);
  assert.equal(core.waypointUnlocked({ 17: 99 }, 17), false);
});

test('unlockedWaypoints lists only what has been earned, in order', () => {
  assert.deepEqual(core.unlockedWaypoints({}).map(w => w.level), []);
  assert.deepEqual(core.unlockedWaypoints({ 20: 5, 40: 5 }).map(w => w.level), [20, 40]);
  assert.deepEqual(core.unlockedWaypoints({ 20: 4 }).map(w => w.level), [], 'four is not five');
});

test('waypoint lookups survive a missing or junk progress map', () => {
  [undefined, null, {}, 'nonsense', 42].forEach(bad => {
    assert.equal(core.waypointUnlocked(bad, 10), false, JSON.stringify(bad));
    assert.deepEqual(core.unlockedWaypoints(bad), []);
  });
});

// ---------------------------------------------------------------------------
// 16. Level pacing
// ---------------------------------------------------------------------------

test('a level is half the length it used to be, and shorter with depth', () => {
  assert.equal(core.BASE_LEVEL_SECONDS, 12, 'was 24');
  assert.equal(core.levelSecondsAt(1), 12);
  assert.ok(core.levelSecondsAt(100) < core.levelSecondsAt(1), 'later levels are shorter');
  assert.equal(core.levelSecondsAt(2500), core.MIN_LEVEL_SECONDS, 'and it floors');
});

test('level length never increases and never hits zero', () => {
  let prev = Infinity;
  for (let lv = 1; lv <= 3000; lv += 3) {
    const t = core.levelSecondsAt(lv);
    assert.ok(t <= prev, `level ${lv} got longer`);
    assert.ok(t >= core.MIN_LEVEL_SECONDS, `level ${lv} fell below the floor`);
    prev = t;
  }
});

// ---------------------------------------------------------------------------
// 17. The charge line
// ---------------------------------------------------------------------------
// Holding fire used to be one fixed mechanic every ship had identically. These
// cards make it something you build toward.

test('a bare ship has a neutral charge profile', () => {
  const s = core.resolveStats(SHIP, [], 0, 1);
  assert.equal(s.chargeSpeed, 1, 'no card means no speed-up, not zero speed');
  assert.equal(s.chargePower, 1, 'and no damage multiplier, not zero damage');
  assert.equal(s.chargeSpread, 0);
  assert.equal(s.chargeSplash, 0);
  assert.equal(s.chargeAuto, false);
});

// chargeSpeed and chargePower are MULTIPLIERS with a base of 1. If either ever
// resolved to 0 the lance would never wind up, or would do nothing at all.
test('the charge multipliers can never resolve below one', () => {
  const cards = core.UPGRADES.filter(u =>
    u.effect.chargeSpeed !== undefined || u.effect.chargePower !== undefined);
  cards.forEach(u => {
    for (let vb = 0; vb <= 5; vb++) {
      const s = core.resolveStats(SHIP, [{ id: u.id, stacks: 1 }], vb, 1);
      assert.ok(s.chargeSpeed >= 1, `${u.id} drove chargeSpeed to ${s.chargeSpeed}`);
      assert.ok(s.chargePower >= 1, `${u.id} drove chargePower to ${s.chargePower}`);
    }
  });
});

test('the charge line spans the ladder from COMMON to OVERCLOCKED', () => {
  const charge = core.UPGRADES.filter(u =>
    Object.keys(u.effect).some(k => k.indexOf('charge') === 0));
  assert.ok(charge.length >= 15, `only ${charge.length} charge cards`);
  const tiers = new Set(charge.map(u => u.tier));
  ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC', 'APEX', 'OVERCLOCKED']
    .forEach(t => assert.ok(tiers.has(t), `nothing in the charge line at ${t}`));
});

test('charge cards stack the way their wording implies', () => {
  const two = core.resolveStats(SHIP,
    [{ id: 'ch_coil', stacks: 1 }, { id: 'ch_bank', stacks: 1 }], 0, 1);
  close(two.chargeSpeed, 1 + 0.25 + 0.50, 'speed-ups add');
  const dmg = core.resolveStats(SHIP,
    [{ id: 'ch_tap', stacks: 1 }, { id: 'ch_heavy', stacks: 1 }], 0, 1);
  close(dmg.chargePower, 1 + 0.30 + 0.70, 'damage bonuses add');
  const spread = core.resolveStats(SHIP,
    [{ id: 'ch_prism', stacks: 1 }, { id: 'ch_fan', stacks: 1 }], 0, 1);
  assert.equal(spread.chargeSpread, 3, 'escorts add');
});

test('AUTOLOADER and THE SPEAR both set the auto flag', () => {
  ['ch_autoload', 'ch_perpetual', 'ch_singular'].forEach(id => {
    assert.equal(core.resolveStats(SHIP, [{ id, stacks: 1 }], 0, 1).chargeAuto, true, id);
  });
});

test('splash takes the best source rather than adding', () => {
  const s = core.resolveStats(SHIP,
    [{ id: 'ch_burst', stacks: 1 }, { id: 'ch_detonate', stacks: 1 }], 0, 1);
  assert.equal(s.chargeSplash, 120, 'the larger head wins; they do not sum');
});

// ---------------------------------------------------------------------------
// 20. Pause
// ---------------------------------------------------------------------------
// PAUSE and SETTINGS used to be the same action on two keys. They are separate
// now, which means an older save has 'p' bound to the settings panel and would
// open it instead of pausing — with nothing on screen to explain why.

test('pause and settings are separate actions with separate defaults', () => {
  assert.ok(core.BIND_ORDER.indexOf('pauseGame') !== -1, 'pauseGame is not bindable');
  assert.deepEqual(core.DEFAULT_BINDS.pauseGame, ['p']);
  assert.deepEqual(core.DEFAULT_BINDS.pause, ['Escape']);
  assert.equal(core.DEFAULT_BINDS.pause.indexOf('p'), -1, "'p' must not also open settings");
  assert.ok(core.BIND_LABELS.pauseGame, 'the settings screen needs a label for it');
});

test('no two actions share a default key', () => {
  const seen = new Map();
  core.BIND_ORDER.forEach(action => {
    core.DEFAULT_BINDS[action].forEach(k => {
      assert.ok(!seen.has(k), `"${k}" is bound to both ${seen.get(k)} and ${action}`);
      seen.set(k, action);
    });
  });
});

test("an older save stops using 'p' for settings", () => {
  [4, 5].forEach(version => {
    const { data } = core.migrateSave(
      { version, settings: { binds: { pause: ['Escape', 'p'] } } }, DEFAULTS());
    assert.equal(data.settings.binds.pause.indexOf('p'), -1,
      `v${version} kept 'p' on the settings panel`);
    assert.deepEqual(data.settings.binds.pauseGame, ['p'], `v${version} pauseGame`);
  });
});

test('vertical movement is gone, not silently dead', () => {
  // The ship flies at a fixed height by design. MOVE UP and MOVE DOWN were
  // rebindable rows that nothing ever read — and MOVE DOWN's default 's' also
  // collided with SKIP SHOP.
  ['up', 'down'].forEach(a => {
    assert.equal(core.BIND_ORDER.indexOf(a), -1, `${a} is still bindable`);
    assert.equal(core.DEFAULT_BINDS[a], undefined, `${a} still has a default`);
    assert.equal(core.BIND_LABELS[a], undefined, `${a} still has a label`);
  });
});

test('a save that had rebound pause to something else keeps it', () => {
  const { data } = core.migrateSave(
    { version: 5, settings: { binds: { pause: ['Tab'] } } }, DEFAULTS());
  assert.deepEqual(data.settings.binds.pause, ['Tab']);
});

test("a save with ONLY 'p' on pause falls back rather than being left unbound", () => {
  const { data } = core.migrateSave(
    { version: 5, settings: { binds: { pause: ['p'] } } }, DEFAULTS());
  assert.ok(data.settings.binds.pause.length > 0, 'settings became unreachable');
  assert.deepEqual(data.settings.binds.pause, core.DEFAULT_BINDS.pause);
});

// ---------------------------------------------------------------------------
// 21. The cost of a build
// ---------------------------------------------------------------------------
// Prices were flat forever while income scaled with depth, so a level at 22
// paid for a hundred commons. The result was a hundred-upgrade build and a
// screen so full of the player's own bullets that nothing could reach them.

test('every upgrade owned makes the next one dearer', () => {
  assert.ok(core.PRICE_GROWTH > 1);
  let prev = 0;
  for (let owned = 0; owned <= 60; owned++) {
    const p = core.priceFor('RARE', 0, owned);
    assert.ok(p > prev, `price did not rise at ${owned} owned`);
    prev = p;
  }
  assert.equal(core.priceFor('RARE', 0, 0), core.tierOf('RARE').price, 'the first card is full price');
});

test('a big build prices itself out long before a hundred cards', () => {
  const income = 40 * core.scrapForKill(160, 1, 30) + 400;
  // At forty owned, one EPIC should cost several levels of income.
  assert.ok(core.priceFor('EPIC', 0, 40) > income * 4,
    'forty upgrades in, an EPIC is still casually affordable');
});

test('buildSize counts stacks, not entries', () => {
  assert.equal(core.buildSize([]), 0);
  assert.equal(core.buildSize([{ id: 'a', stacks: 3 }, { id: 'b', stacks: 2 }]), 5);
  assert.equal(core.buildSize(undefined), 0);
});

test('the discount still works, and still cannot make things free', () => {
  const full = core.priceFor('EPIC', 0, 10);
  const cut = core.priceFor('EPIC', 0.5, 10);
  assert.ok(cut < full && cut > 0);
  assert.ok(core.priceFor('COMMON', 5, 0) >= 1, 'a silly discount must not zero a price');
});

test('the gun has a hard ceiling however many cards stack', () => {
  assert.equal(core.MAX_EXTRA_SHOTS, 7);
  assert.equal(core.MAX_RICOCHET, 2);
  const every = core.UPGRADES
    .filter(u => u.effect.extraShots || u.effect.ricochet)
    .map(u => ({ id: u.id, stacks: core.tierOf(u.tier).stackLimit }));
  for (let vb = 0; vb <= 5; vb++) {
    const s = core.resolveStats(SHIP, every, vb, 60);
    assert.ok(s.extraShots <= core.MAX_EXTRA_SHOTS, `extraShots ${s.extraShots} at vb${vb}`);
    assert.ok(s.ricochet <= core.MAX_RICOCHET, `ricochet ${s.ricochet} at vb${vb}`);
  }
});

test('buildShots clamps its own input, whatever it is handed', () => {
  assert.equal(core.buildShots({ extraShots: 999, spread: 1 }).length, 2 + core.MAX_EXTRA_SHOTS);
  assert.equal(core.buildShots({ extraShots: -5, spread: 1 }).length, 2);
});

test('no build can put more than a readable number of bullets in a volley', () => {
  const every = core.UPGRADES
    .filter(u => u.effect.extraShots || u.effect.rear || u.effect.sides || u.effect.twinCore)
    .map(u => ({ id: u.id, stacks: core.tierOf(u.tier).stackLimit }));
  const shots = core.buildShots(core.resolveStats(SHIP, every, 5, 60));
  assert.ok(shots.length <= 30, `${shots.length} bullets a volley is a curtain, not a gun`);
});
