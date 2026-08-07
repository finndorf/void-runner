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

// Deterministic RNG factory shared by the two tests below: two generators
// built from the same seed produce identical sequences, which lets a test
// "peek" at what a single rnd() draw would yield before feeding an
// independently-seeded generator into the function under test.
const seededRnd = (seed) => {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
};

test('a shop still returns 3 slots when COMMON and UNCOMMON are maxed out, by promoting to a rarer tier', () => {
  const core = loadCore();
  // The exact scenario the reviewer found: every COMMON and UNCOMMON upgrade
  // owned at its stack limit (5). RARE and above are completely untouched
  // (17 eligible upgrades remain), so a shop must never come up short.
  const owned = core.UPGRADES
    .filter(u => u.tier === 'COMMON' || u.tier === 'UNCOMMON')
    .map(u => ({ id: u.id, stacks: 5 }));
  const rareOrBetter = new Set(['RARE', 'EPIC', 'LEGENDARY', 'APEX']);
  const rnd = seededRnd(7);
  for (let i = 0; i < 500; i++) {
    const shop = core.rollShop(4, owned, rnd);
    assert.equal(shop.length, 3, `iteration ${i}: expected 3 slots, got ${shop.length}`);
    assert.equal(new Set(shop.map(u => u.id)).size, 3, `iteration ${i}: duplicate upgrade in shop`);
    for (const u of shop) {
      assert.ok(rareOrBetter.has(u.tier), `iteration ${i}: expected RARE or better, got ${u.tier}`);
    }
  }
});

test('promotion never reaches into APEX from a lower rolled tier', () => {
  const core = loadCore();
  // Every non-APEX upgrade owned past its stack limit; the 3 APEX upgrades
  // are completely untouched. If upward promotion were not capped below
  // APEX, any non-APEX roll in this state would still find and return one
  // of those 3 APEX upgrades (they're the only eligible upgrades left at
  // all). The correct, capped implementation must instead return null for
  // those rolls -- proving the cap is actually doing something, not just
  // passing because APEX happened not to come up.
  const owned = core.UPGRADES
    .filter(u => u.tier !== 'APEX')
    .map(u => ({ id: u.id, stacks: 5 }));
  const level = 12;
  let sawNonApexRoll = false;
  let sawCapProvenByNullFallback = false;
  for (let seed = 1; seed <= 3000; seed++) {
    const rolledTier = core.rollRarity(level, seededRnd(seed));
    const picked = core.rollSlot(level, owned, seededRnd(seed));
    if (rolledTier === 'APEX') continue;
    sawNonApexRoll = true;
    assert.ok(
      !picked || picked.tier !== 'APEX',
      `seed ${seed}: rollRarity landed on ${rolledTier} but rollSlot returned an APEX upgrade (${picked && picked.id})`
    );
    if (picked === null) sawCapProvenByNullFallback = true;
  }
  assert.ok(sawNonApexRoll, 'test setup never exercised a non-APEX roll -- seeds need adjusting');
  assert.ok(
    sawCapProvenByNullFallback,
    'test never hit a state where an uncapped search would have leaked APEX -- assertion above would pass vacuously'
  );
});

const SHIP = { id: 'vanguard', lives: 3, speed: 5.5, fireMul: 1.0, spreadMul: 1.0 };

test('with no upgrades the stats are the ship baseline', () => {
  const core = loadCore();
  const s = core.resolveStats(SHIP, []);
  assert.equal(s.fireRate, 10);
  assert.equal(s.damage, 1);
  assert.equal(s.speed, 5.5);
  assert.equal(s.extraShots, 0);
  assert.equal(s.pierce, 0);
  assert.equal(s.twinCore, false);
});

test('stacked multipliers add before applying', () => {
  const core = loadCore();
  const s = core.resolveStats(SHIP, [{ id: 'heavy_rounds', stacks: 3 }]);
  assert.ok(Math.abs(s.damage - 1.30) < 1e-9);
});

test('fire rate improves by shortening the interval, and never goes below 4', () => {
  const core = loadCore();
  const s = core.resolveStats(SHIP, [{ id: 'reload_coil', stacks: 5 }]);
  assert.ok(s.fireRate < 10);
  const capped = core.resolveStats(SHIP, [
    { id: 'reload_coil', stacks: 5 }, { id: 'twin_feed', stacks: 5 }
  ]);
  assert.ok(capped.fireRate >= 4, `fireRate fell to ${capped.fireRate}`);
});

