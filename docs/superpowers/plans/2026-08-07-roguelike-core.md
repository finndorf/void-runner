# Roguelike Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Void Runner into a roguelike — kills earn scrap, a cargo hauler docks for 30 seconds between levels, and scrap buys run-scoped upgrades across six rarity tiers.

**Architecture:** All decision-making logic (rarity rolls, upgrade catalog, stat resolution, hit penalty, boss scaling, save migration) lives in a **pure block** inside `void-runner.html`, delimited by sentinel comments, that touches no DOM, canvas, or game globals. Randomness enters through an injected `rnd` parameter so every roll is deterministic under test. A Node test file extracts that block from the HTML and evaluates it in isolation. The impure game code calls into the pure block and owns rendering, input, and entity state.

**Tech Stack:** Vanilla JavaScript, Canvas 2D, `localStorage`. Node 24's built-in `node:test` for tests. No npm packages, no build step.

## Global Constraints

- **Single file.** All game code, styles, and audio synthesis stay inline in `void-runner.html`. No new runtime files, no build step, no dependencies.
- **Tests use Node built-ins only** (`node:test`, `node:assert`, `node:fs`). Never add a `package.json` or install anything.
- **The pure block must never reference** `document`, `window`, `ctx`, `canvas`, `Save`, `Sound`, `Music`, `player`, or any game global. It receives everything as parameters.
- **All randomness in the pure block comes from an injected `rnd()` parameter** returning `[0,1)`. Never call `Math.random()` inside the pure block.
- **Save migration is mandatory.** A `version: 1` save must retain its credits, unlocked ships, and records. Never let a version bump reset player data.
- **APEX probability is fixed at 0.3%** and must never drift with level.
- Rarity weights must always sum to 100.
- Canvas is `W = 480`, `H = 720`. Keep all new UI inside those bounds.
- Existing code style: 2-space indent, `const`/`let`, no semicolon omission, banner comments as `// ===== NAME =====`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `void-runner.html` | The game. Gains two new sections: a pure roguelike-core block and a shop section. |
| `tests/roguelike.test.mjs` | Node tests for the pure block. Extracts and evaluates it from the HTML. |
| `tests/extract.mjs` | Helper that reads `void-runner.html` and returns the pure block's exports. |

The pure block sits between the `CONFIG` and `SAVE` sections so it is defined before any consumer. The shop section sits after `SCREENS`.

---

### Task 1: Test harness and the pure block scaffold

**Files:**
- Create: `tests/extract.mjs`
- Create: `tests/roguelike.test.mjs`
- Modify: `void-runner.html` — insert a new section after line 64 (after the `CFG` object closes, before `// ===== SAVE =====`)

**Interfaces:**
- Produces: `loadCore()` from `tests/extract.mjs`, returning the object the pure block assigns to `globalThis.RLCore`. Every later task adds functions to that object and tests them through this loader.

- [ ] **Step 1: Write the extractor**

Create `tests/extract.mjs`:

```javascript
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const HTML = join(here, '..', 'void-runner.html');

const START = '// ===== ROGUELIKE CORE (PURE) =====';
const END = '// ===== END ROGUELIKE CORE (PURE) =====';

// Pulls the pure block out of the single-file game and evaluates it with no
// DOM present, so a stray document/canvas reference fails loudly here.
export function loadCore() {
  const src = readFileSync(HTML, 'utf8');
  const a = src.indexOf(START);
  const b = src.indexOf(END);
  if (a === -1 || b === -1) throw new Error('pure block sentinels not found');
  const body = src.slice(a + START.length, b);
  const sandbox = {};
  new Function('globalThis', `${body}\nglobalThis.RLCore = RLCore;`)(sandbox);
  return sandbox.RLCore;
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/roguelike.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './extract.mjs';

test('pure block loads and exposes RLCore', () => {
  const core = loadCore();
  assert.equal(typeof core, 'object');
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test tests/`
Expected: FAIL with "pure block sentinels not found".

- [ ] **Step 4: Add the pure block scaffold**

In `void-runner.html`, immediately after the line closing `CFG` (`};` at line 64) and before `// ===== SAVE =====`, insert:

```javascript
// ===== ROGUELIKE CORE (PURE) =====
// No DOM, no canvas, no game globals. Randomness arrives as an injected rnd().
// tests/roguelike.test.mjs extracts and evaluates everything between these
// sentinels, so keeping it pure is what makes the game testable at all.

const RLCore = {};

// ===== END ROGUELIKE CORE (PURE) =====
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/`
Expected: PASS, 1 test.

- [ ] **Step 6: Commit**

```bash
git add tests/ void-runner.html
git commit -m "test: add pure-block test harness for roguelike core"
```

---

### Task 2: Save migration

**Files:**
- Modify: `void-runner.html` — pure block (add `migrateSave`); `Save.defaults()` at lines 74-80; `Save.load()` at lines 82-100
- Test: `tests/roguelike.test.mjs`

**Interfaces:**
- Consumes: `RLCore` from Task 1.
- Produces: `RLCore.SAVE_VERSION` (number, `2`) and `RLCore.migrateSave(parsed, defaults)` returning `{data, ok}` — `data` is the migrated save object, `ok` is `false` when the input was unusable and defaults were substituted.

- [ ] **Step 1: Write the failing tests**

Append to `tests/roguelike.test.mjs`:

```javascript
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/`
Expected: FAIL — `core.migrateSave is not a function`.

- [ ] **Step 3: Implement in the pure block**

Inside the pure block, after `const RLCore = {};`:

```javascript
RLCore.SAVE_VERSION = 2;

// Upgrading rather than resetting is the whole point: the old loader threw away
// any save whose version did not match, which would wipe every player's credits
// and ships the moment the format changed.
RLCore.migrateSave = function (parsed, defaults) {
  if (!parsed || typeof parsed !== 'object') return { data: defaults, ok: false };
  const v = parsed.version;
  if (v !== 1 && v !== RLCore.SAVE_VERSION) return { data: defaults, ok: false };

  const data = Object.assign({}, defaults, parsed);
  data.version = RLCore.SAVE_VERSION;
  if (v === 1) {
    data.bestScrapSpent = 0;
    data.apexFound = 0;
  }
  if (!Array.isArray(data.unlocked) || !data.unlocked.length) data.unlocked = ['vanguard'];
  if (typeof data.selectedShip !== 'string') data.selectedShip = 'vanguard';
  return { data, ok: true };
};
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/`
Expected: PASS, 5 tests.

- [ ] **Step 5: Wire it into Save**

Replace `Save.defaults()` (lines 74-80) with:

```javascript
  defaults() {
    return {
      version: RLCore.SAVE_VERSION,
      hiScore: 0, bestLevel: 1, totalRuns: 0, totalKills: 0,
      credits: 0, unlocked: ['vanguard'], selectedShip: 'vanguard', muted: false,
      bestScrapSpent: 0, apexFound: 0
    };
  },
```

Replace the `Save.VERSION` line (line 70) with `VERSION: RLCore.SAVE_VERSION,` and replace the body of `Save.load()` (lines 82-100) with:

```javascript
  load() {
    Save.data = Save.defaults();
    try {
      const raw = localStorage.getItem(Save.KEY);
      if (raw) {
        const { data } = RLCore.migrateSave(JSON.parse(raw), Save.defaults());
        Save.data = data;
        if (!CFG.ships.some(s => s.id === Save.data.selectedShip)) Save.data.selectedShip = 'vanguard';
        Save.write();
      }
    } catch (e) {
      Save.ok = false;
      Save.data = Save.defaults();
    }
  },
```

- [ ] **Step 6: Verify migration in a real browser**

Open the game, then in DevTools console run:

```javascript
localStorage.setItem('voidrunner.save', JSON.stringify({
  version: 1, hiScore: 5000, bestLevel: 4, totalRuns: 9, totalKills: 210,
  credits: 3300, unlocked: ['vanguard','needle'], selectedShip: 'needle', muted: false
}));
location.reload();
```

