# Verification — Roguelike Core (2026-08-07)

Task 16 of the roguelike-core plan. Branch `roguelike-core`. This is a verification and
balance-measurement pass, not a feature task — findings below include two real
discrepancies against the design spec that were **not** fixed as part of this task, since
fixing them was outside this task's sanctioned scope (test coverage + `bossHpMultiplier`
tuning only). They're flagged for the project owner's decision before merge.

## 1. Automated checks

**Test suite:** `node --test tests/*.mjs` — **45 / 45 pass** (was 42; added 3 for the
`max()` combinator gap described below).

**Purity scan** (comment-stripped, per the brief's script): `pure block is clean`.

**Syntax check** of the extracted inline `<script>` (111,507 chars, single `<script>` tag):
`node --check` — clean.

### Closed test gap: the `max()` combinator in `RLCore.resolveStats`

Seven upgrades (`homing`, `splash`, `shieldRegen`, `overcharge`, `lifePerKills`, `chain`,
`fortress`) are resolved with a `max()` reducer instead of `sum()`. No test exercised any of
them before this task. That mattered: `max()`'s accumulator starts at 0, and every one of
those effect values is positive, so a reversed comparison (`Math.min` instead of `Math.max`)
would have silently collapsed all seven to 0 and the full 42-test suite would still have
passed. Added in `tests/roguelike.test.mjs`:

- All seven values resolve to their catalog magnitude, not 0 (catches the reversed-comparison
  bug directly).
- `max()` ignores `stacks` — passing `stacks: 5` on a unique upgrade still yields the raw
  effect value, proving it isn't a sum in disguise.
- All seven default to 0 when no upgrade grants the key.

## 2. Spec verification checklist (9 checks)

Driven live in Chrome via `mcp__chrome-devtools__*` against
`file:///Users/cameronconway/void-runner/void-runner.html`, using the page's own real global
state and functions through `evaluate_script` (no reimplementation of game logic). A real
save already existed in this browser's localStorage from prior sessions
(`hiScore 81037, totalRuns 56, credits 3325, ...`) — it was backed up and restored at every
step. **Screenshots saved to `/tmp/vr-*.png`** (not committed — outside the single-file/no-new-runtime-files constraint; paths given below for reference).

| # | Check | Result |
|---|---|---|
| 1 | v1 save migrates cleanly (credits/ships/records survive, new counters at 0) | **PASS** — injected a v1 save, reloaded, `Save.data` came back `version:2`, all v1 fields intact, `bestScrapSpent:0, apexFound:0`, written back to storage. `/tmp/vr-02-v1-migration.png` |
| 2 | No orb ever drops; no weapon-ladder reference remains in play | **PASS** — `grep` for `powerup`/`POWERUP`/`weaponLevel`/`CFG.weapons` in the codebase finds nothing live. Menu screen shows the new scrap/shop control text (`auto-fire is always on`, `kills earn SCRAP — spend it when cargo docks`), not the old ladder text. Minor note: `Sound.play()` still has dead `'powerup'`/`'weaponUp'` cases in its switch — harmless, never called, but technically unremoved dead code. `/tmp/vr-01-start.png` |
| 3 | Scrap accrues at spec'd rates, ignores combo; score doesn't | **PARTIAL FAIL** — per-kill: confirmed exactly right (`combo=30` → `comboMultiplier()=8`; killing a grunt gave `score +800` (100×8) and `scrap +100` (ignores the multiplier), matching `RLCore.scrapForKill` exactly. **But the spec's "+500 per level cleared" scrap bonus does not exist anywhere in the code** — `grep` for a level-clear scrap bonus in `levelUp()`/`closeShop()` finds nothing; only `killEnemy()` ever adds to `scrap`. This is a real gap between the design spec and the shipped implementation, not a test artifact. **Not fixed here** (out of this task's scope) — flagged for the project owner. |
| 4 | Every one of 29 upgrades: price, colour, stacking, uniqueness | **PASS** — structurally exhaustive via the unit suite (catalog counts, unique ids, `eligible()` stack-limit behavior). Spot-checked rendering in the real shop UI across all 6 tiers (two shop screenshots, 3 tiers each): colours, names, prices, and effect text all correct. `/tmp/vr-03-shop-tiers-low.png`, `/tmp/vr-04-shop-tiers-high.png` |
| 5 | APEX presentation (sound + flash) and fixed 0.3% (no drift) | **PASS** — `RLCore` unit tests already prove APEX never drifts (0.3% at every level 1–20). Forced an APEX slot into the shop with sufficient scrap: `noteApex()` fired, `Save.data.apexFound` incremented, card rendered full-brightness with the cycling border colour (`#00ffee` in the captured frame — code confirms it alternates with `#ffdd33` every 6 frames). Sound.play('apex') case exists and is reachable. `/tmp/vr-05-apex-affordable.png` |
| 6 | Hit rule: cheapest-first, uniques survive, shield absorbs free | **PASS** — gave the player `reload_coil x3` + `orbital_drone x1` and 1 shield charge. A hit with shield up: 0 upgrade loss, 0 life loss, shield charge consumed (1→0). A second hit with shield gone: `reload_coil` dropped 3→2 stacks, `orbital_drone` untouched, exactly 1 life lost. Matches `RLCore.stripCheapest` semantics exactly. |
| 7 | Shop: 30s expiry, early depart, reroll doubling/reset, dimmed unaffordable, scrap carries | **PASS** — `shopTimer` opens at 1800 (30×60); 4 successive rerolls cost exactly 300/600/1200/2400 (`RLCore.rerollCost`); natural expiry (`shopTimer→0` + `updateShop()`) returns to `state:'play'`; the *next* shop's first reroll is back to 300; scrap carried across the boundary unchanged (45,500 → 45,500); an unaffordable APEX card rendered at 0.45 alpha in the tier-screenshot above; `closeShop()` (the D/Escape handler) ends the shop immediately regardless of remaining timer. |
| 8 | Boss balance at both extremes | **FAIL at the minimal extreme** — see §3 below. Stacked extreme is fine. |
| 9 | A backgrounded tab does not burn shop time | **UNVERIFIED** — opened a second foreground tab (backgrounding the game tab) for ~4s of explicit wait plus tool round-trip time, then switched back: `shopTimer` had dropped by 940 frames over what was very likely closer to ~15s of real wall-clock time (roughly 60fps, i.e. *not* throttled). This does not prove the real feature is broken — it more likely means this automation harness doesn't produce genuine OS-level tab backgrounding (`document.visibilityState` couldn't be sampled *while* actually hidden without the very act of sampling re-focusing the page, which is a limitation of `evaluate_script` needing a selected page). By code inspection, `shopTimer--` only happens inside `updateShop()`, which is only ever called from `loop()`, which is only ever scheduled via `requestAnimationFrame` — a mechanism real browsers are documented to throttle/suspend for hidden tabs — so the design is correct by construction. I could not get a trustworthy empirical read on it with the tools available, so this is reported as unverified rather than pass, per instructions to prefer an honest "unverified" over an unreliable claim. |