test('flags come through from rare and above', () => {
  const core = loadCore();
  const s = core.resolveStats(SHIP, [
    { id: 'piercing', stacks: 1 }, { id: 'rear_cannon', stacks: 1 },
    { id: 'twin_core', stacks: 1 }, { id: 'orbital_drone', stacks: 1 }
  ]);
  assert.equal(s.pierce, 1);
  assert.equal(s.rear, true);
  assert.equal(s.twinCore, true);
  assert.equal(s.drones, 1);
});

test('ship fireMul still matters', () => {
  const core = loadCore();
  const fast = core.resolveStats({ ...SHIP, fireMul: 0.62 }, []);
  assert.ok(fast.fireRate < 10);
});

test('scrap multiplier accumulates across both scrap upgrades', () => {
  const core = loadCore();
  const s = core.resolveStats(SHIP, [
    { id: 'scrap_magnet', stacks: 5 }, { id: 'salvage_rig', stacks: 5 }
  ]);
  assert.ok(Math.abs(s.scrapMul - 2.5) < 1e-9);
});

test('a hit removes one stack of the cheapest upgrade', () => {
  const core = loadCore();
  const { owned, removed } = core.stripCheapest([
    { id: 'reload_coil', stacks: 3 }, { id: 'orbital_drone', stacks: 1 }
  ]);
  assert.equal(removed.id, 'reload_coil');
  assert.equal(owned.find(o => o.id === 'reload_coil').stacks, 2);
  assert.equal(owned.find(o => o.id === 'orbital_drone').stacks, 1);
});

test('an entry disappears when its last stack goes', () => {
  const core = loadCore();
  const { owned } = core.stripCheapest([{ id: 'reload_coil', stacks: 1 }]);
  assert.equal(owned.length, 0);
});

test('uniques survive while any stackable remains', () => {
  const core = loadCore();
  let owned = [
    { id: 'twin_core', stacks: 1 }, { id: 'piercing', stacks: 1 },
    { id: 'heavy_rounds', stacks: 2 }
  ];
  ({ owned } = core.stripCheapest(owned));
  ({ owned } = core.stripCheapest(owned));
  assert.equal(owned.find(o => o.id === 'twin_core').stacks, 1);
  assert.equal(owned.find(o => o.id === 'piercing').stacks, 1);
  assert.equal(owned.some(o => o.id === 'heavy_rounds'), false);
});

test('once stackables are gone the lowest-tier unique goes next', () => {
  const core = loadCore();
  const { removed } = core.stripCheapest([
    { id: 'twin_core', stacks: 1 }, { id: 'piercing', stacks: 1 }
  ]);
  assert.equal(removed.id, 'piercing');
});

test('stripping an empty build is safe', () => {
  const core = loadCore();
  const { owned, removed } = core.stripCheapest([]);
  assert.deepEqual(owned, []);
  assert.equal(removed, null);
});

test('scrap and credit formulas match the spec', () => {
  const core = loadCore();
  assert.equal(core.scrapForKill(100, 1), 100);
  assert.equal(core.scrapForKill(100, 1.5), 150);
  assert.equal(core.scrapForKill(300, 1.1), 330);
  assert.equal(core.creditsForScore(12000), 120);
  assert.equal(core.creditsForScore(59), 0);
});

test('reroll cost doubles from 300', () => {
  const core = loadCore();
  assert.equal(core.rerollCost(0), 300);
  assert.equal(core.rerollCost(1), 600);
  assert.equal(core.rerollCost(2), 1200);
});

test('boss health scales with scrap spent and caps at 2.5x', () => {
  const core = loadCore();
  assert.equal(core.bossHpMultiplier(0), 1);
  assert.ok(Math.abs(core.bossHpMultiplier(6000) - 1.75) < 1e-9);
  assert.equal(core.bossHpMultiplier(12000), 2.5);
  assert.equal(core.bossHpMultiplier(999999), 2.5);
});

test('bossHpMultiplier is monotonically non-decreasing', () => {
  const core = loadCore();
  let prev = core.bossHpMultiplier(0);
  for (let spent = 1000; spent <= 20000; spent += 1000) {
    const curr = core.bossHpMultiplier(spent);
    assert.ok(curr >= prev, `multiplier decreased: at ${spent} got ${curr}, was ${prev}`);
    prev = curr;
  }
});

// ---- Task 11: firing-pattern upgrades ----

const baseStats = over => Object.assign({
  extraShots: 0, spread: 1, rear: false, sides: false, twinCore: false
}, over);

test('the base pattern is two forward shots', () => {
  const core = loadCore();
  const shots = core.buildShots(baseStats());
  assert.equal(shots.length, 2);
  assert.ok(shots.every(s => Math.abs(s.a) < 1e-9));
});