Expected: the menu shows 3,300 CR, best 5,000, and NEEDLE selected. Confirm
`JSON.parse(localStorage.getItem('voidrunner.save')).version === 2`.

- [ ] **Step 7: Commit**

```bash
git add tests/roguelike.test.mjs void-runner.html
git commit -m "feat: migrate saves to v2 without discarding player progress"
```

---

### Task 3: Rarity weights, depth drift, and rolling

**Files:**
- Modify: `void-runner.html` — pure block
- Test: `tests/roguelike.test.mjs`

**Interfaces:**
- Produces:
  - `RLCore.TIERS` — array of `{id, name, price, color, stackLimit}` ordered COMMON→APEX. `stackLimit` is `5` for COMMON/UNCOMMON and `1` above.
  - `RLCore.rarityWeights(level)` → `{COMMON, UNCOMMON, RARE, EPIC, LEGENDARY, APEX}` summing to 100.
  - `RLCore.rollRarity(level, rnd)` → a tier id string.

- [ ] **Step 1: Write the failing tests**

```javascript
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

test('APEX lands at 0.3% over many rolls', () => {
  const core = loadCore();
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let apex = 0;
  const N = 200000;
  for (let i = 0; i < N; i++) if (core.rollRarity(1, rnd) === 'APEX') apex++;
  const pct = (apex / N) * 100;
  assert.ok(pct > 0.2 && pct < 0.45, `APEX came out at ${pct.toFixed(3)}%`);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/`
Expected: FAIL — `core.rarityWeights is not a function`.

- [ ] **Step 3: Implement**

```javascript
RLCore.TIERS = [
  { id: 'COMMON',    name: 'COMMON',    price:  240, color: '#b8c4d0', stackLimit: 5 },
  { id: 'UNCOMMON',  name: 'UNCOMMON',  price:  500, color: '#44dd77', stackLimit: 5 },
  { id: 'RARE',      name: 'RARE',      price:  900, color: '#3399ff', stackLimit: 1 },
  { id: 'EPIC',      name: 'EPIC',      price: 2100, color: '#aa66ff', stackLimit: 1 },
  { id: 'LEGENDARY', name: 'LEGENDARY', price: 4500, color: '#ffaa22', stackLimit: 1 },
  { id: 'APEX',      name: 'APEX',      price: 9000, color: '#00ffee', stackLimit: 1 }
];

RLCore.BASE_WEIGHTS = { COMMON: 52, UNCOMMON: 27, RARE: 13, EPIC: 6, LEGENDARY: 1.7, APEX: 0.3 };

// Depth drift takes weight off COMMON and spreads it across UNCOMMON..LEGENDARY
// in proportion to their base weights. APEX is deliberately excluded: it is the
// one probability the player can rely on never changing.
RLCore.rarityWeights = function (level) {
  const w = Object.assign({}, RLCore.BASE_WEIGHTS);
  const steps = Math.max(0, Math.min(level, 12) - 2);
  const drift = 1.5 * steps;
  if (drift <= 0) return w;
  w.COMMON -= drift;
  const mid = ['UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'];
  const midTotal = mid.reduce((a, k) => a + RLCore.BASE_WEIGHTS[k], 0);
  mid.forEach(k => { w[k] += drift * (RLCore.BASE_WEIGHTS[k] / midTotal); });
  return w;
};

RLCore.rollRarity = function (level, rnd) {
  const w = RLCore.rarityWeights(level);
  let r = rnd() * 100;
  for (const t of RLCore.TIERS) {
    r -= w[t.id];
    if (r < 0) return t.id;
  }
  return 'COMMON';
};
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/roguelike.test.mjs void-runner.html
git commit -m "feat: add rarity tiers with depth drift and fixed APEX odds"
```

---

### Task 4: The upgrade catalog and slot rolling

**Files:**
- Modify: `void-runner.html` — pure block
- Test: `tests/roguelike.test.mjs`

**Interfaces:**
- Produces:
  - `RLCore.UPGRADES` — array of `{id, tier, name, desc, effect}`. `effect` is a plain object of stat deltas and flags, consumed by Task 5.
  - `RLCore.eligible(tier, owned)` → array of upgrade objects still rollable, where `owned` is `[{id, stacks}]`.
  - `RLCore.rollSlot(level, owned, rnd)` → an upgrade object, falling to a lower tier when a tier is exhausted.
  - `RLCore.rollShop(level, owned, rnd)` → array of 3 upgrade objects.

- [ ] **Step 1: Write the failing tests**

```javascript
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/`
Expected: FAIL — `core.UPGRADES is undefined`.

- [ ] **Step 3: Implement the catalog**

```javascript
// Effect keys are read by RLCore.resolveStats. Multiplicative keys end in Mul
// and are summed then applied once; flags are booleans or counts.
RLCore.UPGRADES = [
  // --- COMMON ---
  { id: 'reload_coil',  tier: 'COMMON', name: 'RELOAD COIL',  desc: '+8% fire rate',      effect: { fireRateMul: 0.08 } },
  { id: 'heavy_rounds', tier: 'COMMON', name: 'HEAVY ROUNDS', desc: '+10% damage',        effect: { damageMul: 0.10 } },
  { id: 'thrusters',    tier: 'COMMON', name: 'THRUSTERS',    desc: '+8% move speed',     effect: { speedMul: 0.08 } },
  { id: 'plating',      tier: 'COMMON', name: 'PLATING',      desc: '+1 shield charge',   effect: { shieldCharges: 1 } },
  { id: 'scrap_magnet', tier: 'COMMON', name: 'SCRAP MAGNET', desc: '+10% scrap',         effect: { scrapMul: 0.10 } },
  { id: 'tight_barrel', tier: 'COMMON', name: 'TIGHT BARREL', desc: '-10% shot spread',   effect: { spreadMul: -0.10 } },

  // --- UNCOMMON ---
  { id: 'twin_feed',    tier: 'UNCOMMON', name: 'TWIN FEED',    desc: '+15% fire rate',        effect: { fireRateMul: 0.15 } },
  { id: 'ap_rounds',    tier: 'UNCOMMON', name: 'AP ROUNDS',    desc: '+18% damage',           effect: { damageMul: 0.18 } },
  { id: 'repair_kit',   tier: 'UNCOMMON', name: 'REPAIR KIT',   desc: '+1 life',               effect: { lives: 1 } },
  { id: 'evasion',      tier: 'UNCOMMON', name: 'EVASION FIELD',desc: '+12% speed, -10% size', effect: { speedMul: 0.12, hitScaleMul: -0.10 } },
  { id: 'salvage_rig',  tier: 'UNCOMMON', name: 'SALVAGE RIG',  desc: '+20% scrap',            effect: { scrapMul: 0.20 } },
  { id: 'wide_mount',   tier: 'UNCOMMON', name: 'WIDE MOUNT',   desc: '+1 shot',               effect: { extraShots: 1 } },

  // --- RARE ---
  { id: 'piercing',     tier: 'RARE', name: 'PIERCING ROUNDS', desc: 'shots pass through one enemy', effect: { pierce: 1 } },
  { id: 'split_shot',   tier: 'RARE', name: 'SPLIT SHOT',      desc: 'shots split in two on impact', effect: { split: true } },
  { id: 'overcharge',   tier: 'RARE', name: 'OVERCHARGE',      desc: 'every 5th shot triples',       effect: { overcharge: 5 } },
  { id: 'kinetic_barrier', tier: 'RARE', name: 'KINETIC BARRIER', desc: 'a shield regrows every 20s', effect: { shieldRegen: 1200 } },
  { id: 'hunter_rounds',tier: 'RARE', name: 'HUNTER ROUNDS',   desc: 'shots steer toward enemies',   effect: { homing: 0.045 } },

  // --- EPIC ---
  { id: 'rear_cannon',  tier: 'EPIC', name: 'REAR CANNON',  desc: 'you also fire backwards',    effect: { rear: true } },
  { id: 'side_pods',    tier: 'EPIC', name: 'SIDE PODS',    desc: 'you also fire left and right',effect: { sides: true } },
  { id: 'flak_burst',   tier: 'EPIC', name: 'FLAK BURST',   desc: 'shots explode on impact',    effect: { splash: 30 } },
  { id: 'phase_drive',  tier: 'EPIC', name: 'PHASE DRIVE',  desc: 'boost grants invulnerability',effect: { phaseBoost: true } },
  { id: 'vampiric',     tier: 'EPIC', name: 'VAMPIRIC CORE',desc: 'a life back every 30 kills', effect: { lifePerKills: 30 } },

  // --- LEGENDARY ---
  { id: 'orbital_drone',tier: 'LEGENDARY', name: 'ORBITAL DRONE', desc: 'a drone fights beside you',   effect: { drones: 1 } },
  { id: 'chain',        tier: 'LEGENDARY', name: 'CHAIN LIGHTNING',desc: 'hits arc to two enemies',    effect: { chain: 2 } },
  { id: 'time_dilation',tier: 'LEGENDARY', name: 'TIME DILATION', desc: 'enemy bullets 35% slower',    effect: { enemyBulletMul: -0.35 } },
  { id: 'fortress',     tier: 'LEGENDARY', name: 'FORTRESS',      desc: 'start each level shielded',   effect: { fortress: 2 } },

  // --- APEX ---
  { id: 'twin_core',    tier: 'APEX', name: 'TWIN CORE',       desc: 'every weapon effect fires twice', effect: { twinCore: true } },
  { id: 'singularity',  tier: 'APEX', name: 'SINGULARITY',     desc: 'a black hole orbits you',         effect: { singularity: true } },
  { id: 'immortal',     tier: 'APEX', name: 'IMMORTAL ENGINE', desc: 'your first death is survivable',  effect: { extraLife: 1 } }
];

RLCore.tierOf = function (id) { return RLCore.TIERS.find(t => t.id === id); };

RLCore.eligible = function (tier, owned) {
  const limit = RLCore.tierOf(tier).stackLimit;
  return RLCore.UPGRADES.filter(u => {
    if (u.tier !== tier) return false;
    const have = owned.find(o => o.id === u.id);
    return !have || have.stacks < limit;
  });
};

RLCore.rollSlot = function (level, owned, rnd, exclude) {
  const skip = exclude || [];
  let idx = RLCore.TIERS.findIndex(t => t.id === RLCore.rollRarity(level, rnd));
  for (; idx >= 0; idx--) {
    const pool = RLCore.eligible(RLCore.TIERS[idx].id, owned).filter(u => !skip.includes(u.id));
    if (pool.length) return pool[Math.floor(rnd() * pool.length)];
  }
  return null;
};

RLCore.rollShop = function (level, owned, rnd) {
  const out = [];
  for (let i = 0; i < 3; i++) {
    const u = RLCore.rollSlot(level, owned, rnd, out.map(o => o.id));
    if (u) out.push(u);
  }
  return out;
};
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/roguelike.test.mjs void-runner.html
git commit -m "feat: add the 29-upgrade catalog and shop slot rolling"
```

