# VOID RUNNER — Ships & Weapons Expansion

Design spec, 2026-08-06.

Extends the shop from four ships and one gun to **eight ships and five guns**, all bought
with credits. Guns become a *choice* rather than a ladder: you buy a gun, select it before
a run, and it still powers up 1→5 through `W` pickups and still drops a level when you take
a hit.

## Goals

- Four new ships, each with a distinct silhouette and one mechanical hook — not recolors.
- Five guns that are sidegrades, so the free gun stays viable and the expensive ones are
  specialists rather than strict upgrades.
- Existing save data survives untouched: same credits, same owned ships, same stats.
- Single file, no build step, no dependencies. Unchanged.

## Non-goals

- No new enemy types, levels, or bosses.
- No change to how credits are earned (`floor(score / 60)`), except Scavenger's multiplier.
- No rebalancing of existing ships beyond moving Bulwark's hardcoded shield into config.

## Ships

Existing four keep their ids, costs, and stats. Four new ones:

| id | name | cost | lives | speed | fireMul | hitW×hitH | hook |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `warden` | WARDEN | 1,800 | 3 | 5.0 | 1.05 | 30×38 | `graceHits: 1` |
| `scavenger` | SCAVENGER | 2,500 | 3 | 5.8 | 1.10 | 30×38 | `magnet: 140`, `creditMul: 1.25` |
| `revenant` | REVENANT | 4,500 | 2 | 6.5 | 0.85 | 24×34 | `startWeaponLv: 3` |
| `titan` | TITAN | 9,000 | 5 | 4.2 | 1.15 | 36×42 | `startShield: 240`, `regenEvery: 5` |

Hook semantics:

- **`graceHits: n`** — the first `n` hits *per level* do not decrement weapon level. Lives are
  still lost as normal. The counter resets on each level start, alongside Phantom's phase
  recharge.
- **`magnet: px`** — powerups within `px` pixels drift toward the player at 2.2 px/frame.
- **`creditMul: n`** — run payout becomes `floor(score / 60 * n)`. Applied once, at banking.
- **`startWeaponLv: n`** — run begins at gun level `n` instead of 1.
- **`startShield: frames`** — run begins with `player.shield` set to `frames`.
- **`regenEvery: n`** — on completing every `n`th level, gain one life, capped at the ship's
  starting `lives`.

### Generalizing Bulwark's shield

`startShip()` currently contains `if (def.id === 'bulwark') player.shield = 180;`. This
becomes `startShield: 180` on the Bulwark config entry, read by the same code path Titan
uses. No behavior change; it removes the id-special-case before three more would join it.

### Hull rendering

`drawShip()` currently draws one silhouette for every ship, varying only `hull[]` colors and
`trim`. Each ship gains a `hull` key naming a draw function; `drawShip()` keeps ownership of
the shared chrome (engine flames, cockpit glow, shield bubble, phase ring, muzzle flash,
invincibility flicker) and delegates only the body outline.

| ship | silhouette |
| --- | --- |
| vanguard | current shape, retained as the baseline |
| needle | narrow dart, swept-back fins |
| bulwark | wide slab hull, blunt nose, side armor plates |
| phantom | small delta, cut-out center |
| warden | rounded hull with a forward shield plate |
| scavenger | asymmetric, cargo pods and a collector dish |
| revenant | skeletal frame, exposed spine, forward-swept wings |
| titan | heavy carrier profile, layered plating, four engines |

Each draw function receives `(ctx, c0, c1, c2, trim)` and draws to a shape roughly bounded by
the ship's `hitW`/`hitH`, so the preview and the in-game sprite stay consistent.

## Guns

`CFG.weapons` (a single 5-entry array) becomes `CFG.guns`, an ordered array of gun
definitions each holding its own 5-level ladder:

```
{ id, name, cost, blurb, color, levels: [ {...} × 5 ] }
```

Each level entry:

```
{ fireRate, damage, pierce, homing, splash, bulletW, bulletH,
  shots: [ {dx, a}, ... ] }
```

`homing` is a turn rate in radians/frame (0 = straight). `splash` is a blast radius in pixels
(0 = none). `damage` replaces the implicit 1 point per bullet.

| id | name | cost | identity | weakness |
| --- | --- | --- | --- | --- |
| `pulse` | PULSE | 0 | Today's ladder, unchanged | None — the baseline |
| `spread` | SPREAD | 600 | Wide arcs, many shots, damage 1 | Shots diverge; poor single-target DPS |
| `lance` | LANCE | 1,800 | 1–2 narrow shots, `pierce` 2–3, damage 2 | Very narrow; misses scattered swarms |
| `swarm` | SWARM | 3,200 | `homing` 0.05–0.09, damage 1 | Low damage; slow against armored targets |
| `nova` | NOVA | 5,000 | Damage 3, `splash` 26–42, slow fire | Low rate; poor against fast kamikazes |

`pulse` is owned from the start and cannot be sold or locked.

### DPS band

Boss HP is tuned in-code against "~18 hits/sec at weapon level 3" with the current gun. To
keep every gun viable without trivializing bosses, each gun's **single-target** DPS at a given
level must fall within **±25%** of `pulse` at that same level.

DPS is measured empirically, not derived: hold fire on a stationary boss-width target
(112px, matching `BOSS_W`) at mid-screen range for 5 seconds via a temporary instrumentation
hook, and record damage dealt. Measuring rather than calculating is deliberate — spread
angle, pierce, homing curve, and splash overlap all change how many shots actually land, and
a formula would have to guess at each.

