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

const SHIP = { fireMul: 1, speed: 5, spreadMul: 1 };
const TIER_IDS = core.TIERS.map(t => t.id);

const DEFAULTS = () => ({
  version: 3, hiScore: 0, bestLevel: 1, totalRuns: 0, totalKills: 0,
  credits: 0, unlocked: ['vanguard'], selectedShip: 'vanguard', muted: false,
  bestScrapSpent: 0, apexFound: 0,
  voidbirths: 0, bestVoidbirth: 0, tiersFound: {}, bossesKilled: {}
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

test('SAVE_VERSION is 3, as the spec requires', () => {
  assert.equal(core.SAVE_VERSION, 3);
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
  assert.equal(data.version, 3);
  assert.equal(data.voidbirths, 0);
  assert.equal(data.bestVoidbirth, 0);
  assert.deepEqual(data.tiersFound, {});
  assert.deepEqual(data.bossesKilled, {});
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

test('there are exactly eleven tiers', () => {
  assert.equal(core.TIERS.length, 11);
  assert.equal(core.MAX_TIER_INDEX, 10);
});

test('the tiers appear in the documented order COMMON…DYNACLOCKED', () => {
  assert.deepEqual(TIER_IDS, SPEC_TIERS.map(t => t[0]));
});

test('every tier price matches the spec price table', () => {
  SPEC_TIERS.forEach(([id, price]) => {
    assert.equal(core.tierOf(id).price, price, `${id} price`);
  });
});

test('tier prices are strictly increasing up the ladder', () => {
  for (let i = 1; i < core.TIERS.length; i++) {
    assert.ok(core.TIERS[i].price > core.TIERS[i - 1].price,
      `${core.TIERS[i].id} (${core.TIERS[i].price}) must cost more than ${core.TIERS[i - 1].id}`);
  }
});

test('every tier stack limit matches the spec', () => {
  SPEC_TIERS.forEach(([id, , stacks]) => {
    assert.equal(core.tierOf(id).stackLimit, stacks, `${id} stackLimit`);
  });
});

test('stack limits never increase as the ladder rises', () => {
  for (let i = 1; i < core.TIERS.length; i++) {
    assert.ok(core.TIERS[i].stackLimit <= core.TIERS[i - 1].stackLimit,
      `${core.TIERS[i].id} stacks more than the tier below it`);
  }
});

test('tierIndexOf and tierOf round-trip for every tier', () => {
  core.TIERS.forEach((t, i) => {
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
  core.TIERS.forEach(t => {
    assert.match(t.color, /^#[0-9a-f]{6}$/i, `${t.id} color`);
    assert.match(t.color2, /^#[0-9a-f]{6}$/i, `${t.id} color2`);
  });
});

test('tier ids are unique', () => {
  assert.equal(new Set(TIER_IDS).size, core.TIERS.length);
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
  assert.equal(core.levelsIntoSegment(1, 0), 0);
  assert.equal(core.levelsIntoSegment(51, 1), 0, 'level 51 is the first level after VB1');
  assert.equal(core.levelsIntoSegment(101, 2), 0);
  assert.equal(core.levelsIntoSegment(201, 3), 0);
  assert.equal(core.levelsIntoSegment(351, 4), 0);
  assert.equal(core.levelsIntoSegment(501, 5), 0);
  const fresh = core.rarityWeights(51, 1);
  assert.equal(fresh.UNCOMMON, 51.5, 'the new floor tier must start undrifted');
});

test('levelsIntoSegment counts forward within a segment and never goes negative', () => {
  assert.equal(core.levelsIntoSegment(2, 0), 1);
  assert.equal(core.levelsIntoSegment(60, 1), 9);
  assert.equal(core.levelsIntoSegment(1, 5), 0, 'a level before the segment start clamps to 0');
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
    assert.equal(core.rollRarity(1, vb, () => 0), core.TIERS[vb].id);
    assert.equal(core.rollRarity(2500, vb, () => 0), core.TIERS[vb].id,
      'drift must not change which tier the very bottom of the range maps to');
  });
}

test('rollRarity with rnd() just under 1 returns the deepest reachable tier', () => {
  const deepest = ['OVERCLOCKED', 'HYPERCLOCKED', 'UBERCLOCKED',
    'DYNACLOCKED', 'DYNACLOCKED', 'DYNACLOCKED'];
  deepest.forEach((id, vb) => {
    assert.equal(core.rollRarity(1, vb, () => 0.999999), id, `voidbirth ${vb}`);
  });
});

test('rollRarity honours the tier boundaries of the cumulative distribution', () => {
  assert.equal(core.rollRarity(1, 0, () => 0.0), 'COMMON');
  assert.equal(core.rollRarity(1, 0, () => 0.514), 'COMMON');
  assert.equal(core.rollRarity(1, 0, () => 0.516), 'UNCOMMON');
  assert.equal(core.rollRarity(1, 0, () => 0.784), 'UNCOMMON');
  assert.equal(core.rollRarity(1, 0, () => 0.786), 'RARE');
  assert.equal(core.rollRarity(1, 0, () => 0.916), 'EPIC');
  assert.equal(core.rollRarity(1, 0, () => 0.978), 'LEGENDARY');
  assert.equal(core.rollRarity(1, 0, () => 0.993), 'MYTHIC');
  assert.equal(core.rollRarity(1, 0, () => 0.997), 'APEX');
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
  assert.equal(core.HP_EXPONENT, 0.92);
});

test('every enemy kind has the base HP the spec table gives it', () => {
  Object.keys(SPEC_ENEMY_HP).forEach(kind => {
    assert.equal(core.enemyHp(kind, 1), SPEC_ENEMY_HP[kind], kind);
  });
});

test('the enemy roster is exactly the ten kinds the spec lists', () => {
  assert.deepEqual(Object.keys(core.ENEMY_HP).sort(), Object.keys(SPEC_ENEMY_HP).sort());
});

test('enemyHp follows base * level^0.92 at levels 1/10/100/500/2500', () => {
  ['grunt', 'elite', 'swarmling', 'harbinger'].forEach(kind => {
    [1, 10, 100, 500, 2500].forEach(level => {
      const want = Math.max(1, Math.round(SPEC_ENEMY_HP[kind] * Math.pow(level, 0.92)));
      assert.equal(core.enemyHp(kind, level), want, `${kind} at level ${level}`);
    });
  });
});

test('a level-100 grunt is about 1,384 HP and an elite about 4,152, as the spec states', () => {
  assert.equal(core.enemyHp('grunt', 100), 1384);
  assert.equal(core.enemyHp('elite', 100), 4151);
});

test('the level-2500 grunt is far past the level-1 one but not absurd', () => {
  assert.ok(core.enemyHp('grunt', 2500) > 20000);
  assert.ok(core.enemyHp('grunt', 2500) < 40000);
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

test('meteorite classes appear at the levels the spec gives them', () => {
  const spec = [['ice', 1, 30], ['iron', 25, 120], ['obsidian', 100, 400],
    ['voidglass', 400, 1400], ['shard', 1000, 5000]];
  assert.equal(core.METEORS.length, 5);
  spec.forEach(([id, from, hp], i) => {
    assert.equal(core.METEORS[i].id, id);
    assert.equal(core.METEORS[i].from, from);
    assert.equal(core.METEORS[i].hp, hp);
    assert.ok(core.METEORS[i].behaviour.length > 0, `${id} needs a behaviour`);
  });
});

test('meteorsFor only ever offers classes the level has reached', () => {
  assert.deepEqual(core.meteorsFor(1).map(m => m.id), ['ice']);
  assert.deepEqual(core.meteorsFor(24).map(m => m.id), ['ice']);
  assert.deepEqual(core.meteorsFor(25).map(m => m.id), ['ice', 'iron']);
  assert.equal(core.meteorsFor(1000).length, 5);
  assert.equal(core.meteorsFor(0).length, 0);
});

// ---------------------------------------------------------------------------
// 5. The boss table
// ---------------------------------------------------------------------------

const SPEC_BOSSES = [
  [10, 'SCRAPJAW', 6600, 2], [20, 'HALO WARDEN', 14000, 3], [30, 'THE CHOIR', 21000, 3],
  [40, 'MAGNETAR', 30000, 3], [50, 'VOIDGATE PRIME', 38000, 4], [75, 'RUSTFALL', 62000, 3],
  [100, 'THE LONG SILENCE', 88000, 4], [150, 'HIVE EMPRESS', 148000, 4],
  [200, 'THE CARTOGRAPHER', 217000, 4], [250, 'NULLPOINT', 295000, 4],
  [300, 'SEVEN ANGLES', 381000, 5], [350, 'THE WIDOW', 474000, 4],
  [400, 'ASHEN CHOIRMASTER', 576000, 5], [500, 'THE THRESHOLD', 800000, 5],
  [750, 'PALE HERALD', 1500000, 5], [1000, 'IRON LITANY', 2300000, 6],
  [2500, 'THE DREADED SCOURGE OF HUMANITY — WARR MOTHERSHIP', 10000000, 7]
];

test('there are seventeen hand-built bosses', () => {
  assert.equal(core.BOSS_TABLE.length, 17);
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

test('the level-2500 Mothership is exactly 10,000,000 HP — the anchor of the curve', () => {
  const m = core.BOSS_TABLE.find(b => b.level === 2500);
  assert.equal(m.hp, 10000000);
  assert.equal(m.key, 'mothership');
  assert.equal(m.phases, 7);
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
    assert.ok(hp < 10000000, `level ${level} outguns the Mothership`);
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
  [[100, 88000], [500, 800000], [1000, 2300000]].forEach(([level, actual]) => {
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

test('shop cadence is 1/2/4/8/8/8 by voidbirth, exactly as the spec table says', () => {
  assert.deepEqual(core.SHOP_EVERY, [1, 2, 4, 8, 8, 8]);
  [1, 2, 4, 8, 8, 8].forEach((every, vb) => {
    assert.equal(core.shopEvery(vb), every, `voidbirth ${vb}`);
  });
});

test('shopEvery clamps rather than returning undefined for silly depths', () => {
  assert.equal(core.shopEvery(-1), 1);
  assert.equal(core.shopEvery(99), 8);
  assert.equal(core.shopEvery(undefined), 1);
});

test('at voidbirth 0 the shop opens after every single level', () => {
  for (let level = 1; level <= 60; level++) {
    assert.equal(core.shopOpensAfter(level, 0), true, `level ${level}`);
  }
});

test('at voidbirth 1 the shop opens on even levels', () => {
  assert.equal(core.shopOpensAfter(2, 1), true);
  assert.equal(core.shopOpensAfter(4, 1), true);
  assert.equal(core.shopOpensAfter(3, 1), false);
  assert.equal(core.shopOpensAfter(5, 1), false);
});

test('at voidbirth 2 the shop opens every fourth level', () => {
  assert.equal(core.shopOpensAfter(4, 2), true);
  assert.equal(core.shopOpensAfter(8, 2), true);
  assert.equal(core.shopOpensAfter(5, 2), false);
  assert.equal(core.shopOpensAfter(6, 2), false);
  assert.equal(core.shopOpensAfter(7, 2), false);
});

test('at voidbirth 3 and above the shop opens every eighth level', () => {
  [3, 4, 5].forEach(vb => {
    assert.equal(core.shopOpensAfter(16, vb), true, `vb ${vb}`);
    assert.equal(core.shopOpensAfter(17, vb), false, `vb ${vb}`);
    assert.equal(core.shopOpensAfter(22, vb), false, `vb ${vb}`);
  });
});

test('a shop always opens before a boss, whatever the cadence says', () => {
  // Level 9 at voidbirth 3: 9 % 8 !== 0, but SCRAPJAW is next.
  assert.equal(9 % core.shopEvery(3), 1, 'the cadence alone would keep this shop shut');
  assert.equal(core.shopOpensAfter(9, 3), true,
    'walking into a boss with no chance to prepare is a spike made of bookkeeping');
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

test('voidbirth happens at levels 50, 100, 200, 350 and 500', () => {
  assert.deepEqual(core.VOIDBIRTH_LEVELS, [50, 100, 200, 350, 500]);
  assert.equal(core.MAX_VOIDBIRTH, 5);
});

test('every voidbirth level is also a boss level — an ascension follows a summit', () => {
  core.VOIDBIRTH_LEVELS.forEach(level => {
    assert.equal(core.isBossLevel(level), true, `level ${level} is not a boss level`);
  });
});

test('isVoidbirthLevel and voidbirthIndexAt agree with the ladder', () => {
  core.VOIDBIRTH_LEVELS.forEach((level, i) => {
    assert.equal(core.isVoidbirthLevel(level), true);
    assert.equal(core.voidbirthIndexAt(level), i);
  });
  [1, 49, 51, 99, 201, 500 + 1, 2500].forEach(level => {
    assert.equal(core.isVoidbirthLevel(level), false, `level ${level}`);
    assert.equal(core.voidbirthIndexAt(level), -1);
  });
});

test('clearing a voidbirth level at the matching depth grants the ascension', () => {
  core.VOIDBIRTH_LEVELS.forEach((level, i) => {
    const vbirth = core.voidbirthAfterClearing(level, i);
    assert.notEqual(vbirth, null, `level ${level} at depth ${i}`);
    assert.equal(vbirth.to, i + 1);
    assert.equal(vbirth.numeral, core.ROMAN[i]);
  });
});

test('the roman numerals run I to V', () => {
  assert.deepEqual(core.ROMAN, ['I', 'II', 'III', 'IV', 'V']);
});

test('an ascension already taken is never granted twice', () => {
  // The whole point: clearing level 50 again at depth 1 must not push you to 2.
  assert.equal(core.voidbirthAfterClearing(50, 1), null);
  assert.equal(core.voidbirthAfterClearing(50, 2), null);
  assert.equal(core.voidbirthAfterClearing(100, 2), null);
  assert.equal(core.voidbirthAfterClearing(500, 5), null);
});

test('an ascension out of sequence is refused', () => {
  // Reaching level 200 while still at depth 0 must not skip you to depth 3.
  assert.equal(core.voidbirthAfterClearing(200, 0), null);
  assert.equal(core.voidbirthAfterClearing(100, 0), null);
  assert.equal(core.voidbirthAfterClearing(500, 0), null);
});

test('ordinary levels never grant an ascension', () => {
  [1, 49, 51, 99, 101, 199, 351, 501, 1000, 2500].forEach(level => {
    for (let vb = 0; vb <= 5; vb++) {
      assert.equal(core.voidbirthAfterClearing(level, vb), null, `level ${level} vb ${vb}`);
    }
  });
});

test('each ascension reports the tier it newly unlocks', () => {
  assert.equal(core.voidbirthAfterClearing(50, 0).unlocks, 'HYPERCLOCKED');
  assert.equal(core.voidbirthAfterClearing(100, 1).unlocks, 'UBERCLOCKED');
  assert.equal(core.voidbirthAfterClearing(200, 2).unlocks, 'DYNACLOCKED');
  assert.equal(core.voidbirthAfterClearing(350, 3).unlocks, null, 'there is nothing above DYNACLOCKED');
  assert.equal(core.voidbirthAfterClearing(500, 4).unlocks, null);
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
  assert.equal(core.LINEAGE_GROWTH, 2.2);
});

test('effectiveTier climbs one rung per voidbirth', () => {
  core.UPGRADES.forEach(u => {
    const base = core.tierIndexOf(u.tier);
    for (let vb = 0; vb <= 5; vb++) {
      const want = core.TIERS[Math.min(core.MAX_TIER_INDEX, base + vb)].id;
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
    const want = Math.round(0.06 * Math.pow(2.2, vb) * 100) / 100;
    assert.equal(core.effectiveEffect(u, vb).damageMul, want, `voidbirth ${vb}`);
  }
});

test('RELOAD COIL grows into a genuinely different upgrade, as the spec promises', () => {
  const u = core.byId('reload_coil');
  assert.equal(core.effectiveEffect(u, 0).fireRateMul, 0.05);
  assert.equal(core.effectiveEffect(u, 1).fireRateMul, 0.11, 'the spec calls VB1 +11%');
  assert.equal(core.effectiveEffect(u, 2).fireRateMul, 0.24, 'the spec calls VB2 +24%');
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

test('HUNTER ROUNDS is an APEX with the nerfed homing strength the spec demands', () => {
  const u = core.byId('hunter_rounds');
  assert.equal(u.tier, 'APEX', 'homing removes the most important skill in the game');
  assert.equal(u.effect.homing, 0.03);
});

test('TRACER ROUNDS took the vacated RARE slot and gives information, not aim', () => {
  const u = core.byId('tracer_rounds');
  assert.equal(u.tier, 'RARE');
  assert.equal(u.effect.tracer, true);
  assert.equal(u.effect.homing, undefined, 'a tracer must not quietly ship auto-aim');
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
  const u = core.rollSlot(1, 0, owned, scripted([0, 0]), []);
  assert.notEqual(u, null);
  assert.equal(u.tier, 'UNCOMMON',
    'a COMMON roll with every COMMON maxed must show better goods, not filler');
});

test('promotion walks up one tier at a time', () => {
  const owned = exhaust(['COMMON', 'UNCOMMON', 'RARE']);
  const u = core.rollSlot(1, 0, owned, scripted([0, 0]), []);
  assert.equal(u.tier, 'EPIC');
});

test('promotion stops below the three undriftable top positions', () => {
  const owned = exhaust(['COMMON', 'UNCOMMON', 'RARE', 'EPIC']);
  const u = core.rollSlot(1, 0, owned, scripted([0, 0]), []);
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
    const u = core.rollSlot(1, 0, owned, scripted([0, rnd()]), []);
    assert.equal(u, null, `promotion leaked into ${u && u.tier}`);
  }
});

test('a roll that lands directly on MYTHIC is still honoured', () => {
  // 0.994 * 100 = 99.4, which falls inside the MYTHIC band at voidbirth 0.
  const u = core.rollSlot(1, 0, [], scripted([0.994, 0]), []);
  assert.equal(u.tier, 'MYTHIC', 'a direct roll into the top three is not blocked, only promotion is');
});

test('promotion at voidbirth 3 stops three rungs below the top of the shifted vector', () => {
  // At voidbirth 3 the floor is EPIC and the undriftable trio is
  // HYPER/UBER/DYNACLOCKED, so promotion may reach OVERCLOCKED and no further.
  const maxed = core.UPGRADES
    .filter(u => ['EPIC', 'LEGENDARY', 'MYTHIC', 'APEX'].indexOf(core.effectiveTier(u, 3)) !== -1)
    .map(u => ({ id: u.id, stacks: core.tierOf(core.effectiveTier(u, 3)).stackLimit }));
  const u = core.rollSlot(1, 3, maxed, scripted([0, 0]), []);
  assert.equal(u && core.effectiveTier(u, 3), 'OVERCLOCKED');
});

test('when nothing above is available the slot falls back downward', () => {
  // Roll straight into OVERCLOCKED with every OVERCLOCKED upgrade already owned.
  const owned = exhaust(['OVERCLOCKED']);
  const u = core.rollSlot(1, 0, owned, scripted([0.999999, 0]), []);
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
  const s = core.resolveStats(SHIP, [], 0);
  assert.equal(s.damage, core.BASE_DAMAGE);
  assert.equal(s.fireRate, core.BASE_FIRE_RATE * SHIP.fireMul);
  assert.equal(s.speed, SHIP.speed);
  assert.equal(s.spread, SHIP.spreadMul);
  assert.equal(s.hitScale, 1);
  assert.equal(s.bulletSpeedMul, 1);
  assert.equal(s.scrapMul, 1);
  assert.equal(s.enemyBulletMul, 1);
  assert.equal(s.shopSlots, core.BASE_SHOP_SLOTS);
  assert.equal(s.strips, 1);
  assert.equal(s.critMul, 2);
});

test('with no upgrades every counter is zero and every flag is false', () => {
  const s = core.resolveStats(SHIP, [], 0);
  ['shieldCharges', 'extraShots', 'extraLives', 'scrapPerLevel', 'scrapPerSecond',
    'critChance', 'pierce', 'homing', 'splash', 'burn', 'chill', 'ricochet',
    'execute', 'verdict', 'shieldRegen', 'drones', 'chain', 'fortress',
    'singularityCount', 'chronostall', 'priceDiscount', 'freeRerolls', 'aimCone']
    .forEach(k => assert.equal(s[k], 0, `${k} should start at 0`));
  ['split', 'rear', 'sides', 'tracer', 'thorns', 'needle', 'noStrip',
    'dronesCopyGun', 'phaseDrive', 'twinCore', 'apotheosis', 'singularity']
    .forEach(k => assert.equal(s[k], false, `${k} should start false`));
});

test('the ship fireMul sets the baseline interval', () => {
  assert.equal(core.resolveStats({ fireMul: 0.7, speed: 5, spreadMul: 1 }, [], 0).fireRate, 7);
  assert.equal(core.resolveStats({ fireMul: 1.3, speed: 5, spreadMul: 1 }, [], 0).fireRate, 13);
});

test('fire rate is an interval, so a bonus makes it smaller', () => {
  const base = core.resolveStats(SHIP, [], 0).fireRate;
  const one = core.resolveStats(SHIP, [{ id: 'reload_coil', stacks: 1 }], 0).fireRate;
  assert.ok(one < base, 'a fire-rate bonus must shorten the interval');
  close(one, 10 / 1.05);
});

test('fire rate bonuses add before they divide, and scale with stacks', () => {
  const s = core.resolveStats(SHIP, [{ id: 'reload_coil', stacks: 3 }], 0);
  close(s.fireRate, 10 / 1.15);
  const s2 = core.resolveStats(SHIP,
    [{ id: 'reload_coil', stacks: 2 }, { id: 'twin_feed', stacks: 1 }], 0);
  close(s2.fireRate, 10 / 1.20);
});

test('fire rate is floored at MIN_FIRE_RATE so aiming never stops mattering', () => {
  assert.equal(core.MIN_FIRE_RATE, 6, 'the spec raised the floor from 4 frames to 6');
  const s = core.resolveStats(SHIP,
    [{ id: 'reload_coil', stacks: 5 }, { id: 'twin_feed', stacks: 5 }], 0);
  assert.equal(s.fireRate, core.MIN_FIRE_RATE);
  const absurd = core.resolveStats(SHIP,
    [{ id: 'reload_coil', stacks: 5 }, { id: 'twin_feed', stacks: 5 },
      { id: 'reload_sing', stacks: 1 }], 5);
  assert.equal(absurd.fireRate, core.MIN_FIRE_RATE, 'no build becomes a solid beam');
});

test('damage multipliers add across stacks and across upgrades', () => {
  close(core.resolveStats(SHIP, [{ id: 'heavy_rounds', stacks: 1 }], 0).damage, 10.6);
  close(core.resolveStats(SHIP, [{ id: 'heavy_rounds', stacks: 3 }], 0).damage, 11.8);
  close(core.resolveStats(SHIP,
    [{ id: 'heavy_rounds', stacks: 2 }, { id: 'ap_rounds', stacks: 1 }], 0).damage, 12.4);
});

test('stat resolution scales with voidbirth depth', () => {
  const at0 = core.resolveStats(SHIP, [{ id: 'heavy_rounds', stacks: 1 }], 0).damage;
  const at1 = core.resolveStats(SHIP, [{ id: 'heavy_rounds', stacks: 1 }], 1).damage;
  const at3 = core.resolveStats(SHIP, [{ id: 'heavy_rounds', stacks: 1 }], 3).damage;
  close(at1, 10 * 1.13);
  assert.ok(at1 > at0 && at3 > at1, 'the same upgrade must be worth more the deeper you are');
});

test('shield charges are capped at MAX_SHIELD_CHARGES', () => {
  assert.equal(core.MAX_SHIELD_CHARGES, 4, 'the spec caps shields at 4');
  assert.equal(core.resolveStats(SHIP, [{ id: 'plating', stacks: 2 }], 0).shieldCharges, 2);
  assert.equal(core.resolveStats(SHIP, [{ id: 'plating', stacks: 5 }], 0).shieldCharges, 4);
  assert.equal(core.resolveStats(SHIP, [{ id: 'uc_phalanx', stacks: 1 }], 0).shieldCharges, 4);
  assert.equal(core.resolveStats(SHIP,
    [{ id: 'plating', stacks: 5 }, { id: 'aegis_lattice', stacks: 1 }], 0).shieldCharges, 4);
});

test('REPAIR KIT cannot contribute more than the spec cap of +2 lives', () => {
  assert.equal(core.REPAIR_KIT_MAX, 2);
  assert.equal(core.resolveStats(SHIP, [{ id: 'repair_kit', stacks: 1 }], 0).extraLives, 1);
  assert.equal(core.resolveStats(SHIP, [{ id: 'repair_kit', stacks: 2 }], 0).extraLives, 2);
  assert.equal(core.resolveStats(SHIP, [{ id: 'repair_kit', stacks: 5 }], 0).extraLives, 2);
});

test('IMMORTAL ENGINE stacks on top of the REPAIR KIT cap, not inside it', () => {
  const s = core.resolveStats(SHIP,
    [{ id: 'repair_kit', stacks: 5 }, { id: 'immortal', stacks: 1 }], 0);
  assert.equal(s.extraLives, 3);
  const u = core.resolveStats(SHIP,
    [{ id: 'repair_kit', stacks: 5 }, { id: 'dc_undying', stacks: 1 }], 0);
  assert.equal(u.extraLives, 5, 'UNDYING grants three on top of the repair-kit ceiling');
});

test('APOTHEOSIS doubles summed numeric stats', () => {
  const plain = core.resolveStats(SHIP, [{ id: 'heavy_rounds', stacks: 1 }], 0);
  const doubled = core.resolveStats(SHIP,
    [{ id: 'heavy_rounds', stacks: 1 }, { id: 'dc_apotheosis', stacks: 1 }], 0);
  close(plain.damage, 10.6);
  close(doubled.damage, 11.2, 'every stat you own counts twice');
  assert.equal(doubled.apotheosis, true);
  assert.equal(plain.apotheosis, false);
});

test('APOTHEOSIS does not double booleans into something meaningless', () => {
  const s = core.resolveStats(SHIP,
    [{ id: 'split_shot', stacks: 1 }, { id: 'rear_cannon', stacks: 1 },
      { id: 'dc_apotheosis', stacks: 1 }], 0);
  assert.equal(s.split, true);
  assert.equal(s.rear, true);
  assert.equal(typeof s.split, 'boolean');
  assert.equal(typeof s.rear, 'boolean');
});

test('APOTHEOSIS doubles shots and drones, which are counted not flagged', () => {
  const plain = core.resolveStats(SHIP,
    [{ id: 'wide_mount', stacks: 2 }, { id: 'orbital_drone', stacks: 1 }], 0);
  const doubled = core.resolveStats(SHIP,
    [{ id: 'wide_mount', stacks: 2 }, { id: 'orbital_drone', stacks: 1 },
      { id: 'dc_apotheosis', stacks: 1 }], 0);
  assert.equal(plain.extraShots, 2);
  assert.equal(doubled.extraShots, 4);
  assert.equal(plain.drones, 1);
  assert.equal(doubled.drones, 2);
});

test('critChance is clamped at 1 however hard the build pushes', () => {
  const s = core.resolveStats(SHIP,
    [{ id: 'targeting_fin', stacks: 5 }, { id: 'hardened_hull', stacks: 5 },
      { id: 'deadeye', stacks: 1 }, { id: 'dc_apotheosis', stacks: 1 }], 0);
  assert.equal(s.critChance, 1);
  close(core.resolveStats(SHIP, [{ id: 'targeting_fin', stacks: 2 }], 0).critChance, 0.06);
});

test('priceDiscount is clamped at 60%', () => {
  close(core.resolveStats(SHIP, [{ id: 'war_chest', stacks: 1 }], 0).priceDiscount, 0.12);
  close(core.resolveStats(SHIP, [{ id: 'war_chest', stacks: 3 }], 0).priceDiscount, 0.36);
  assert.equal(core.resolveStats(SHIP,
    [{ id: 'war_chest', stacks: 3 }, { id: 'dc_apotheosis', stacks: 1 }], 0).priceDiscount, 0.6);
});

test('hitScale is floored at 0.4 so a hitbox never disappears', () => {
  close(core.resolveStats(SHIP, [{ id: 'ablative_trim', stacks: 2 }], 0).hitScale, 0.92);
  const tiny = core.resolveStats(SHIP,
    [{ id: 'ablative_trim', stacks: 5 }, { id: 'evasion', stacks: 5 },
      { id: 'dc_apotheosis', stacks: 1 }], 0);
  assert.equal(tiny.hitScale, 0.4);
});

test('enemyBulletMul is floored at 0.25 so bullets never stop moving', () => {
  close(core.resolveStats(SHIP, [{ id: 'time_dilation', stacks: 1 }], 0).enemyBulletMul, 0.7);
  assert.equal(core.resolveStats(SHIP, [{ id: 'time_dilation', stacks: 1 }], 2).enemyBulletMul, 0.25);
});

test('the max() combinator reads the raw effect value, not a sum and not zero', () => {
  const s = core.resolveStats(SHIP, [{ id: 'overcharge', stacks: 3 }], 0);
  assert.equal(s.overcharge, 5, 'max() must ignore stack count');
  assert.equal(core.resolveStats(SHIP, [{ id: 'chain', stacks: 1 }], 0).chain, 2);
  assert.equal(core.resolveStats(SHIP, [{ id: 'flak_burst', stacks: 1 }], 0).splash, 30);
  assert.equal(core.resolveStats(SHIP, [{ id: 'incendiary', stacks: 1 }], 0).burn, 0.4);
  assert.equal(core.resolveStats(SHIP, [{ id: 'cryo_rounds', stacks: 1 }], 0).chill, 0.35);
  assert.equal(core.resolveStats(SHIP, [{ id: 'hunter_rounds', stacks: 1 }], 0).homing, 0.03);
});

test('max() picks the stronger of two competing upgrades', () => {
  const s = core.resolveStats(SHIP,
    [{ id: 'executioner', stacks: 1 }, { id: 'dc_lastword', stacks: 1 }], 0);
  assert.equal(s.execute, 0.40, 'THE LAST WORD must not be dragged down by EXECUTIONER');
});

test('drones sum across upgrades but chain does not', () => {
  const s = core.resolveStats(SHIP,
    [{ id: 'orbital_drone', stacks: 1 }, { id: 'mirror_drones', stacks: 1 }], 0);
  assert.equal(s.drones, 3);
  assert.equal(s.dronesCopyGun, true);
});

test('singularityCount is zero without a singularity and 3 with EVENT HORIZON', () => {
  assert.equal(core.resolveStats(SHIP, [], 0).singularityCount, 0);
  assert.equal(core.resolveStats(SHIP, [{ id: 'singularity', stacks: 1 }], 0).singularityCount, 1);
  const eh = core.resolveStats(SHIP, [{ id: 'uc_eventhorizon', stacks: 1 }], 0);
  assert.equal(eh.singularityCount, 3);
  assert.equal(eh.singularity, true);
});

test('the shop-slot and reroll upgrades feed straight into the stats', () => {
  assert.equal(core.resolveStats(SHIP, [{ id: 'fourth_slot', stacks: 1 }], 0).shopSlots, 4);
  assert.equal(core.resolveStats(SHIP, [{ id: 'free_reroll', stacks: 1 }], 0).freeRerolls, 1);
});

test('GREED ENGINE doubles scrap and doubles the strip penalty, as its card says', () => {
  const s = core.resolveStats(SHIP, [{ id: 'greed', stacks: 1 }], 0);
  assert.equal(s.scrapMul, 2);
  assert.equal(s.strips, 2);
});

test('every boolean flag in the catalogue reaches the stats when owned', () => {
  const flags = {
    split_shot: 'split', rear_cannon: 'rear', side_pods: 'sides', tracer_rounds: 'tracer',
    thorns: 'thorns', oc_needle: 'needle', hc_absolution: 'noStrip',
    twin_core: 'twinCore', phase_drive: 'phaseDrive', singularity: 'singularity'
  };
  Object.keys(flags).forEach(id => {
    const s = core.resolveStats(SHIP, [{ id, stacks: 1 }], 0);
    assert.equal(s[flags[id]], true, `${id} did not set ${flags[id]}`);
  });
});

test('an unknown upgrade in the owned list is ignored rather than crashing', () => {
  const s = core.resolveStats(SHIP,
    [{ id: 'ghost_upgrade', stacks: 3 }, { id: 'heavy_rounds', stacks: 1 }], 0);
  close(s.damage, 10.6);
});

test('scrap multipliers accumulate across both scrap upgrades', () => {
  const s = core.resolveStats(SHIP,
    [{ id: 'scrap_magnet', stacks: 2 }, { id: 'salvage_rig', stacks: 1 }], 0);
  close(s.scrapMul, 1 + 0.16 + 0.16);
});

test('PHASE DRIVE is a self-contained flag with its own recharge period', () => {
  assert.ok(core.PHASE_DRIVE_FRAMES > 0);
  const on = core.resolveStats(SHIP, [{ id: 'phase_drive', stacks: 1 }], 0);
  assert.equal(on.phaseDrive, true);
  assert.equal('phaseBoost' in on, false, 'the old boost-gated key must be gone, not merely unused');
  assert.equal(core.byId('phase_drive').effect.phaseBoost, undefined);
  assert.equal(/boost/i.test(core.byId('phase_drive').desc), false);
});

test('resolveStats does not mutate the owned list it is given', () => {
  const owned = [Object.freeze({ id: 'heavy_rounds', stacks: 2 })];
  Object.freeze(owned);
  assert.doesNotThrow(() => core.resolveStats(SHIP, owned, 3));
  assert.equal(owned[0].stacks, 2);
});

// ---------------------------------------------------------------------------
// 11. stripCheapest / stripN
// ---------------------------------------------------------------------------

test('a hit removes the lowest-tier upgrade first', () => {
  const { owned, removed } = core.stripCheapest([
    { id: 'orbital_drone', stacks: 1 },   // LEGENDARY
    { id: 'piercing', stacks: 1 },        // RARE
    { id: 'reload_coil', stacks: 1 }      // COMMON
  ]);
  assert.equal(removed.id, 'reload_coil');
  assert.equal(removed.tier, 'COMMON');
  assert.equal(owned.length, 2);
  assert.equal(owned.some(o => o.id === 'reload_coil'), false);
});

test('cheap upgrades act as armour around an expensive build', () => {
  let owned = [{ id: 'orbital_drone', stacks: 1 }, { id: 'reload_coil', stacks: 3 }];
  for (let i = 0; i < 3; i++) owned = core.stripCheapest(owned).owned;
  assert.deepEqual(owned, [{ id: 'orbital_drone', stacks: 1 }],
    'three stacks of a common are three hits the drone does not take');
});

test('a tie on tier goes to the most recently acquired', () => {
  const { removed } = core.stripCheapest([
    { id: 'reload_coil', stacks: 1 },
    { id: 'thrusters', stacks: 1 },
    { id: 'plating', stacks: 1 }
  ]);
  assert.equal(removed.id, 'plating', 'the newest of the equal-tier upgrades goes first');
});

test('a tie on tier still prefers the later index when the earlier one has more stacks', () => {
  const { removed } = core.stripCheapest([
    { id: 'reload_coil', stacks: 5 },
    { id: 'heavy_rounds', stacks: 1 }
  ]);
  assert.equal(removed.id, 'heavy_rounds');
});

test('a stack is decremented rather than the whole entry removed', () => {
  const { owned, removed } = core.stripCheapest([{ id: 'reload_coil', stacks: 3 }]);
  assert.equal(removed.id, 'reload_coil');
  assert.deepEqual(owned, [{ id: 'reload_coil', stacks: 2 }]);
});

test('an entry disappears only when its last stack goes', () => {
  const { owned } = core.stripCheapest([{ id: 'reload_coil', stacks: 1 }]);
  assert.deepEqual(owned, []);
});

test('stripCheapest never mutates the array it was given', () => {
  const owned = [{ id: 'reload_coil', stacks: 3 }, { id: 'piercing', stacks: 1 }];
  const snapshot = JSON.parse(JSON.stringify(owned));
  const result = core.stripCheapest(owned);
  assert.deepEqual(owned, snapshot, 'the input list was rewritten in place');
  assert.notEqual(result.owned, owned);
});

test('stripCheapest never mutates the objects inside the array', () => {
  const owned = Object.freeze([
    Object.freeze({ id: 'reload_coil', stacks: 3 }),
    Object.freeze({ id: 'piercing', stacks: 1 })
  ]);
  assert.doesNotThrow(() => core.stripCheapest(owned));
  assert.equal(owned[0].stacks, 3);
});

test('stripping an empty build is safe', () => {
  const { owned, removed } = core.stripCheapest([]);
  assert.deepEqual(owned, []);
  assert.equal(removed, null);
});

test('a build made only of unknown ids strips nothing rather than crashing', () => {
  const { owned, removed } = core.stripCheapest([{ id: 'ghost', stacks: 2 }]);
  assert.equal(removed, null);
  assert.equal(owned.length, 1);
});

test('once the stackables are gone the lowest-tier unique goes next', () => {
  let owned = [{ id: 'orbital_drone', stacks: 1 }, { id: 'piercing', stacks: 1 }];
  const first = core.stripCheapest(owned);
  assert.equal(first.removed.id, 'piercing', 'RARE goes before LEGENDARY');
  const second = core.stripCheapest(first.owned);
  assert.equal(second.removed.id, 'orbital_drone');
  assert.deepEqual(second.owned, []);
});

test('stripN removes exactly n stacks', () => {
  const owned = [{ id: 'reload_coil', stacks: 3 }, { id: 'piercing', stacks: 1 }];
  const two = core.stripN(owned, 2);
  assert.deepEqual(two.owned, [{ id: 'reload_coil', stacks: 1 }, { id: 'piercing', stacks: 1 }]);
  const three = core.stripN(owned, 3);
  assert.deepEqual(three.owned, [{ id: 'piercing', stacks: 1 }]);
});

test('stripN reports the last thing it removed', () => {
  const { removed } = core.stripN(
    [{ id: 'reload_coil', stacks: 1 }, { id: 'piercing', stacks: 1 }], 2);
  assert.equal(removed.id, 'piercing');
});

test('stripN handles an empty list and never returns undefined', () => {
  const { owned, removed } = core.stripN([], 2);
  assert.deepEqual(owned, []);
  assert.equal(removed, null);
});

test('stripN cannot remove more than the build has', () => {
  const { owned } = core.stripN([{ id: 'reload_coil', stacks: 1 }], 9);
  assert.deepEqual(owned, []);
});

test('stripN with n below 1 still strips once', () => {
  assert.deepEqual(core.stripN([{ id: 'reload_coil', stacks: 2 }], 0).owned,
    [{ id: 'reload_coil', stacks: 1 }]);
});

test('stripN never mutates the array it was given', () => {
  const owned = [{ id: 'reload_coil', stacks: 3 }];
  const snapshot = JSON.parse(JSON.stringify(owned));
  core.stripN(owned, 2);
  assert.deepEqual(owned, snapshot);
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
  assert.equal(core.CREDIT_DIVISOR, 100);
  assert.equal(core.creditsForScore(0), 0);
  assert.equal(core.creditsForScore(99), 0, 'a score below the divisor earns nothing');
  assert.equal(core.creditsForScore(100), 1);
  assert.equal(core.creditsForScore(199), 1);
  assert.equal(core.creditsForScore(12400), 124);
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

test('scrapForKill follows the level^0.55 depth curve', () => {
  [1, 10, 100, 500, 2500].forEach(level => {
    assert.equal(core.scrapForKill(100, 1, level),
      Math.max(1, Math.round(100 * Math.pow(level, 0.55))), `level ${level}`);
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
  assert.deepEqual(core.ARC_KINDS, ['grunt', 'elite', 'lancer']);
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
  assert.equal(core.canFireAt('grunt', 15, core.ARC_HALF_ANGLE), true);
  assert.equal(core.canFireAt('grunt', 15, core.ARC_HALF_ANGLE + 1e-6), false);
});

test('the arc boundary is inclusive on the negative side', () => {
  assert.equal(core.canFireAt('grunt', 15, -core.ARC_HALF_ANGLE), true);
  assert.equal(core.canFireAt('grunt', 15, -core.ARC_HALF_ANGLE - 1e-6), false);
});

test('the arc is symmetric about straight down', () => {
  for (let a = 0; a <= 3; a += 0.05) {
    assert.equal(core.canFireAt('elite', 100, a), core.canFireAt('elite', 100, -a),
      `angle ${a} is not treated the same on both sides`);
  }
});

test('the level below the threshold is unrestricted and the threshold itself is not', () => {
  assert.equal(core.canFireAt('grunt', core.ARC_FROM_LEVEL - 1, 3), true);
  assert.equal(core.canFireAt('grunt', core.ARC_FROM_LEVEL, 3), false);
});
