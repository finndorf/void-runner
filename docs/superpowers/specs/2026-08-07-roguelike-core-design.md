# VOID RUNNER — Roguelike Core

Design spec, 2026-08-07. **Phase 1 of 4.**

Converts Void Runner from an arcade shooter with powerup drops into a roguelike. Kills earn
**scrap**, a cargo hauler docks between levels for 30 seconds, and scrap buys upgrades that
last only for the current run. The powerup orbs and the 1→5 weapon ladder are removed and
replaced by the upgrade system.

## Phasing

This spec covers phase 1 only. Later phases, each with its own spec:

2. Themed stages, and fixing enemies that attack from off to the side.
3. Seven more ships (11 total) and better hull art.
4. Soundtrack.

The ships-and-weapons spec of 2026-08-06 is **superseded**. Its four ship designs and the
per-ship hull art carry forward into phase 3; its five buyable guns do not — a rarity-rolled
upgrade shop replaces that economy.

## Goals

- Each run is its own story: build up, get strong, die, start clean.
- Luck matters. A good roll should change how a run plays, not just raise a number.
- Cheap upgrades stay meaningful for the whole run.
- Existing save data survives untouched.
- Single file, no build step, no dependencies. Unchanged.

## Non-goals

- No new enemy types, stage themes, ships, or music. Those are phases 2–4.
- No change to the ship roster or to how ships are bought.
- No run-resume. A closed tab ends the run, as today.

## Two currencies

Score cannot double as the run wallet — spending it would mean shopping damages your high
score. So the run carries two numbers:

| | earned from | spent on | survives the run |
| --- | --- | --- | --- |
| **SCORE** | kills × combo multiplier, level clears | nothing | yes — records, and credits |
| **SCRAP** | kills (base points, no combo), level clears | upgrades, rerolls | no |
| **CREDITS** | `floor(score / 100)` at run end | ships (unchanged) | yes |

**Scrap deliberately ignores the combo multiplier.** Score keeps it, so combo remains a
scoring skill. If scrap scaled with combo, a hot streak would hand out an APEX while a cold
run could not afford a common, and the shop would swing between trivial and pointless.

Scrap per kill equals the enemy's existing point value (mine 80, grunt 100, kamikaze 120,
elite 200, turret 300), plus 500 per level cleared. At roughly 20–25 kills per level this is
**~3,000 scrap per level**.

Unspent scrap carries between shops within a run, so saving for an expensive tier is a valid
strategy.

**Credits change from `floor(score / 60)` to `floor(score / 100)`** — a 40% cut, satisfying
"money harder to get". Phase 3 adds seven ships to buy, so this dial and ship prices interact;
this value is set now and revisited once those ships exist, rather than corrected twice.

## Rarity

| tier | chance per slot | price | stacking |
| --- | --- | --- | --- |
| COMMON | 52% | 240 | up to 5 |
| UNCOMMON | 27% | 500 | up to 5 |
| RARE | 13% | 900 | unique |
| EPIC | 6% | 2,100 | unique |
| LEGENDARY | 1.7% | 4,500 | unique |
| APEX | 0.3% | 9,000 | unique |

Weights sum to 100. Each of the three shop slots rolls independently, so the chance of seeing
an APEX is 0.90% per shop and **~7% across an 8-level run — about one every 14 runs**. At
9,000 scrap it also costs roughly three levels of income, so winning the lottery still
requires having saved.

**Odds drift with depth.** From level 3 onward, each slot's roll shifts weight from COMMON
toward higher tiers by 1.5 percentage points per level, capped at level 12. APEX's 0.3% is
**fixed and never drifts** — it is the one constant the player can rely on. Drift is taken
from COMMON and distributed proportionally across UNCOMMON through LEGENDARY.

An already-owned unique upgrade is excluded from rolls. If a tier has no eligible upgrades
left, the roll falls to the next tier down.

## Upgrades

29 upgrades. Commons and uncommons are stackable numbers; rare and above are named abilities.
All effects are multiplicative on the ship's base stats unless stated.

### COMMON — 240, stacks to 5