---

### Task 5: Stat resolution

**Files:**
- Modify: `void-runner.html` — pure block
- Test: `tests/roguelike.test.mjs`

**Interfaces:**
- Produces: `RLCore.resolveStats(ship, owned)` → `{fireRate, damage, speed, spread, hitScale, shieldCharges, extraShots, extraLives, scrapMul, pierce, homing, splash, split, overcharge, shieldRegen, rear, sides, phaseBoost, lifePerKills, drones, chain, enemyBulletMul, fortress, twinCore, singularity}`.
- `ship` is a `CFG.ships` entry. `owned` is `[{id, stacks}]`.

Base fire is the current level-2 pattern: `fireRate` 10, `damage` 1, two forward shots.

- [ ] **Step 1: Write the failing tests**

```javascript
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/`
Expected: FAIL — `core.resolveStats is not a function`.

- [ ] **Step 3: Implement**

```javascript
RLCore.BASE_FIRE_RATE = 10;
RLCore.MIN_FIRE_RATE = 4;

RLCore.resolveStats = function (ship, owned) {
  const sum = key => owned.reduce((acc, o) => {
    const u = RLCore.UPGRADES.find(x => x.id === o.id);
    const v = u && u.effect[key];
    return acc + (typeof v === 'number' ? v * o.stacks : 0);
  }, 0);
  const has = key => owned.some(o => {
    const u = RLCore.UPGRADES.find(x => x.id === o.id);
    return u && u.effect[key] === true;
  });
  const max = key => owned.reduce((acc, o) => {
    const u = RLCore.UPGRADES.find(x => x.id === o.id);
    const v = u && u.effect[key];
    return typeof v === 'number' ? Math.max(acc, v) : acc;
  }, 0);

  // Fire rate is an interval in frames, so a bonus divides rather than multiplies.
  const rate = RLCore.BASE_FIRE_RATE * ship.fireMul / (1 + sum('fireRateMul'));

  return {
    fireRate: Math.max(RLCore.MIN_FIRE_RATE, rate),
    damage: 1 * (1 + sum('damageMul')),
    speed: ship.speed * (1 + sum('speedMul')),
    spread: ship.spreadMul * (1 + sum('spreadMul')),
    hitScale: 1 + sum('hitScaleMul'),
    shieldCharges: sum('shieldCharges'),
    extraShots: sum('extraShots'),
    extraLives: sum('lives') + sum('extraLife'),
    scrapMul: 1 + sum('scrapMul'),
    pierce: sum('pierce'),
    homing: max('homing'),
    splash: max('splash'),
    shieldRegen: max('shieldRegen'),
    overcharge: max('overcharge'),
    lifePerKills: max('lifePerKills'),
    drones: sum('drones'),
    chain: max('chain'),
    fortress: max('fortress'),
    enemyBulletMul: 1 + sum('enemyBulletMul'),
    split: has('split'),
    rear: has('rear'),
    sides: has('sides'),
    phaseBoost: has('phaseBoost'),
    twinCore: has('twinCore'),
    singularity: has('singularity')
  };
};
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/`
Expected: PASS, 23 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/roguelike.test.mjs void-runner.html
git commit -m "feat: resolve player stats from ship plus owned upgrades"
```

---

### Task 6: Hit penalty, economy formulas, and boss scaling

**Files:**
- Modify: `void-runner.html` — pure block
- Test: `tests/roguelike.test.mjs`

**Interfaces:**
- Produces:
  - `RLCore.stripCheapest(owned)` → `{owned, removed}` where `removed` is `{id, tier}` or `null`.
  - `RLCore.scrapForKill(points, scrapMul)` → integer.
  - `RLCore.creditsForScore(score)` → integer.
  - `RLCore.rerollCost(uses)` → integer.
  - `RLCore.bossHpMultiplier(scrapSpent)` → number in `[1, 2.5]`.
- `RLCore.CREDIT_DIVISOR = 100`.

- [ ] **Step 1: Write the failing tests**

```javascript
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
  assert.ok(Math.abs(core.bossHpMultiplier(6000) - 1.5) < 1e-9);
  assert.equal(core.bossHpMultiplier(12000), 2.5);
  assert.equal(core.bossHpMultiplier(999999), 2.5);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/`
Expected: FAIL — `core.stripCheapest is not a function`.

- [ ] **Step 3: Implement**

```javascript
RLCore.CREDIT_DIVISOR = 100;