Guns differentiate through *coverage, reach, and forgiveness* — not raw single-target output:

- SPREAD wins on multi-target throughput, loses on single-target (bottom of band).
- LANCE wins on lined-up targets via pierce, loses on scattered ones.
- SWARM wins on accuracy under pressure, sits at the bottom of the band on damage.
- NOVA wins on clustered targets via splash, loses on rate.

Boss HP is not re-tuned. If any gun lands outside the band during verification, that gun's
numbers move — not the boss.

## Save format

Version bumps `1 → 2`, adding two fields:

```
ownedGuns: ['pulse'], selectedGun: 'pulse'
```

**Migration is mandatory, not optional.** `Save.load()` currently discards any save whose
version does not match and falls back to defaults. Shipping a version bump on top of that
behavior would erase every existing player's credits, ships, and stats.

`load()` therefore gains an explicit upgrade path:

- `version === 2` — load as-is.
- `version === 1` — keep every existing field, add `ownedGuns: ['pulse']` and
  `selectedGun: 'pulse'`, set version to 2, write back.
- anything else (missing, newer, corrupt) — fall back to defaults, as today.

Existing validation is extended to guns: an unknown `selectedGun`, or an `ownedGuns` that is
missing, empty, or not an array, resets to `['pulse']` / `'pulse'` rather than throwing.

## Menu

The start screen gains a tab pair above the carousel:

```
   ┌ SHIPS ┐ WEAPONS
   └───────┘
```

- `TAB` key, or a tap on either label, switches tabs. Tab choice is view state only; it is
  not persisted.
- The single `selIndex` becomes two independent cursors, one per tab, so switching tabs and
  back returns you to where you were browsing rather than resetting to the first item.
- Both tabs reuse the existing carousel: chevrons, `←`/`→`, the BUY rect, `B` to buy, the
  ownership dot row, and the owned/selected labels.
- Selection is per-tab: browsing to an owned item on the SHIPS tab sets `selectedShip`;
  on the WEAPONS tab it sets `selectedGun`. Both persist, as `selectedShip` does today.
- `SPACE` launches from either tab, gated on `Save.data.selectedShip` being owned. The
  selected gun needs no check, since `pulse` cannot be lost.

  This is a deliberate behavior change. `tryLaunch()` today gates on the *browsed* ship
  (`CFG.ships[selIndex]`), which breaks on the weapons tab where `selIndex` addresses a gun.
  Gating on the stored selection is both correct across tabs and a small improvement: today,
  browsing past a ship you cannot afford disables launch even though you own a flyable ship.

- Pointer handling is tab-aware. A tap on either tab label switches tabs and consumes the
  event. On the SHIPS tab the BUY rect buys the browsed ship, on the WEAPONS tab the browsed
  gun. The existing "a tap anywhere else launches" fallback is retained on both tabs, subject
  to the same `selectedShip` gate. `B` buys the browsed item on whichever tab is active.

The weapons tab replaces the ship preview with a firing-pattern preview: a static muzzle with
the level-3 shot pattern drawn as trails, in the gun's color. Its three stat bars are RATE,
DAMAGE, and COVERAGE, replacing LIVES / SPEED / FIRE.

Layout is unchanged below the carousel, so the stat block, controls text, and launch prompt
keep their current positions. The dot row renders `CFG.ships.length` or `CFG.guns.length`
dots depending on the active tab; at eight ships the row is 8 × 14px = 112px wide, well
inside the 480px canvas.

## In-run changes

- `fireWeapon()` reads `CFG.guns[selectedGun].levels[weaponLevel - 1]` instead of
  `CFG.weapons[weaponLevel - 1]`.
- Bullets carry `damage`, `homing`, and `splash` from the level entry.
- The bullet update loop steers homing bullets toward the nearest live enemy, clamped to the
  gun's turn rate, and does nothing when no enemy exists.
- Enemy, asteroid, and boss hit handling changes from `hp--` to `hp -= b.damage`.
- On a splash bullet's impact, enemies within the radius take the same damage once. Splash
  does not chain and does not damage the player.
- The HUD gun-level readout shows the selected gun's name alongside its level.

## Error handling

Unchanged in character: storage failures degrade to an in-memory save, and an unknown gun or
ship id resolves to the free default rather than throwing. A homing bullet with no target
flies straight. Splash radius is capped so a Nova hit cannot exceed the existing particle
budget (`CFG.caps.particles`).

## Verification

No test framework exists and none is being added; verification is by driving the real game,
matching the approach used for the 2.0 plan.

1. Load an existing v1 save; confirm credits, owned ships, and stats survive and `pulse` is
   present and selected.
2. Confirm each of the eight ships renders distinctly on the menu and in play.
3. Buy one new ship and one new gun; confirm credits deduct, ownership persists across a
   reload, and an unaffordable item cannot be bought.
4. Fire all five guns at level 1 and level 5; confirm shot pattern, damage, pierce, homing,
   and splash behave as specified.
5. Measure each gun's single-target DPS against the ±25% band; adjust guns that fall outside.
6. Reach a boss with a temporary level-skip key using NOVA and SWARM — the extremes of the
   damage range — and confirm neither trivializes nor stonewalls the fight.
7. Confirm each ship hook fires: Warden's grace resets per level, Scavenger's magnet and
   payout, Revenant's level-3 start, Titan's shield and life regen.
8. Confirm the tab switch works by key and by tap, and that `SPACE` is blocked only by an
   unowned ship.

Screenshots captured as evidence at each stage.