test('WIDE MOUNT adds shots and fans them', () => {
  const core = loadCore();
  assert.equal(core.buildShots(baseStats({ extraShots: 1 })).length, 3);
  assert.equal(core.buildShots(baseStats({ extraShots: 3 })).length, 5);
  const fanned = core.buildShots(baseStats({ extraShots: 3 }));
  assert.ok(fanned.some(s => s.a < 0) && fanned.some(s => s.a > 0));
});

test('TIGHT BARREL narrows the fan', () => {
  const core = loadCore();
  const wide = core.buildShots(baseStats({ extraShots: 3, spread: 1 }));
  const tight = core.buildShots(baseStats({ extraShots: 3, spread: 0.5 }));
  const span = a => Math.max(...a.map(s => Math.abs(s.a)));
  assert.ok(span(tight) < span(wide));
});

test('REAR CANNON and SIDE PODS add shots at the right angles', () => {
  const core = loadCore();
  const rear = core.buildShots(baseStats({ rear: true }));
  assert.ok(rear.some(s => Math.abs(Math.abs(s.a) - Math.PI) < 1e-6));
  const sides = core.buildShots(baseStats({ sides: true }));
  assert.ok(sides.some(s => Math.abs(s.a - Math.PI/2) < 1e-6));
  assert.ok(sides.some(s => Math.abs(s.a + Math.PI/2) < 1e-6));
});

// ---- Task 16: the max() combinator in resolveStats ----
// Seven upgrades (all RARE and above, so unique/stack-limit-1) are read with
// the `max` reducer rather than `sum`: homing, splash, shieldRegen,
// overcharge, lifePerKills, chain, fortress. No existing test ever passed any
// of them into resolveStats. That matters because `max`'s accumulator starts
// at 0 and every one of these effect values is positive -- a reversed
// comparison (Math.min instead of Math.max) would silently collapse every one
// of them to 0 and every existing test would still pass.

test('the max() combinator resolves every rare-plus ability to its catalog value, not zero', () => {
  const core = loadCore();
  const s = core.resolveStats(SHIP, [
    { id: 'hunter_rounds', stacks: 1 },     // homing
    { id: 'flak_burst', stacks: 1 },        // splash
    { id: 'kinetic_barrier', stacks: 1 },   // shieldRegen
    { id: 'overcharge', stacks: 1 },        // overcharge
    { id: 'vampiric', stacks: 1 },          // lifePerKills
    { id: 'chain', stacks: 1 },             // chain
    { id: 'fortress', stacks: 1 }           // fortress
  ]);
  // A Math.min(acc, v) bug would report every one of these as 0, since the
  // reducer's accumulator starts at 0 and every catalog value is positive.
  assert.equal(s.homing, 0.045);
  assert.equal(s.splash, 30);
  assert.equal(s.shieldRegen, 1200);
  assert.equal(s.overcharge, 5);
  assert.equal(s.lifePerKills, 30);
  assert.equal(s.chain, 2);
  assert.equal(s.fortress, 2);
});

test('the max() combinator ignores stacks, unlike sum() -- it is not a sum in disguise', () => {
  const core = loadCore();
  // These upgrades are unique (stack limit 1) in real play, but resolveStats
  // itself does not enforce that -- it just reads whatever `stacks` it is
  // given. If max() were accidentally implemented as `v * o.stacks` (i.e. it
  // quietly became a sum), a stacks value above 1 would inflate the result.
  const inflated = core.resolveStats(SHIP, [{ id: 'overcharge', stacks: 5 }]);
  assert.equal(inflated.overcharge, 5, 'max() must read the raw effect value, not scale it by stacks');

  const s2 = core.resolveStats(SHIP, [{ id: 'chain', stacks: 3 }]);
  assert.equal(s2.chain, 2, 'max() must read the raw effect value, not scale it by stacks');
});

test('the max() combinator defaults to 0 when no upgrade grants the key', () => {
  const core = loadCore();
  const s = core.resolveStats(SHIP, [{ id: 'heavy_rounds', stacks: 1 }]);
  assert.equal(s.homing, 0);
  assert.equal(s.splash, 0);
  assert.equal(s.shieldRegen, 0);
  assert.equal(s.overcharge, 0);
  assert.equal(s.lifePerKills, 0);
  assert.equal(s.chain, 0);
  assert.equal(s.fortress, 0);
});

test('TWIN CORE doubles every shot', () => {
  const core = loadCore();
  const one = core.buildShots(baseStats({ extraShots: 2, rear: true }));
  const two = core.buildShots(baseStats({ extraShots: 2, rear: true, twinCore: true }));
  assert.equal(two.length, one.length * 2);
});