// Cheapest-first is what lets commons act as armour around a rare build: three
// stacks of a 240-scrap upgrade are three hits the Orbital Drone does not take.
RLCore.stripCheapest = function (owned) {
  if (!owned.length) return { owned, removed: null };
  const rank = id => RLCore.TIERS.findIndex(t => t.id === id);
  let best = -1;
  owned.forEach((o, i) => {
    const u = RLCore.UPGRADES.find(x => x.id === o.id);
    if (!u) return;
    if (best === -1) { best = i; return; }
    const bu = RLCore.UPGRADES.find(x => x.id === owned[best].id);
    // Lower tier wins; ties go to the most recently acquired, which is the later index.
    if (rank(u.tier) < rank(bu.tier) || (rank(u.tier) === rank(bu.tier) && i > best)) best = i;
  });
  if (best === -1) return { owned, removed: null };

  const target = owned[best];
  const u = RLCore.UPGRADES.find(x => x.id === target.id);
  const next = owned.map((o, i) => (i === best ? { id: o.id, stacks: o.stacks - 1 } : o))
                    .filter(o => o.stacks > 0);
  return { owned: next, removed: { id: target.id, tier: u.tier } };
};

RLCore.scrapForKill = function (points, scrapMul) { return Math.round(points * scrapMul); };
RLCore.creditsForScore = function (score) { return Math.floor(score / RLCore.CREDIT_DIVISOR); };
RLCore.rerollCost = function (uses) { return 300 * Math.pow(2, uses); };

// Spent, not earned: hoarding scrap should not summon a tougher boss, only
// actually being stronger should.
RLCore.bossHpMultiplier = function (scrapSpent) {
  return 1 + Math.min(1.5, scrapSpent / 12000);
};
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/`
Expected: PASS, 31 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/roguelike.test.mjs void-runner.html
git commit -m "feat: add hit penalty, scrap economy and boss scaling formulas"
```

---

### Task 7: Remove the orbs and the weapon ladder

**Files:**
- Modify: `void-runner.html` — lines 57-63 (`CFG.weapons`), 403-404 (`player.weaponLevel`), 408, 611, 1144, 1289-1290, 1344, 1385-1390, 1657-1694, 1695, 1753, and the `drawStart` control text near line 2140

**Interfaces:**
- Consumes: nothing new.
- Produces: a game with no powerup entities and no `player.weaponLevel`. Firing temporarily uses the fixed base pattern; Task 8 reconnects it to `resolveStats`.

- [ ] **Step 1: Delete the powerup entity**

Remove `powerups` from the array declaration (line 408) and from the reset in `startGame` (line 611). Delete `POWERUP_COLOR` and `POWERUP_LETTER` (lines 1289-1290). Delete the drop push in `updateBoss` (line 1144) and in `killEnemy` (line 1344), including the `const type = ...` roll above it. Delete the powerup update block (lines 1657-1694), the filter (line 1695), and the powerup draw block (line 1753).

- [ ] **Step 2: Delete the weapon ladder**

Remove `CFG.weapons` (lines 57-63) and the trailing comma on the line before. Remove `weaponLevel` from the `player` object (line 403). Remove `player.weaponLevel = 1;` from `startGame` (line 614). In `hitPlayer` remove the weapon-level decrement block (lines 1385-1390).

- [ ] **Step 3: Point fireWeapon at a fixed base pattern**

Replace `fireWeapon` (lines 1294-1307) with:

```javascript
const BASE_SHOTS = [{ dx: -10, a: 0 }, { dx: 10, a: 0 }];

function fireWeapon() {
  BASE_SHOTS.forEach(s => {
    bullets.push({
      x: player.x + s.dx, y: player.y - 10,
      vx: Math.sin(s.a) * BULLET_SPEED,
      vy: -Math.cos(s.a) * BULLET_SPEED,
      w: 3, h: 10, pierce: 0, damage: 1, dead: false
    });
  });
  player.muzzle = 3;
  Sound.play('laser');
}
```

In `update`, replace the fire-rate line (line 1467) with:

```javascript
  const fireRate = Math.max(4, Math.round(10 * player.fireMul * (player.boost > 0 ? 0.65 : 1)));
```

- [ ] **Step 4: Update the menu control text**

In `drawStart`, replace the two control lines (near line 2140) with:

```javascript
  ctx.fillText('← → move    auto-fire is always on', W/2, 512);
  ctx.fillText('kills earn SCRAP — spend it when cargo docks', W/2, 530);
```

- [ ] **Step 5: Verify nothing references the removed systems**

Run:

```bash
grep -nE "powerups|POWERUP_|weaponLevel|CFG\.weapons" void-runner.html; echo "exit:$?"
```

Expected: no output (exit 1).

- [ ] **Step 6: Play it**

Open `void-runner.html`, start a run, and confirm: the ship fires, enemies die, no orbs ever drop, no console errors, and taking a hit costs a life without a JavaScript error.

- [ ] **Step 7: Commit**

```bash
git add void-runner.html
git commit -m "refactor: remove powerup orbs and the 1-5 weapon ladder"
```

---

### Task 8: Wire upgrades into the run

**Files:**
- Modify: `void-runner.html` — `STATE` block near line 373; `startGame` (605-623); `hitPlayer` (1363-1396); `killEnemy` (1327-1358); `endRun` (638-663); `bossMaxHp` (1092-1097); `fireWeapon`; `update`

**Interfaces:**
- Consumes: `RLCore.resolveStats`, `RLCore.stripCheapest`, `RLCore.scrapForKill`, `RLCore.creditsForScore`, `RLCore.bossHpMultiplier`.
- Produces: globals `runUpgrades` (`[{id, stacks}]`), `scrap` (number), `scrapSpent` (number), and `stats` (the resolved block), plus `recomputeStats()`.

- [ ] **Step 1: Add run state**

After line 381, add:

```javascript
let runUpgrades = [];       // [{id, stacks}] — this run only
let scrap = 0, scrapSpent = 0;
let stats = null;           // resolved by recomputeStats()
let overchargeCount = 0, killsSinceLife = 0;

function recomputeStats() {
  stats = RLCore.resolveStats(currentShip(), runUpgrades);
  player.speed = stats.speed;
}
```

- [ ] **Step 2: Reset it per run**

In `startGame` (line 605), after the existing resets, add:

```javascript
  runUpgrades = []; scrap = 0; scrapSpent = 0;
  overchargeCount = 0; killsSinceLife = 0;
  recomputeStats();
  lives += stats.extraLives;
  player.shieldCharges = stats.shieldCharges;
```

- [ ] **Step 3: Earn scrap on kill**

In `killEnemy` (line 1327), after `score += st.points * multiplier;` add:

```javascript
  scrap += RLCore.scrapForKill(st.points, stats.scrapMul);
```

Note the deliberate asymmetry: score takes the combo multiplier, scrap does not.

- [ ] **Step 4: Apply the hit penalty**

In `hitPlayer` (line 1363), after the shield check and before the life decrement, add:

```javascript
  const res = RLCore.stripCheapest(runUpgrades);
  runUpgrades = res.owned;
  if (res.removed) {
    const t = RLCore.tierOf(res.removed.tier);
    const u = RLCore.UPGRADES.find(x => x.id === res.removed.id);
    addFlashText('-' + u.name, player.x, player.y - 30, t.color);
    recomputeStats();
  }
```

- [ ] **Step 5: Scale the boss and the payout**

In `bossMaxHp` (line 1092), multiply the returned value by `RLCore.bossHpMultiplier(scrapSpent)`.

In `endRun` (line 648), replace the credits line with:

```javascript
  runCredits = RLCore.creditsForScore(score);
  Save.data.bestScrapSpent = Math.max(Save.data.bestScrapSpent, scrapSpent);
```

- [ ] **Step 6: Use resolved stats when firing**

In `update`, replace the fire-rate line from Task 7 with:

```javascript
  const fireRate = Math.max(4, Math.round(stats.fireRate * (player.boost > 0 ? 0.65 : 1)));
```

In `fireWeapon`, set each bullet's `damage: stats.damage`, `pierce: stats.pierce`, and add `homing: stats.homing, splash: stats.splash`.

- [ ] **Step 7: Make bullet damage count**

Change `e.hp--` (line 1622) to `e.hp -= b.damage`, `a.hp--` (line 1509) to `a.hp -= b.damage`, and `b.hp--` (line 1243) to `b.hp -= bullet.damage` at the boss hit site, matching the local variable names at each site.