**Console:** one error appeared on the very first page load only — `Unsafe attempt to load
URL ... from frame with URL ...` — this references no code in `void-runner.html` (no
`iframe`/`location.*`/`top.*`/`parent.*` anywhere in the file; confirmed by grep) and never
recurred after that first load. Read as a browser-automation-tooling artifact of `new_page`,
not a game bug. No other console errors were seen across the entire session, including
during the boss-fight stress tests below.

## 3. Boss balance measurement (the substantive part)

### Method

Driven via `mcp__chrome-devtools__evaluate_script` against the live page, calling the game's
**own real functions** (not a reimplementation): `killEnemy()`, `pickEnemyKind()`,
`openShop()`, `tryBuySlot()`, `tryReroll()`, `closeShop()`, `spawnBoss()`, `update()`. This
was chosen over manual play because it's exactly reproducible and because auto-fire means
the player doesn't need simulated key-presses to shoot — `update()` fires on its own timer.

- **Ship forced to VANGUARD** (`lives:3, speed:5.5, fireMul:1.00` — the baseline/first ship)
  via `Save.data.selectedShip`, restored afterward. This mattered: `recomputeStats()` reads
  the ship from `currentShip()` (i.e. `Save.data.selectedShip`), **not** from whatever
  `applyShip()` was last called with — an early attempt to force Vanguard via `applyShip()`
  alone silently kept resolving stats against the browser's actual saved ship (`needle`,
  `fireMul:0.62`), which produced ~1.6× the real fire rate and invalidated that run. Caught
  via a diagnostic and corrected.