| name | effect |
| --- | --- |
| RELOAD COIL | +8% fire rate |
| HEAVY ROUNDS | +10% damage |
| THRUSTERS | +8% move speed |
| PLATING | +1 shield charge (each blocks one hit) |
| SCRAP MAGNET | +10% scrap from kills |
| TIGHT BARREL | −10% shot spread |

### UNCOMMON — 500, stacks to 5

| name | effect |
| --- | --- |
| TWIN FEED | +15% fire rate |
| AP ROUNDS | +18% damage |
| REPAIR KIT | +1 life, up to the ship's starting lives + 2 |
| EVASION FIELD | +12% speed, −10% hitbox |
| SALVAGE RIG | +20% scrap from kills |
| WIDE MOUNT | +1 shot on the firing pattern |

### RARE — 900, unique

| name | effect |
| --- | --- |
| PIERCING ROUNDS | shots pass through one enemy |
| SPLIT SHOT | shots split into two on impact |
| OVERCHARGE | every 5th shot deals triple damage |
| KINETIC BARRIER | one shield charge regenerates every 20s |
| HUNTER ROUNDS | shots steer gently toward enemies |

### EPIC — 2,100, unique

| name | effect |
| --- | --- |
| REAR CANNON | you also fire backwards |
| SIDE PODS | you also fire left and right |
| FLAK BURST | shots explode in a small blast |
| PHASE DRIVE | boost grants brief invulnerability |
| VAMPIRIC CORE | every 30 kills restores a life |

### LEGENDARY — 4,500, unique

| name | effect |
| --- | --- |
| ORBITAL DRONE | an autonomous drone fights beside you |
| CHAIN LIGHTNING | hits arc to two nearby enemies |
| TIME DILATION | enemy bullets travel 35% slower |
| FORTRESS | start each level with full shields and 2 charges |

### APEX — 9,000, unique

| name | effect |
| --- | --- |
| TWIN CORE | every weapon effect fires twice |
| SINGULARITY | a black hole orbits you, pulling in and crushing enemies |
| IMMORTAL ENGINE | your first death in a run does not end the run |

SIDE PODS and REAR CANNON partly anticipate the phase-2 work on enemies attacking from off to
the side. They are upgrades, not the fix — phase 2 addresses that in the enemy design itself.

## Getting hit

A hit costs a life, as today, and **removes one stack of the player's cheapest upgrade**.

Resolution order: lowest rarity first; within a rarity, the most recently acquired; a
stackable upgrade loses one stack rather than the whole entry. Unique upgrades are only
exposed once no stackable ones remain.

This preserves the loss-on-hit tension of the current weapon ladder while protecting rare
rolls, and gives commons a real job — three stacks of RELOAD COIL are three hits of armour
around an ORBITAL DRONE. Shield charges absorb a hit before any of this applies, so a shielded
hit costs neither a life nor an upgrade.

## The shop

Between levels, a cargo hauler slides in from the right and docks alongside the player.
Enemies, spawns, and enemy bullets stop; the player ship remains on screen and controllable
but nothing threatens it.

- **30-second countdown**, displayed. On expiry the hauler undocks and the next level starts.
- **Three slots**, each showing rarity name, upgrade name, one-line effect, and price, framed
  in the rarity colour.
- **REROLL** re-rolls all three slots. Costs 300 scrap, doubling with each use within the same
  shop (300, 600, 1,200, …). The cost resets at the next shop.
- **DEPART** starts the next level immediately.
- Unaffordable slots render dimmed and cannot be bought.
- Buying does not close the shop; the bought slot empties and the remaining time continues.

Rarity colours: COMMON `#b8c4d0`, UNCOMMON `#44dd77`, RARE `#3399ff`, EPIC `#aa66ff`,
LEGENDARY `#ffaa22`, APEX cycles between `#00ffee` and `#ffdd33`.

An APEX roll plays a distinct sound and flashes the screen, so the player registers it before
reading the card.

Input: `←`/`→` move between slots, `SPACE`/`Enter` buys the highlighted slot, `R` rerolls,
`D` or `ESC` departs. Every control also has a tap target, matching the menu's existing
pointer handling.