- [ ] **Step 8: Verify in the browser**

Open the game and in the console run:

```javascript
runUpgrades = [{id:'heavy_rounds', stacks: 5}]; recomputeStats(); stats.damage;
```

Expected: `1.5`. Then confirm enemies visibly die faster, and that `scrap` climbs as you kill.

- [ ] **Step 9: Commit**

```bash
git add void-runner.html
git commit -m "feat: wire upgrades, scrap and boss scaling into the run"
```

---

### Task 9: The shop state and the docking hauler

**Files:**
- Modify: `void-runner.html` — `levelUp` (624-636); `loop` (2217-2255); new `// ===== SHOP =====` section after `SCREENS`

**Interfaces:**
- Consumes: `RLCore.rollShop`, `RLCore.rerollCost`.
- Produces: state `'shop'`; globals `shopSlots`, `shopTimer`, `shopRerolls`, `shopSel`, `haulerX`; functions `openShop()`, `updateShop()`, `closeShop()`.

- [ ] **Step 1: Add shop state and lifecycle**

Add a `// ===== SHOP =====` section after `drawGameOver` (line 2213):

```javascript
// ===== SHOP =====

const SHOP_SECONDS = 30;
let shopSlots = [], shopTimer = 0, shopRerolls = 0, shopSel = 0, haulerX = W + 120;

function openShop() {
  shopSlots = RLCore.rollShop(level, runUpgrades, Math.random);
  shopTimer = 60 * SHOP_SECONDS;
  shopRerolls = 0;
  shopSel = 0;
  haulerX = W + 120;
  state = 'shop';
  if (shopSlots.some(s => s.tier === 'APEX')) {
    Save.data.apexFound += 1; Save.write();
    FX.addShake(10);
    Sound.play('apex');
  }
}

function updateShop() {
  // The hauler slides in and parks; the clock runs regardless.
  haulerX += (W - 96 - haulerX) * 0.08;
  shopTimer--;
  if (shopTimer <= 0) closeShop();
}

function closeShop() {
  state = 'play';
  levelBanner = { text: 'LEVEL ' + level, life: 120 };
  spawnParticles(W/2, H/2, '#00ffff', 30);
  Sound.play('levelUp');
  if (stats.fortress > 0) player.shieldCharges = Math.max(player.shieldCharges, stats.fortress);
  if (level % 5 === 0) spawnBoss(level);
}
```

- [ ] **Step 2: Route levelUp through the shop**

Replace `levelUp` (624-636) with:

```javascript
function levelUp() {
  levelTimer = 0; level++;
  Music.setIntensity(level);
  if (player.canPhase) player.phaseReady = true;
  openShop();
}
```

The boss spawn and the level banner both move into `closeShop`, so they happen when
play actually resumes rather than behind the shop panel.

- [ ] **Step 3: Drive it from the loop**

In `loop` (2217), extend the non-play branch. After the `starLayers`/`nebulae` drift lines, add:

```javascript
    if (state === 'shop') updateShop();
```

- [ ] **Step 4: Add the APEX sound**

In `Sound.play`'s switch (line 216), add a case:

```javascript
      case 'apex':
        Sound.tone(880, 0.5, 'sawtooth', 0.16, 1760);
        Sound.tone(1320, 0.7, 'triangle', 0.12, 2640, 0.08);
        break;
```

- [ ] **Step 5: Verify**

Open the game, and in the console run `levelUp()`. Expected: play stops, `state === 'shop'`, and `shopSlots.length === 3`. Wait 30 seconds and confirm play resumes with a level banner.

- [ ] **Step 6: Commit**

```bash
git add void-runner.html
git commit -m "feat: add the shop state, 30s timer and docking hauler"
```

---

### Task 10: The shop screen and its input

**Files:**
- Modify: `void-runner.html` — `SHOP` section; `draw` (1740); keydown handler (541-554); `handlePointer` (558-584)

**Interfaces:**
- Consumes: `shopSlots`, `shopTimer`, `shopRerolls`, `RLCore.tierOf`, `RLCore.rerollCost`.
- Produces: `drawShop()`, `tryBuySlot(i)`, `tryReroll()`; rects `SLOT_RECTS`, `REROLL_RECT`, `DEPART_RECT`.

- [ ] **Step 1: Add the buy and reroll actions**

In the `SHOP` section:

```javascript
const SLOT_RECTS = [0, 1, 2].map(i => ({ x: 24 + i*146, y: 300, w: 134, h: 150 }));
const REROLL_RECT = { x: W/2 - 150, y: 474, w: 140, h: 34 };
const DEPART_RECT = { x: W/2 + 10,  y: 474, w: 140, h: 34 };

function tryBuySlot(i) {
  const u = shopSlots[i];
  if (!u) return false;
  const price = RLCore.tierOf(u.tier).price;
  if (scrap < price) { Sound.play('uiDeny'); return false; }
  scrap -= price;
  scrapSpent += price;
  const have = runUpgrades.find(o => o.id === u.id);
  if (have) have.stacks++; else runUpgrades.push({ id: u.id, stacks: 1 });
  shopSlots[i] = null;
  recomputeStats();
  if (u.effect.shieldCharges) player.shieldCharges = stats.shieldCharges;
  if (u.effect.lives || u.effect.extraLife) lives += (u.effect.lives || 0) + (u.effect.extraLife || 0);
  Sound.play('uiBuy');
  return true;
}

function tryReroll() {
  const cost = RLCore.rerollCost(shopRerolls);
  if (scrap < cost) { Sound.play('uiDeny'); return false; }
  scrap -= cost;
  scrapSpent += cost;
  shopRerolls++;
  shopSlots = RLCore.rollShop(level, runUpgrades, Math.random);
  Sound.play('uiMove');
  return true;
}
```

Add a `uiDeny` case to `Sound.play`:

```javascript
      case 'uiDeny': Sound.tone(180, 0.12, 'square', 0.10, 120); break;
```

- [ ] **Step 2: Draw the screen**