- **4 shop cycles simulated per run** (levels 1→2→3→4→5), matching the real game's actual
  flow (`level%5===0` auto-spawns the boss on the 4th `closeShop()`). Each level's scrap
  income was earned by calling the real `killEnemy()` 22 times per level (spec's own
  "~20–25 kills/level" estimate) with the real weighted enemy mix
  (`pickEnemyKind()`/`ENEMY[...].points`) — i.e. real per-kill scrap, not an injected flat
  number. Given the missing level-clear bonus (§2, check 3), this yields realistic
  *actual* in-game income (not the spec's idealized ~3,000/level).
- **Minimal build:** bought nothing at any of the 4 shops.
- **Stacked build:** at each shop, bought every affordable slot, rerolling (spending real
  scrap on it) whenever nothing on offer was affordable but a reroll was — i.e. aggressively
  maximized spend, matching "buy every affordable upgrade" in spirit.
- **Player movement (dodging):** the static, unmoving-player version of this test was
  discarded — it made the player a stationary target for every boss attack, which isn't a
  fair test and produced misleadingly bad minimal-build results (dead from full-life-loss in
  under a second of engaged combat). The final version uses a small heuristic pilot: track
  toward `boss.x` when no threat is close (to keep bullets landing — the boss can only chase
  the player at 1.2px/frame, far slower than any ship), and dodge away from the nearest
  incoming enemy bullet/minion/boss-laser within a lookahead window otherwise, capped to
  never drift more than 70px from `boss.x` (an early uncapped version let fast,
  evasion-stacked builds dodge themselves permanently out of firing alignment, stalling two
  of three stacked trials at a 180-second safety cutoff with zero damage dealt — also caught
  and corrected). This is a reasonable, competent, but almost certainly **not
  optimal-human-level** pilot; the numbers below should be read with that in mind, especially
  for the minimal build's survival result.
- Boss-kill time is reported two ways: **total** (spawn to death, including the fixed ~2.3s
  entrance animation neither build can affect) and **engaged** (from when the boss stops
  entering and becomes vulnerable, to death) — the tuning rule's "kills the boss in under 4
  seconds" is judged against **engaged** time, since that's the actual DPS window.
- Every trial ran inside `try { Save.data.selectedShip = 'vanguard'; ... } finally { Save.data = backup; Save.write(); }`. **Caveat:** several *earlier, exploratory* diagnostics in this session (before the final method above was settled) called `startGame()`/`endRun()` directly against the real save without a backup/restore guard, and did leave lasting drift in the browser's local save (`hiScore`, `totalRuns`, `credits`, `bestScrapSpent`, `apexFound` all inflated). This was caught at the end of the session and the save was restored byte-for-byte to the value captured at the very start of the session (`hiScore:81037, bestLevel:8, totalRuns:56, totalKills:785, credits:3325, unlocked:[vanguard,needle], selectedShip:needle, muted:false, bestScrapSpent:6260, apexFound:3`), verified via a reload. This localStorage save is local to the testing browser profile, not a repo file, so it has no bearing on the commit — noted here only for full transparency about the session's methodology.

### Results

**Minimal build** (0 scrap spent, `bossHpMultiplier(0) = 1.0`, boss HP 500):

- Took 3 hits at frames 785 / 905 / 1025 (≈2s apart, matching the boss's phase-1 ring-attack
  cadence) — **all 3 lives lost, run ends in defeat**.
- Damage dealt at time of death: **178 / 500 HP (35.6%)**. Never reached the boss's phase-2
  laser (66% HP threshold).
- The unupgraded ship has 0 shield charges (no `PLATING` bought) and ~12 DPS (base pattern:
  2 shots × 1 damage every 10 frames), so any dodge miss is instantly fatal — there is no
  buffer at all at this extreme.

**Stacked build** (3 trials, real shop RNG — "luck matters" means these vary):

| trial | scrap spent | multiplier | boss HP | outcome | total | engaged |
|---|---|---|---|---|---|---|
| 1 | 10,760 | 2.345× | 1,172 | won, 0 lives lost | 19.23s | 16.93s |
| 2 | 10,880 | 2.360× | 1,180 | won, net +2 lives (`vampiric`+`repair_kit`) | 44.85s | 42.55s |
| 3 | 11,480 | 2.435× | 1,218 | won, 0 lives lost | 12.48s | 10.18s |

None of the 3 stacked trials reached the boss's HP cap (12,000 spend → 2.5×) — realistic
income given the missing level-clear bonus tops out lower — but all landed close to it
(2.35–2.44×). Fastest engaged kill was **10.18s**, well clear of the 4-second trigger. The
range (10.18s–42.55s) reflects genuine build-quality variance from shop RNG, matching the
spec's own "luck matters" goal — trial 2's roll leaned defensive (`vampiric`, `flak_burst`,
`overcharge`) without the offense-stacking (`piercing`+`wide_mount`+`hunter_rounds`) that
made trials 1 and 3 much faster.

### Verdict against the tuning rule

The plan's rule: *"if the stacked run kills the boss in under 4 seconds, raise the 12000
divisor; if the minimal run cannot kill it before dying twice, lower the 1.5 cap."*

- **Stacked extreme: no trigger.** Fastest engaged kill was 10.18s, more than 2.5× the
  4-second threshold across all 3 trials. The `12000` divisor does not need raising.
- **Minimal extreme: triggers, but the prescribed lever cannot fix it.** The minimal build
  didn't just fail to kill the boss before "dying twice" — it lost all 3 lives outright. But
  `RLCore.bossHpMultiplier(scrapSpent) = 1 + 1.5 * Math.min(1, scrapSpent / 12000)`, and at
  `scrapSpent = 0` (the exact minimal-build condition), `Math.min(1, 0/12000) = 0`, so the
  multiplier is **`1 + 1.5×0 = 1` for any value of the `1.5` constant whatsoever** — lowering
  it to 0.5, or to 0, produces the identical result at zero spend. The formula's floor is
  fixed at 1.0× by design (the spec's own words: "a player who has spent nothing fights the
  current boss") — and *that* boss is what's failing here, independent of anything
  `bossHpMultiplier` controls.

**No change was made to `RLCore.bossHpMultiplier`.** Making one would have meant reaching
outside the two constants this task was scoped to, into either `bossMaxHp()`'s base curve
(`340 + 160*(lv/5)`, in the impure game code, not the pure block — a level-5 HP change) or
the Task-11 base weapon stats (`fireRate 10`, `damage 1`, 2 shots) — both real design
decisions that deserve their own scrutiny rather than a same-session, single-measurement
patch bolted onto an unrelated tuning task. Flagging loudly per instructions instead: **the
level-5 boss, at its own un-scaled 1.0× baseline, is not currently beatable by a competently
(not necessarily optimally) piloted, fully-unupgraded ship** — it takes only ~35% damage
before running out of lives. This needs a decision from the project owner: soften the base
boss curve, strengthen the base weapon, or accept that "minimal build" runs are expected to
lose here (in which case check 8 in the spec should be read as "beatable with at least a
little investment," not literally "at zero spend").

## Summary

| Item | Result |
|---|---|
| Test suite | 45/45 pass (was 42; +3 for the `max()` gap) |
| Purity scan | clean |
| Syntax check | clean |
| Spec verification checks | 6 PASS, 1 PARTIAL FAIL (missing level-clear scrap bonus), 1 FAIL (minimal-build boss balance), 1 UNVERIFIED (backgrounding, tooling limitation) |
| Boss balance — stacked | fine, no tuning needed (fastest engaged kill 10.18s, threshold is 4s) |
| Boss balance — minimal | fails hard (35.6% damage dealt, all 3 lives lost); not fixable via the two `bossHpMultiplier` constants; **no code change made**, flagged for the project owner |
| `RLCore.bossHpMultiplier` | **unchanged** (`1 + 1.5 * Math.min(1, scrapSpent / 12000)`) |

---

# Addendum — final fix wave (2026-08-07, post-review)

Everything above describes the state of the branch **before** the final whole-branch review's
fix wave. This addendum records the re-measurement after that wave landed. Commands and
figures below supersede §3 where they conflict.

## Automated checks (re-run)

| check | result |
|---|---|
| `node --test tests/*.mjs` | **49 / 49 pass** (45 + 4 new: v1-migration records, REPAIR KIT cap, IMMORTAL ENGINE on top of the cap, PHASE DRIVE flag/desc) |
| purity scan (comment-stripped, incl. `player` and `Music.`) | `pure block is clean` |
| `node --check` on the extracted inline script | clean |
| browser console over the whole session | no messages at all |

## What changed that affects the numbers

- `bossMaxHp()` base curve `340 + 160*(lv/5)` → `227 + 107*(lv/5)`. Level-5 base is now
  **334 HP** (was 500). The stale "~18 hits/sec at weapon level 3" comment is gone.
- The boss multiplier now keys off a new `scrapOnUpgrades` counter, not `scrapSpent`, so
  **rerolls no longer inflate boss HP**. `scrapSpent` survives unchanged for the game-over
  readout and `Save.data.bestScrapSpent`.
- The boss now pays scrap (`RLCore.scrapForKill(2000 * tier, stats.scrapMul)`), which it
  never did before.
- `levelUp()` now awards the spec's flat **+500 scrap per level cleared**.

## 1. Measured scrap income per level

Method: a scripted pilot drives the **real** `update()` loop frame by frame — real spawner,
real enemy mix, real auto-fire, real `killEnemy()`. It tracks the nearest enemy above it
horizontally. `player.invincible` is pinned so a death cannot truncate an *income*
measurement; that is the only intervention. Buy-nothing build, VANGUARD, 5 runs, averaged.

| level | avg scrap | avg kills | wall time | note |
|---|---|---|---|---|
| 1 | **1,640** | 11.4 | 24s | includes the +500 clear bonus → ~1,140 from kills |
| 2 | **1,880** | 13.8 | 24s | |
| 3 | **4,292** | 36.4 | 24s | formations start at level 3; income roughly doubles |
| 4 | 4,364 | 36.6 | 24s | |
| 5 | **7,476** | 47.8 | 63.4s | boss level: ~36s fight + 24s of normal play + 2,000 boss scrap |
| 6 | 5,240 | 43.6 | 24s | |

Cumulative scrap on arriving at the level-5 boss: **~12,200**.

Against the spec's estimate of "~20–25 kills per level, ~3,000 scrap per level": levels 1–2
come in at roughly **half** the spec's figure, levels 3+ at **1.4–1.8×** it. The spec's
single flat estimate does not describe the real curve.

## 2. Boss time-to-kill at both extremes (level 5)

**(a) Pure DPS window** — invincibility pinned, so this isolates damage throughput from
piloting. 5 runs each.

| build | boss HP | time to kill |
|---|---|---|
| buy nothing | 334 (mult 1.0×) | **33.4 – 38.1s**, mean 36.4s |
| buy every affordable slot at every shop | 515 – 705 (mult 1.5× – 2.1×) | **9.1 – 42.1s**, median ~16s |

The stacked extreme never approaches the plan's 4-second "too easy" trigger. Under the old
500 HP curve the same no-purchase DPS window was ~56s; it is now ~36s.

**(b) With real damage taken** — no invincibility pin, scripted dodging pilot, 3 lives:

| build | result |
|---|---|
| buy nothing | dealt **49.1%** of 334 HP before losing 3 lives (was **35.6%** of 500 HP pre-fix) |

**This does not confirm a minimal build can win, and I am not claiming it does.** The
scripted pilot cannot dodge and stay on target at the same time: granting it extra lives
scales almost perfectly linearly (3 lives → 49.1%, 5 → 54.8%, 7 → 60.5%, 9 → 66.2%, i.e.
~9.5 HP per extra life), which says the bot's damage output collapses the moment it starts
evading, not that 334 HP is out of reach. A pilot who can hold the firing line through the
boss's phase-1 cadence finishes in ~36s, as (a) shows. **Only human play can settle this
one; it is reported as unverified rather than passed.**

## 3. Behavioural verification of each fix (browser)

Driven at `file:///Users/cameronconway/void-runner/void-runner.html`. The real localStorage
save was captured at the start and restored byte-for-byte at the end.

| fix | evidence |
|---|---|
| PHASE DRIVE fires | Bought via `tryBuySlot` → arrives charged. Hit #1: **0 lives lost, 0 upgrades stripped**. Recharged in exactly **720 frames** (12.0s). Hit #2 while charged: free again. Hit #3 uncharged: `lives 3→2` **and** the upgrade stripped. Screenshot `/tmp/vr-fix-lives-phase.png` shows the purple PHASE recharge bar. |
| boost remnants gone | `grep` for `boost` in `void-runner.html` returns only the ships' `fireMul`/`spreadMul` config and one historical comment. `drawShip`'s dead `boost` parameter removed at all 3 call sites. |
| reroll no longer inflates boss HP | 4 rerolls (300+600+1,200+2,400 = 4,500 scrap): `bossMaxHp(5)` **334 → 334**. One 240-scrap purchase: **334 → 344**. `scrapSpent` still totals 4,740. |
| HUNTER ROUNDS targets the boss | Bullet spawned at `x=60, vx=0` with boss at `x=240`: after 30 frames `vx = +5.88` and `x = 203` — curving onto the boss, not away. |
| lives HUD overflow | `lives = 8` renders 5 pips + `+3`. Screenshot `/tmp/vr-fix-lives-phase.png`. |
| REPAIR KIT cap | VANGUARD (3 base, ceiling 5): buys 1 and 2 succeed (`lives 3→4→5`, 500 scrap each); attempts 3, 4, 5 return `false` with **0 scrap taken**. `resolveStats(..., repair_kit x5).extraLives === 2`. |
| shop departure is safe | 2 enemy bullets in flight, one parked on the hull → `levelUp()` → `enemyBullets.length === 0`. |
| APEX flash renders | `noteApex()` sets `shopApexFlash = 34`; `drawShop` paints a full-screen wash alternating APEX cyan/gold. Screenshot `/tmp/vr-fix-apex-flash2.png` (flash frozen for capture). |
| boss pays scrap | Boss death: **+2,000 scrap** (and +2,000 score). With SCRAP MAGNET ×5 + SALVAGE RIG ×5 (`scrapMul 2.5`): **+5,000**. |
| +500 per level cleared | `levelUp()` → `scrap +500`. Flat by design: SCRAP MAGNET and SALVAGE RIG are both worded "+% scrap **from kills**", and a level clear is not a kill — with `scrapMul 2.5` the bonus is still exactly 500. |

## 4. Open concern, not fixed

`scrapOnUpgrades` is a spend proxy, not a power proxy. A defensively-skewed build raises boss
HP without raising its own damage: one measured stacked run reached a **705 HP** boss and
took **42.1s** — *slower* than the 334 HP no-purchase fight. If the boss curve is tuned
again, weighting the multiplier toward offensive spend (or lowering the 1.5 cap) is a better
lever than the base curve, which is now set correctly against the buy-nothing floor.
