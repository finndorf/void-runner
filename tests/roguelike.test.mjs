import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './extract.mjs';

test('pure block loads and exposes RLCore', () => {
  const core = loadCore();
  assert.equal(typeof core, 'object');
});

const DEFAULTS = () => ({
  version: 2, hiScore: 0, bestLevel: 1, totalRuns: 0, totalKills: 0,
  credits: 0, unlocked: ['vanguard'], selectedShip: 'vanguard', muted: false,
  bestScrapSpent: 0, apexFound: 0
});

test('a v1 save keeps its credits, ships and records', () => {
  const core = loadCore();
  const v1 = {
    version: 1, hiScore: 12400, bestLevel: 7, totalRuns: 31, totalKills: 900,
    credits: 4250, unlocked: ['vanguard', 'needle'], selectedShip: 'needle', muted: true
  };
  const { data, ok } = core.migrateSave(v1, DEFAULTS());
  assert.equal(ok, true);
  assert.equal(data.version, 2);
  assert.equal(data.credits, 4250);
  assert.equal(data.hiScore, 12400);
  assert.deepEqual(data.unlocked, ['vanguard', 'needle']);
  assert.equal(data.selectedShip, 'needle');
  assert.equal(data.muted, true);
  assert.equal(data.bestScrapSpent, 0);
  assert.equal(data.apexFound, 0);
});

test('a v2 save loads unchanged', () => {
  const core = loadCore();
  const v2 = { ...DEFAULTS(), credits: 99, apexFound: 3 };
  const { data, ok } = core.migrateSave(v2, DEFAULTS());
  assert.equal(ok, true);
  assert.equal(data.credits, 99);
  assert.equal(data.apexFound, 3);
});

test('an unknown version falls back to defaults', () => {
  const core = loadCore();
  const { data, ok } = core.migrateSave({ version: 99, credits: 500 }, DEFAULTS());
  assert.equal(ok, false);
  assert.equal(data.credits, 0);
});

test('a corrupt unlocked list is repaired without losing credits', () => {
  const core = loadCore();
  const { data } = core.migrateSave(
    { version: 1, credits: 800, unlocked: 'nonsense', selectedShip: 'ghost' },
    DEFAULTS()
  );
  assert.equal(data.credits, 800);
  assert.deepEqual(data.unlocked, ['vanguard']);
  assert.equal(data.selectedShip, 'vanguard');
});

// Save.load() gates its localStorage write on this `ok` flag, so it never
// overwrites an unrecognized-version save with substituted defaults. This
// test pins that signal at the unit level: a recognized version must report
// ok:true (safe to persist) and an unrecognized one must report ok:false
// (must NOT be persisted over), so a future refactor can't silently drop it.
test('migrateSave reports ok so callers know whether it is safe to persist', () => {
  const core = loadCore();
  const recognized = core.migrateSave({ version: 1, credits: 10 }, DEFAULTS());
  assert.equal(recognized.ok, true);
  const unrecognized = core.migrateSave({ version: 99, credits: 10 }, DEFAULTS());
  assert.equal(unrecognized.ok, false);
});

test('base weights sum to 100 and match the spec', () => {
  const core = loadCore();
  const w = core.rarityWeights(1);
  assert.equal(w.COMMON, 52);
  assert.equal(w.UNCOMMON, 27);
  assert.equal(w.RARE, 13);
  assert.equal(w.EPIC, 6);
  assert.equal(Math.round(w.LEGENDARY * 10) / 10, 1.7);
  assert.equal(Math.round(w.APEX * 10) / 10, 0.3);
  assert.equal(Math.round(Object.values(w).reduce((a, b) => a + b, 0)), 100);
});

test('weights still sum to 100 at every level', () => {
  const core = loadCore();
  for (let lv = 1; lv <= 20; lv++) {
    const total = Object.values(core.rarityWeights(lv)).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 100) < 1e-9, `level ${lv} summed to ${total}`);
  }
});

test('APEX never drifts', () => {
  const core = loadCore();
  for (let lv = 1; lv <= 20; lv++) {
    assert.ok(Math.abs(core.rarityWeights(lv).APEX - 0.3) < 1e-9);
  }
});