## Removals

- The powerup entities entirely: `powerups[]`, `POWERUP_COLOR`, `POWERUP_LETTER`, the drop
  roll on enemy death, the pickup collision, and their draw and update paths.
- `player.weaponLevel` and the `CFG.weapons` 1→5 ladder.
- The menu's "W upgrades your gun / a hit costs one" and "S = Shield  B = Boost" control text,
  replaced by text describing scrap and the shop.

Shields and boost survive as upgrades (PLATING, KINETIC BARRIER, FORTRESS; PHASE DRIVE), so
the abilities remain but become purchases rather than lucky drops.

## Firing after the ladder

Without weapon levels, the player's gun is the ship's base pattern modified by upgrades. Base
fire is the current level-2 pattern: two forward shots, `fireRate` 10, damage 1, no pierce.

Upgrades modify a resolved stat block recomputed whenever the upgrade set changes:

```
fireRate, damage, shots[], pierce, spread, homing, splash, speed, hitScale
```

Bullets gain `damage`, `homing`, `splash`, and `pierce` fields, replacing the current implicit
1 damage. Enemy, asteroid, and boss hit handling changes from `hp--` to `hp -= b.damage`.

## Boss scaling

Boss HP is currently a fixed curve tuned against one fixed player strength — a code comment
records it as "~18 hits/sec at weapon level 3". Builds now range from three commons to TWIN
CORE plus a drone, so a fixed curve will either evaporate or wall.

Boss HP therefore scales with **scrap spent this run**, which is the best available proxy for
build strength:

```
bossHP = baseHP(level) × (1 + min(1.5, scrapSpent / 12000))
```

A player who has spent nothing fights the current boss. A player who has spent 12,000 or more
fights one with 2.5× the health, capped so it can never outrun a strong build entirely.

Scrap *spent* is used rather than scrap *earned*, so hoarding is not punished — only actual
power is.

This formula is a starting point and is expected to move during playtesting. It is the single
most likely number in this spec to be wrong.

## Save format

Upgrades are per-run and are not persisted. The save gains only statistics:

```
bestScrapSpent: 0, apexFound: 0
```

Version bumps `1 → 2`. **Migration is mandatory.** `Save.load()` currently discards any save
whose version does not match and falls back to defaults; shipping a version bump on top of
that would erase every existing player's credits, ships, and records.

- `version === 2` — load as-is.
- `version === 1` — keep every existing field, add the two new counters at 0, set version to
  2, write back.
- anything else — fall back to defaults, as today.

## Error handling

Unchanged in character. Storage failures degrade to an in-memory save. An empty eligible-
upgrade pool falls to a lower tier rather than rendering an empty slot. A homing bullet with
no target flies straight. Splash and chain effects are capped so a single hit cannot exceed
`CFG.caps.particles`. The shop timer is driven by the existing frame loop, so a backgrounded
tab pauses it rather than skipping the shop.

## Verification

No test framework exists and none is being added; verification is by driving the real game,
matching the approach used for the 2.0 plan.

1. Load an existing v1 save; confirm credits, owned ships, and records survive and the new
   counters appear at 0.
2. Confirm no orb ever drops and that no reference to the weapon ladder remains in play.
3. Confirm scrap accrues at the specified rates and ignores the combo multiplier while score
   does not.
4. Force each rarity via a temporary roll override; confirm price, colour, stacking limit, and
   uniqueness for every one of the 29 upgrades.
5. Confirm APEX presentation: sound, flash, and that 0.3% does not drift with depth.
6. Confirm the hit rule: stacks are removed cheapest-first, uniques survive while stackables
   remain, and a shield charge absorbs a hit without any upgrade loss.
7. Confirm the shop: 30-second expiry, early departure, reroll cost doubling and resetting,
   dimmed unaffordable slots, and that scrap carries between shops.
8. Reach a boss with a minimal build and with a heavily-stacked build; confirm the fight is
   neither trivial nor impossible at both extremes, and record the numbers.
9. Confirm a backgrounded tab does not burn shop time.

Screenshots captured as evidence at each stage.