```javascript
function drawShop() {
  drawBg();

  // Hauler: a slab hull with lit windows, parked alongside the player.
  ctx.save();
  ctx.translate(haulerX, 150);
  ctx.fillStyle = '#1b2836';
  ctx.fillRect(-70, -46, 140, 92);
  ctx.strokeStyle = '#3d5872'; ctx.lineWidth = 2;
  ctx.strokeRect(-70, -46, 140, 92);
  ctx.fillStyle = '#ffcc55';
  for (let i = 0; i < 5; i++) ctx.fillRect(-56 + i*24, -30, 12, 10);
  ctx.fillStyle = '#2a3d52';
  ctx.fillRect(-70, 10, 140, 16);
  ctx.fillStyle = '#00ddff';
  ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center';
  ctx.fillText('CARGO', 0, 36);
  ctx.restore();

  drawShip(player.x, player.y, 0, player.shieldCharges, 0, frame, 0);

  ctx.fillStyle = 'rgba(0,5,20,0.82)';
  ctx.fillRect(0, 236, W, 300);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#00eeff'; ctx.font = 'bold 18px monospace';
  ctx.fillText('CARGO DOCKED', W/2, 268);

  const secs = Math.ceil(shopTimer / 60);
  ctx.fillStyle = secs <= 5 ? '#ff5544' : '#8fb4d4';
  ctx.font = 'bold 14px monospace';
  ctx.fillText('0:' + String(secs).padStart(2, '0'), W/2, 290);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffdd44'; ctx.font = 'bold 13px monospace';
  ctx.fillText('SCRAP ' + Math.floor(scrap).toLocaleString(), 24, 268);

  shopSlots.forEach((u, i) => {
    const r = SLOT_RECTS[i];
    if (!u) {
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = '#3d4d5d'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
      ctx.fillText('SOLD', r.x + r.w/2, r.y + r.h/2);
      return;
    }
    const t = RLCore.tierOf(u.tier);
    const afford = scrap >= t.price;
    const col = u.tier === 'APEX'
      ? (Math.floor(frame/6) % 2 ? '#00ffee' : '#ffdd33')
      : t.color;

    ctx.globalAlpha = afford ? 1 : 0.45;
    ctx.fillStyle = 'rgba(0,20,45,0.75)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = col; ctx.lineWidth = i === shopSel ? 3 : 1.5;
    ctx.strokeRect(r.x, r.y, r.w, r.h);

    ctx.textAlign = 'center';
    ctx.fillStyle = col; ctx.font = 'bold 10px monospace';
    ctx.fillText(t.name, r.x + r.w/2, r.y + 20);

    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 12px monospace';
    wrapText(u.name, r.x + r.w/2, r.y + 48, r.w - 14, 14);

    ctx.fillStyle = '#8fa8c0'; ctx.font = '9px monospace';
    wrapText(u.desc, r.x + r.w/2, r.y + 88, r.w - 14, 11);

    ctx.fillStyle = afford ? '#ffdd44' : '#7d6a4a'; ctx.font = 'bold 12px monospace';
    ctx.fillText(t.price.toLocaleString(), r.x + r.w/2, r.y + r.h - 14);
    ctx.globalAlpha = 1;
  });

  const rc = RLCore.rerollCost(shopRerolls);
  drawShopButton(REROLL_RECT, 'REROLL ' + rc.toLocaleString(), scrap >= rc);
  drawShopButton(DEPART_RECT, 'DEPART →', true);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#5b6b80'; ctx.font = '10px monospace';
  ctx.fillText('← → choose    SPACE buy    R reroll    D depart', W/2, 524);
}

function drawShopButton(r, label, enabled) {
  ctx.fillStyle = enabled ? 'rgba(0,180,255,0.12)' : 'rgba(120,130,140,0.08)';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = enabled ? '#00bbee' : 'rgba(140,150,160,0.3)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  ctx.textAlign = 'center';
  ctx.fillStyle = enabled ? '#aee6ff' : '#6b7681';
  ctx.font = 'bold 11px monospace';
  ctx.fillText(label, r.x + r.w/2, r.y + 22);
}

// Canvas has no text wrapping, and upgrade names overflow a 134px card.
function wrapText(text, cx, y, maxW, lineH) {
  const words = String(text).split(' ');
  let line = '', ly = y;
  words.forEach(word => {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, cx, ly); line = word; ly += lineH;
    } else line = test;
  });
  if (line) ctx.fillText(line, cx, ly);
}
```

- [ ] **Step 3: Render it**

In `draw` (line 1740), after the existing screen dispatch, add:

```javascript
  if (state === 'shop') { drawShop(); return; }
```

Place this before the `play` HUD drawing so the shop owns the frame.

- [ ] **Step 4: Add keyboard input**

In the keydown handler (541-554), add a branch:

```javascript
  } else if (state === 'shop') {
    if (e.key === 'ArrowLeft')  { shopSel = (shopSel + 2) % 3; Sound.play('uiMove'); }
    if (e.key === 'ArrowRight') { shopSel = (shopSel + 1) % 3; Sound.play('uiMove'); }
    if (e.key === ' ' || e.key === 'Enter') tryBuySlot(shopSel);
    if (e.key === 'r' || e.key === 'R') tryReroll();
    if (e.key === 'd' || e.key === 'D' || e.key === 'Escape') closeShop();
  }
```

- [ ] **Step 5: Add pointer input**

In `handlePointer` (558), before the `state === 'start'` branch:

```javascript
  if (state === 'shop') {
    for (let i = 0; i < 3; i++) {
      if (pointInRect(p, SLOT_RECTS[i])) { shopSel = i; tryBuySlot(i); return true; }
    }
    if (pointInRect(p, REROLL_RECT)) { tryReroll(); return true; }
    if (pointInRect(p, DEPART_RECT)) { closeShop(); return true; }
    return true;
  }
```

Returning `true` unconditionally stops a stray tap from falling through to the launch handler.

- [ ] **Step 6: Verify**

Open the game and run `scrap = 20000; levelUp();` in the console. Confirm: three cards render with correct colours and prices, arrow keys move the highlight, SPACE buys and marks the slot SOLD, R rerolls at 300 then 600 then 1,200, D departs immediately, and unaffordable cards render dimmed. Then run `scrap = 0; levelUp();` and confirm every card is dim and buying is refused.

- [ ] **Step 7: Commit**

```bash
git add void-runner.html
git commit -m "feat: add the cargo shop screen with buy, reroll and depart"
```

---

### Task 11: Firing-pattern upgrades

**Files:**
- Modify: `void-runner.html` — `fireWeapon`
- Test: `tests/roguelike.test.mjs`

**Interfaces:**
- Produces: `RLCore.buildShots(stats)` → array of `{dx, dy, a}`, where `a` is the launch angle in radians measured from straight up.

Covers WIDE MOUNT, TIGHT BARREL, REAR CANNON, SIDE PODS and TWIN CORE.

- [ ] **Step 1: Write the failing tests**

```javascript
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

test('TWIN CORE doubles every shot', () => {
  const core = loadCore();
  const one = core.buildShots(baseStats({ extraShots: 2, rear: true }));
  const two = core.buildShots(baseStats({ extraShots: 2, rear: true, twinCore: true }));
  assert.equal(two.length, one.length * 2);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/`
Expected: FAIL — `core.buildShots is not a function`.

- [ ] **Step 3: Implement in the pure block**

```javascript
RLCore.buildShots = function (s) {
  const n = 2 + s.extraShots;
  const step = 0.085 * s.spread;
  const shots = [];
  // Centre the fan on straight-up: an even count straddles centre, an odd count includes it.
  for (let i = 0; i < n; i++) {
    const off = i - (n - 1) / 2;
    shots.push({ dx: off * 9, dy: -10, a: off * step });
  }
  if (s.rear)  shots.push({ dx: -6, dy: 12, a: Math.PI }, { dx: 6, dy: 12, a: -Math.PI });
  if (s.sides) shots.push({ dx: -14, dy: 0, a: -Math.PI/2 }, { dx: 14, dy: 0, a: Math.PI/2 });
  return s.twinCore ? shots.concat(shots.map(x => ({ dx: x.dx * 0.6, dy: x.dy + 4, a: x.a }))) : shots;
};
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/`
Expected: PASS, 36 tests.

- [ ] **Step 5: Use it in the game**

Replace `fireWeapon` with:

```javascript
function fireWeapon() {
  overchargeCount++;
  const crit = stats.overcharge > 0 && overchargeCount % stats.overcharge === 0;
  const dmg = stats.damage * (crit ? 3 : 1);
  RLCore.buildShots(stats).forEach(s => {
    bullets.push({
      x: player.x + s.dx, y: player.y + s.dy,
      vx: Math.sin(s.a) * BULLET_SPEED,
      vy: -Math.cos(s.a) * BULLET_SPEED,
      w: 3, h: 10,
      pierce: stats.pierce, damage: dmg, homing: stats.homing,
      splash: stats.splash, split: stats.split, crit,
      dead: false
    });
  });
  player.muzzle = 3;
  Sound.play('laser');
}
```

- [ ] **Step 6: Verify in the browser**

Console: `runUpgrades=[{id:'side_pods',stacks:1},{id:'rear_cannon',stacks:1},{id:'wide_mount',stacks:3}]; recomputeStats();`
Expected: the ship visibly fires forward in a fan, plus left, right, and backwards.

- [ ] **Step 7: Commit**

```bash
git add tests/roguelike.test.mjs void-runner.html
git commit -m "feat: add firing-pattern upgrades and twin-core doubling"
```

---

### Task 12: Bullet behaviour upgrades

**Files:**
- Modify: `void-runner.html` — bullet update in `update` (near line 1500), bullet/enemy collision (near line 1622), `drawBoss` hit site (near line 1243)