test('drift moves weight from COMMON to the middle tiers, capped at level 12', () => {
  const core = loadCore();
  const l1 = core.rarityWeights(1), l8 = core.rarityWeights(8);
  const l12 = core.rarityWeights(12), l20 = core.rarityWeights(20);
  assert.ok(l8.COMMON < l1.COMMON);
  assert.ok(l8.RARE > l1.RARE);
  assert.equal(l20.COMMON, l12.COMMON);
  assert.equal(l12.COMMON, 37);
});

test('rollRarity picks the tier the random value lands in', () => {
  const core = loadCore();
  assert.equal(core.rollRarity(1, () => 0), 'COMMON');
  assert.equal(core.rollRarity(1, () => 0.999), 'APEX');
  assert.equal(core.rollRarity(1, () => 0.6), 'UNCOMMON');
});

test('rollRarity respects tier boundaries', () => {
  const core = loadCore();
  // COMMON is 52%, so rnd() returning exactly 0.52 (52% of 100) should be at the
  // boundary. Since weights are subtracted, landing exactly at the boundary
  // (r < 0) should fall into UNCOMMON, not COMMON.
  assert.equal(core.rollRarity(1, () => 0.52), 'UNCOMMON');
});

test('APEX lands at 0.3% over many rolls', () => {
  const core = loadCore();
  let seed = 12345;
  // Use Math.imul for 32-bit correct multiplication to avoid precision loss
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 0x100000000);
  let apex = 0;
  const N = 200000;
  for (let i = 0; i < N; i++) if (core.rollRarity(1, rnd) === 'APEX') apex++;
  const pct = (apex / N) * 100;
  assert.ok(pct > 0.25 && pct < 0.35, `APEX came out at ${pct.toFixed(3)}%`);
});

test('the catalog has 29 upgrades with the specified tier counts', () => {
  const core = loadCore();
  assert.equal(core.UPGRADES.length, 29);
  const count = t => core.UPGRADES.filter(u => u.tier === t).length;
  assert.equal(count('COMMON'), 6);
  assert.equal(count('UNCOMMON'), 6);
  assert.equal(count('RARE'), 5);
  assert.equal(count('EPIC'), 5);
  assert.equal(count('LEGENDARY'), 4);
  assert.equal(count('APEX'), 3);
});

test('every upgrade has a unique id, a name and a description', () => {
  const core = loadCore();
  const ids = new Set();
  for (const u of core.UPGRADES) {
    assert.ok(u.id && !ids.has(u.id), `duplicate or missing id: ${u.id}`);
    ids.add(u.id);
    assert.ok(u.name && u.name.length > 0);
    assert.ok(u.desc && u.desc.length > 0);
    assert.ok(u.effect && typeof u.effect === 'object');
  }
});

test('owned unique upgrades are excluded from rolls', () => {
  const core = loadCore();
  const rare = core.UPGRADES.filter(u => u.tier === 'RARE');
  const owned = rare.slice(0, 4).map(u => ({ id: u.id, stacks: 1 }));
  const left = core.eligible('RARE', owned);
  assert.equal(left.length, 1);
  assert.equal(left[0].id, rare[4].id);
});

test('a stackable upgrade stays eligible until it hits its stack limit', () => {
  const core = loadCore();
  const common = core.UPGRADES.find(u => u.tier === 'COMMON');
  assert.equal(core.eligible('COMMON', [{ id: common.id, stacks: 4 }]).some(u => u.id === common.id), true);
  assert.equal(core.eligible('COMMON', [{ id: common.id, stacks: 5 }]).some(u => u.id === common.id), false);
});

test('an exhausted tier falls to a lower tier rather than returning nothing', () => {
  const core = loadCore();
  const owned = core.UPGRADES
    .filter(u => u.tier === 'APEX' || u.tier === 'LEGENDARY')
    .map(u => ({ id: u.id, stacks: 1 }));
  const picked = core.rollSlot(1, owned, () => 0.9999);
  assert.ok(picked, 'expected a fallback upgrade');
  assert.ok(picked.tier !== 'APEX' && picked.tier !== 'LEGENDARY');
});

test('a shop rolls three upgrades with no duplicates', () => {
  const core = loadCore();
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 200; i++) {
    const shop = core.rollShop(4, [], rnd);
    assert.equal(shop.length, 3);
    assert.equal(new Set(shop.map(u => u.id)).size, 3);
  }
});