**Interfaces:**
- Consumes: bullet fields `homing`, `splash`, `split`, `pierce`, `damage` from Task 11.
- Produces: `applySplash(x, y, radius, damage)` and `applyChain(x, y, hops, damage)`.

Covers HUNTER ROUNDS, FLAK BURST, SPLIT SHOT, CHAIN LIGHTNING and PIERCING ROUNDS.

- [ ] **Step 1: Add homing to the bullet update**

In `update`, inside the bullet movement loop, before the position integration:

```javascript
    if (b.homing > 0) {
      let best = null, bestD = 1e9;
      enemies.forEach(e => {
        if (e.dead) return;
        const d = (e.x - b.x) ** 2 + (e.y - b.y) ** 2;
        if (d < bestD) { bestD = d; best = e; }
      });
      if (best) {
        const want = Math.atan2(best.x - b.x, -(best.y - b.y));
        const cur  = Math.atan2(b.vx, -b.vy);
        let diff = want - cur;
        while (diff >  Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const turn = Math.max(-b.homing, Math.min(b.homing, diff));
        const a = cur + turn;
        b.vx = Math.sin(a) * BULLET_SPEED;
        b.vy = -Math.cos(a) * BULLET_SPEED;
      }
    }
```

- [ ] **Step 2: Add splash and chain helpers**

Next to `spawnParticles`:

```javascript
function applySplash(x, y, radius, damage) {
  if (radius <= 0) return;
  enemies.forEach(e => {
    if (e.dead) return;
    if ((e.x - x) ** 2 + (e.y - y) ** 2 <= radius * radius) {
      e.hp -= damage; e.flash = 4;
      if (e.hp <= 0) killEnemy(e);
    }
  });
  FX.explode(x, y, radius * 0.7, '#ffaa44');
}

function applyChain(x, y, hops, damage) {
  let from = { x, y };
  const hit = [];
  for (let i = 0; i < hops; i++) {
    let best = null, bestD = 1e9;
    enemies.forEach(e => {
      if (e.dead || hit.includes(e)) return;
      const d = (e.x - from.x) ** 2 + (e.y - from.y) ** 2;
      if (d < bestD && d < 160 * 160) { bestD = d; best = e; }
    });
    if (!best) return;
    hit.push(best);
    best.hp -= damage; best.flash = 4;
    spawnParticles(best.x, best.y, '#88ddff', 6);
    if (best.hp <= 0) killEnemy(best);
    from = best;
  }
}
```

- [ ] **Step 3: Fire them on impact**

At the bullet/enemy collision site, after `e.hp -= b.damage;` add:

```javascript
      if (b.splash > 0) applySplash(e.x, e.y, b.splash, b.damage * 0.6);
      if (stats.chain > 0) applyChain(e.x, e.y, stats.chain, b.damage * 0.5);
      if (b.split && !b.isSplit) {
        [-0.5, 0.5].forEach(a => bullets.push({
          x: e.x, y: e.y,
          vx: Math.sin(a) * BULLET_SPEED, vy: -Math.cos(a) * BULLET_SPEED,
          w: 3, h: 8, pierce: 0, damage: b.damage * 0.5, homing: 0, splash: 0,
          split: false, isSplit: true, crit: false, dead: false
        }));
      }
      if (b.pierce > 0) { b.pierce--; } else { b.dead = true; }
```

Replace whatever currently sets `b.dead = true` at that site so pierce is honoured.

- [ ] **Step 4: Tint crits and split shots when drawing bullets**

In the bullet draw loop, use `b.crit ? '#ffdd33' : b.isSplit ? '#88ddff' : '#00ffff'` as the fill.

- [ ] **Step 5: Verify each behaviour**

For each, set the build in the console, then observe:

| console | expect |
| --- | --- |
| `runUpgrades=[{id:'hunter_rounds',stacks:1}]; recomputeStats();` | shots visibly curve toward enemies |
| `runUpgrades=[{id:'flak_burst',stacks:1}]; recomputeStats();` | orange blasts, nearby enemies die together |
| `runUpgrades=[{id:'split_shot',stacks:1}]; recomputeStats();` | two blue shots fly off on impact |
| `runUpgrades=[{id:'chain',stacks:1}]; recomputeStats();` | blue sparks jump between enemies |
| `runUpgrades=[{id:'piercing',stacks:1}]; recomputeStats();` | one shot kills two stacked enemies |

- [ ] **Step 6: Commit**

```bash
git add void-runner.html
git commit -m "feat: add homing, splash, split, chain and pierce bullet behaviour"
```

---

### Task 13: Defensive and economy upgrades

**Files:**
- Modify: `void-runner.html` — `hitPlayer`, `update`, `killEnemy`, `startGame`, enemy bullet spawn sites

**Interfaces:**
- Consumes: `stats.shieldCharges`, `shieldRegen`, `fortress`, `phaseBoost`, `lifePerKills`, `enemyBulletMul`, `hitScale`, `extraLives`.
- Produces: `player.shieldCharges`, `player.shieldRegenTimer`.

Covers PLATING, KINETIC BARRIER, FORTRESS, PHASE DRIVE, VAMPIRIC CORE, REPAIR KIT, EVASION FIELD, TIME DILATION and IMMORTAL ENGINE.

- [ ] **Step 1: Replace the single shield with charges**

In `hitPlayer`, replace the existing shield check with:

```javascript
  if (player.invincible > 0) return;
  if (stats.phaseBoost && player.boost > 0) return;
  if (player.shieldCharges > 0) {
    player.shieldCharges--;
    player.invincible = 60;
    FX.addShake(8);
    Sound.play('shieldBreak');
    return;
  }
```

This runs before the upgrade-strip block from Task 8, so a shielded hit costs neither a life nor an upgrade.

- [ ] **Step 2: Regenerate shields**

In `update`, in the per-frame player section:

```javascript
  if (stats.shieldRegen > 0) {
    player.shieldRegenTimer = (player.shieldRegenTimer || 0) + 1;
    if (player.shieldRegenTimer >= stats.shieldRegen) {
      player.shieldRegenTimer = 0;
      player.shieldCharges = Math.min(player.shieldCharges + 1, stats.shieldCharges + 3);
    }
  }
```

- [ ] **Step 3: Vampiric lives**

In `killEnemy`, after the scrap line:

```javascript
  if (stats.lifePerKills > 0) {
    killsSinceLife++;
    if (killsSinceLife >= stats.lifePerKills) {
      killsSinceLife = 0; lives++;
      addFlashText('+1 LIFE', player.x, player.y - 40, '#44ff88');
    }
  }
```

- [ ] **Step 4: Slow enemy bullets and shrink the hitbox**

Wherever an enemy bullet is created, multiply its `vx`/`vy` by `stats.enemyBulletMul`. In `applyShip`/`recomputeStats`, set `player.w = def.hitW * stats.hitScale` and `player.h = def.hitH * stats.hitScale`.

- [ ] **Step 5: Draw shield charges**

In `drawShip`, replace the single shield bubble condition with `shield > 0` where `shield` is now the charge count, and draw one ring per charge at radii `26 + i*5`, capped at 3 rings.

- [ ] **Step 6: Verify each**

| console | expect |
| --- | --- |
| `runUpgrades=[{id:'plating',stacks:3}]; recomputeStats(); player.shieldCharges=3;` | three rings; three free hits |
| `runUpgrades=[{id:'time_dilation',stacks:1}]; recomputeStats();` | enemy bullets visibly slower |
| `runUpgrades=[{id:'vampiric',stacks:1}]; recomputeStats();` | +1 LIFE after 30 kills |
| `runUpgrades=[{id:'evasion',stacks:5}]; recomputeStats(); player.w;` | smaller than the ship's `hitW` |

- [ ] **Step 7: Commit**

```bash
git add void-runner.html
git commit -m "feat: add shield charges, regen, vampiric lives and bullet slowing"
```

---

### Task 14: Orbital drone and singularity

**Files:**
- Modify: `void-runner.html` — new entity arrays, `update`, `draw`, `startGame`

**Interfaces:**
- Produces: `drones[]` and `singularity` globals, `updateDrones()`, `updateSingularity()`, `drawDrones()`, `drawSingularity()`.

- [ ] **Step 1: Add the drone**

```javascript
let drones = [];

function syncDrones() {
  while (drones.length < stats.drones) drones.push({ angle: drones.length * Math.PI, fire: 0 });
  while (drones.length > stats.drones) drones.pop();
}

function updateDrones() {
  drones.forEach(d => {
    d.angle += 0.03;
    d.x = player.x + Math.cos(d.angle) * 46;
    d.y = player.y + Math.sin(d.angle) * 32;
    if (--d.fire <= 0) {
      d.fire = 22;
      bullets.push({
        x: d.x, y: d.y - 6, vx: 0, vy: -BULLET_SPEED,
        w: 2, h: 8, pierce: 0, damage: stats.damage * 0.5,
        homing: 0, splash: 0, split: false, crit: false, dead: false
      });
    }
  });
}

function drawDrones() {
  drones.forEach(d => {
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.fillStyle = '#ffaa22';
    ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#ffdd88'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.restore();
  });
}
```

Call `syncDrones()` at the end of `recomputeStats()`, `updateDrones()` in `update`, and `drawDrones()` in `draw` just after the player is drawn.

- [ ] **Step 2: Add the singularity**

```javascript
let singularity = null;

function updateSingularity() {
  if (!stats.singularity) { singularity = null; return; }
  if (!singularity) singularity = { angle: 0 };
  singularity.angle += 0.02;
  singularity.x = player.x + Math.cos(singularity.angle) * 70;
  singularity.y = player.y + Math.sin(singularity.angle) * 52;
  enemies.forEach(e => {
    if (e.dead) return;
    const dx = singularity.x - e.x, dy = singularity.y - e.y;
    const d = Math.hypot(dx, dy);
    if (d < 120) {
      e.x += (dx / d) * 1.6; e.y += (dy / d) * 1.6;
      if (d < 26) { e.hp -= 0.5; e.flash = 3; if (e.hp <= 0) killEnemy(e); }
    }
  });
}

function drawSingularity() {
  if (!singularity) return;
  ctx.save();
  ctx.translate(singularity.x, singularity.y);
  const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 24);
  g.addColorStop(0, '#000000');
  g.addColorStop(0.6, 'rgba(120,0,200,0.7)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, 24, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = 'rgba(200,120,255,0.8)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(0, 0, 9 + Math.sin(frame*0.1)*2, 0, Math.PI*2); ctx.stroke();
  ctx.restore();
}
```

Call `updateSingularity()` in `update` and `drawSingularity()` in `draw`. Reset `drones = []; singularity = null;` in `startGame`.

- [ ] **Step 3: Verify**

Console: `runUpgrades=[{id:'orbital_drone',stacks:1},{id:'singularity',stacks:1}]; recomputeStats();`
Expected: an orange drone orbits and fires; a black orb orbits, drags enemies toward it, and grinds them down at close range.

- [ ] **Step 4: Commit**

```bash
git add void-runner.html
git commit -m "feat: add orbital drone and singularity"
```

---

### Task 15: HUD and build display

**Files:**
- Modify: `void-runner.html` — `drawHUD` (1893-1975), `drawGameOver` (2169-2213)

- [ ] **Step 1: Show scrap and the build**

In `drawHUD`, add under the score:

```javascript
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffdd44'; ctx.font = 'bold 12px monospace';
  ctx.fillText('SCRAP ' + Math.floor(scrap).toLocaleString(), 14, 88);

  // Owned upgrades as a stack of rarity-coloured pips down the left edge.
  runUpgrades.forEach((o, i) => {
    const u = RLCore.UPGRADES.find(x => x.id === o.id);
    if (!u) return;
    const t = RLCore.tierOf(u.tier);
    const y = 104 + i * 12;
    ctx.fillStyle = t.color;
    ctx.fillRect(14, y, 6, 6);
    ctx.font = '8px monospace';
    ctx.fillStyle = 'rgba(200,220,240,0.75)';
    ctx.fillText(u.name + (o.stacks > 1 ? ' x' + o.stacks : ''), 24, y + 6);
  });
```

- [ ] **Step 2: Show scrap spent on the game-over screen**

In `drawGameOver`, add a row: `SCRAP SPENT` with `scrapSpent.toLocaleString()`.

- [ ] **Step 3: Verify**

Play a run, buy upgrades, confirm the HUD lists them with correct colours and stack counts and that the list does not overflow the screen with 10+ upgrades.

- [ ] **Step 4: Commit**

```bash
git add void-runner.html
git commit -m "feat: show scrap and the current build in the HUD"
```

---

### Task 16: Verification pass and balance

**Files:**
- Modify: `void-runner.html` as needed for tuning
- Create: `docs/superpowers/verification-2026-08-07.md`

- [ ] **Step 1: Run the full test suite**

Run: `node --test tests/`
Expected: all tests pass. Record the count.

- [ ] **Step 2: Confirm the pure block stayed pure**

Run:

```bash
node -e "
const {readFileSync}=require('fs');
const s=readFileSync('void-runner.html','utf8');
const a=s.indexOf('// ===== ROGUELIKE CORE (PURE) =====');
const b=s.indexOf('// ===== END ROGUELIKE CORE (PURE) =====');
const body=s.slice(a,b);
const bad=['document','window','ctx','canvas','Save.','Sound.','Math.random'];
const hits=bad.filter(t=>body.includes(t));
console.log(hits.length?'IMPURE: '+hits.join(', '):'pure block is clean');
process.exit(hits.length?1:0);"
```

Expected: `pure block is clean`.

- [ ] **Step 3: Work through the spec's verification list**

Execute all nine checks from the "Verification" section of
`docs/superpowers/specs/2026-08-07-roguelike-core-design.md`, capturing a screenshot for each.

- [ ] **Step 4: Measure boss balance at both extremes**

Play to level 5 twice: once buying nothing, once buying every affordable upgrade. Record time-to-kill for each. If the stacked run kills the boss in under 4 seconds, raise the `12000` divisor in `RLCore.bossHpMultiplier`; if the minimal run cannot kill it before dying twice, lower the `1.5` cap. Re-run the tests after any change.

- [ ] **Step 5: Write up the results**

Create `docs/superpowers/verification-2026-08-07.md` recording: test count, the nine spec checks with pass/fail, the two boss timings, and any tuning values changed.

- [ ] **Step 6: Commit and deploy**

```bash
git add -A
git commit -m "test: verification pass for roguelike core"
git push origin main
```

The push auto-deploys to voidrunner-game.vercel.app. Confirm the live site loads, plays, and shows a clean console.

---

## Self-Review

**Spec coverage:** Two currencies → Task 8. Scrap ignoring combo → Task 8 step 3. Credits ÷100 → Task 6. Rarity table and drift → Task 3. Fixed APEX odds → Task 3. 29 upgrades → Task 4. Stacking limits → Tasks 3-4. Hit penalty → Tasks 6, 8. Shop timer, reroll, depart, carry-over scrap → Tasks 9-10. Rarity colours and APEX presentation → Tasks 9-10. Removals → Task 7. Firing after the ladder → Tasks 8, 11. Boss scaling → Tasks 6, 8, 16. Save migration → Task 2. Error handling → Tasks 4 (tier fallback), 12 (homing with no target), 9 (timer via frame loop). Verification → Task 16.

**Placeholders:** none — every step carries runnable code or an exact command.

**Type consistency:** `owned` is `[{id, stacks}]` throughout Tasks 4-6 and 8. `stats` field names in Task 5 match their consumers in Tasks 8, 11, 12, 13 and 14. `RLCore.tierOf(tier).price` is used consistently in Tasks 10 and 15. Bullet fields created in Task 11 (`damage`, `pierce`, `homing`, `splash`, `split`, `crit`) are exactly those read in Task 12.
