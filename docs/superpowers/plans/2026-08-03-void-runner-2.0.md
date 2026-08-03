# VOID RUNNER 2.0 Implementation Plan

> **Execution note:** Executed inline in the authoring session (no subagents, per user
> instruction). Steps use checkbox (`- [ ]`) syntax for tracking. Because implementation and
> planning share one context, this plan specifies exact interfaces, names, constants, and
> behaviors rather than pasting full implementation bodies — the code is written once, into
> the file, not twice.

**Goal:** Turn VOID RUNNER from a flat, forgettable arcade demo into a game with content
variety, tactile feedback, and persistent progression — while remaining one self-contained
HTML file.

**Architecture:** Single-file, canvas 2D. The file is reorganized into ordered, clearly
delimited sections (Config → Save → Audio → Entities → Systems → Render → Screens → Loop).
Rendering never mutates state; update never draws. All new subsystems are modules exposing
small named interfaces so each phase can be verified independently.

**Tech Stack:** Vanilla JavaScript, Canvas 2D, Web Audio API, `localStorage`. No build step,
no dependencies, no network requests.

## Global Constraints

- **Single file.** `void-runner.html`. All code, styles, and audio synthesis inline. No
  external assets, no fetch/XHR.
- **Canvas 2D only.** No WebGL.
- **Logical resolution 480×720**, letterboxed to fit the viewport (unchanged from v1).
- **Keyboard and touch parity.** Every interactive element must be reachable by tap.
- **Frame budget:** hard caps — particles ≤ 400, bullets ≤ 200, enemyBullets ≤ 300,
  enemies ≤ 40. Oldest evicted on overflow.
- **Graceful degradation:** storage or audio failure must never break playability.
- **Save key:** `voidrunner.save`, schema version `1`.
- **No console errors** at any point, in any state.
- Every phase ends with browser verification and a git commit.

## File Structure

- `void-runner.html` — the game. Sections in fixed order, each opened by a banner comment:
  `// ===== CONFIG =====`, `SAVE`, `AUDIO`, `ENTITIES`, `SYSTEMS`, `RENDER`, `SCREENS`, `LOOP`.
- `docs/superpowers/specs/2026-08-03-void-runner-2.0-design.md` — the approved spec.
- `docs/superpowers/plans/2026-08-03-void-runner-2.0.md` — this plan.

No other files. A second file would break the single-file constraint.

## Verification Method

There is no test framework — a single HTML file with no build step cannot host one without
violating the single-file constraint. Verification is therefore manual, driven through Chrome
via the browser tools, and evidence-based: every phase check states the exact observation
that must be made. A phase is not complete until its checks are observed, not assumed.

Two debug affordances are added in Phase 1 and **removed in Phase 8**:
- `window.__vr` — exposes live game state for assertions via the JS console.
- Key `]` — advances the level immediately (needed to reach bosses without a 2-minute wait).

---

### Task 1: Restructure, Config, and Persistence

**Files:** Modify `void-runner.html`

**Interfaces produced:**
- `CFG` — frozen config object: `CFG.ships[]`, `CFG.weapons[]`, `CFG.caps`, `CFG.creditsPerScore`.
- `Save.data` — live save object `{version, hiScore, bestLevel, totalRuns, totalKills, credits, unlocked, selectedShip, muted}`.
- `Save.load()` → populates `Save.data`; `Save.write()` → persists; `Save.ok` → boolean, false when storage is unavailable.
- `window.__vr` — `{state, player, enemies, bullets, particles, level, score, Save, CFG}`.

- [ ] **Step 1:** Insert section banner comments and move existing code under them, changing no behavior.
- [ ] **Step 2:** Add `CFG` with the four ship definitions (Vanguard/Needle/Bulwark/Phantom: cost, lives, speed, fireRate, hitbox, spread), the five weapon levels, and the entity caps from Global Constraints.
- [ ] **Step 3:** Add the `Save` module. `load()` wraps `JSON.parse(localStorage.getItem('voidrunner.save'))` in `try/catch`; on throw, missing key, or `version !== 1`, it assigns defaults and sets `Save.ok = false` only for the throw case. `write()` wraps `setItem` in `try/catch` and silently no-ops on failure.
- [ ] **Step 4:** Call `Save.load()` at startup. Seed `hiScore` from `Save.data.hiScore`. On game over, update `hiScore`/`bestLevel`/`totalRuns`, then `Save.write()`.
- [ ] **Step 5:** Render a stat block on the start screen: BEST, BEST LV, RUNS, KILLS, CREDITS.
- [ ] **Step 6:** Add `window.__vr` and the `]` level-skip key.
- [ ] **Step 7:** Apply the entity caps in `update()` — after each spawn, splice the front of any array exceeding its cap.
- [ ] **Step 8: Verify in Chrome.** Load the file. Console must show zero errors. Play until death; note the score. Reload. The start screen must show that score under BEST and RUNS incremented by 1. In console, `__vr.Save.data` must return the saved object.
- [ ] **Step 9: Commit** — `feat: restructure into modules, add config and persistent save`

---

### Task 2: Audio

**Files:** Modify `void-runner.html`

**Interfaces consumed:** `Save.data.muted`, `CFG`.
**Interfaces produced:**
- `Sound.play(name)` where name ∈ `laser | hit | explode | bigExplode | powerup | weaponUp | shieldBreak | death | warning | levelUp | uiMove | uiBuy`
- `Sound.unlock()` — creates the `AudioContext` on first gesture.
- `Sound.setMuted(bool)`, `Sound.muted`
- `Music.start()`, `Music.stop()`, `Music.setIntensity(level)`, `Music.setBoss(bool)`

- [ ] **Step 1:** Add the `Sound` module: lazily construct `AudioContext` inside `unlock()`, wrapped in `try/catch`; on failure set an internal `dead` flag so every `play()` becomes a no-op.
- [ ] **Step 2:** Implement a shared noise buffer (one second of white noise, generated once) and two helpers: `tone(freq, dur, type, gain, freqEnd)` and `noise(dur, filterFreq, gain, filterEnd)`.
- [ ] **Step 3:** Define the twelve SFX from the spec in terms of those helpers. Enforce a voice cap of 12 concurrent sources; drop new requests beyond it.
- [ ] **Step 4:** Add the `Music` module — a scheduled bass note + arpeggio pattern on a 16-step sequencer driven off `AudioContext.currentTime` lookahead, plus a kick on steps 0 and 8. `setIntensity` raises tempo and enables the arp layer from level 3 and a hi-hat from level 6. `setBoss(true)` switches to a minor variant with a faster pulse.
- [ ] **Step 5:** Call `Sound.unlock()` on the first keydown or touchstart. Start music on game launch, stop on game over.
- [ ] **Step 6:** Wire every SFX to its trigger: laser on fire, hit on enemy damage, explode on enemy death, bigExplode on player death and boss death, powerup on pickup, shieldBreak, death, levelUp on level banner.
- [ ] **Step 7:** Add mute: `M` key, plus a tappable speaker icon at top-right of the start screen and bottom-right during play. State reads from and writes to `Save.data.muted`.
- [ ] **Step 8: Verify in Chrome.** Load, press space, confirm audibly that firing produces laser sound and kills produce explosions, and console is error-free. Press `M`; confirm silence and that the icon changes. Reload; confirm still muted. Unmute. In console, force `Sound.dead = true` and confirm gameplay continues without errors.
- [ ] **Step 9: Commit** — `feat: add synthesized sound effects and procedural music`

---

### Task 3: Visual Juice

**Files:** Modify `void-runner.html`

**Interfaces consumed:** `Sound.play`.
**Interfaces produced:**
- `FX.hitStop(frames)`, `FX.shake(amount)`, `FX.flash(color, frames)`
- `FX.explode(x, y, size, color)` — shockwave ring + debris + glow
- `enemy.flash` — integer frame counter, set to 3 on damage
- `FX.slowMo(frames, factor)`

- [ ] **Step 1:** Add the `FX` module holding `hitStopFrames`, `shakeAmount`, `flashColor`/`flashFrames`, `slowMoFrames`/`slowMoFactor`, and a `rings[]` array. Migrate the existing shake variables into it.
- [ ] **Step 2:** In the main loop, skip `update()` entirely while `FX.hitStopFrames > 0` (decrementing it) — rendering continues, so the screen freezes with the explosion visible.
- [ ] **Step 3:** Implement `FX.explode`: push a shockwave ring (expanding radius, fading stroke), 8–16 debris chunks (small rotating polygons with velocity and drag), and a one-frame additive radial glow. Replace all current `spawnParticles` calls at death sites with it, keeping `spawnParticles` for small impact puffs.
- [ ] **Step 4:** Add `flash` to enemy/asteroid/boss objects; decrement each frame; when > 0 draw the shape filled white over its normal render.
- [ ] **Step 5:** Add muzzle flash — a short additive glow drawn at each cannon for 3 frames after firing.
- [ ] **Step 6:** Add warp streaks — while `player.boost > 0`, stars render as vertical lines of length proportional to layer speed instead of dots.
- [ ] **Step 7:** Add the combo meter to the HUD: a horizontal bar that drains with `comboTimer`, colored by tier, showing `×N` at the current multiplier.
- [ ] **Step 8:** Add the death sequence — on losing the last life, `FX.slowMo(90, 0.25)` plus a desaturating overlay, then transition to the game-over screen.
- [ ] **Step 9:** Trigger `FX.hitStop(3)` on elite kills.
- [ ] **Step 10: Verify in Chrome.** Play a run. Confirm by observation: enemies flash white when shot but not killed; kills produce a visible expanding ring plus debris; the screen visibly hitches on an elite kill; boosting turns stars into streaks; the combo bar appears and drains; death slows down before the game-over screen. Console error-free. Screenshot the explosion mid-frame as evidence.
- [ ] **Step 11: Commit** — `feat: add hit-stop, shockwave explosions, hit flash, and combo meter`

---

### Task 4: Weapon Progression

**Files:** Modify `void-runner.html`

**Interfaces consumed:** `CFG.weapons`, `Sound.play`, `FX`.
**Interfaces produced:** `player.weaponLevel` (1–5), `fireWeapon()`, pickup type `'weapon'`.

- [ ] **Step 1:** Define `CFG.weapons` as five entries, each `{fireRate, shots: [{dx, angle}], pierce}` — L1 twin/14f, L2 twin/10f, L3 triple/10f ±0.08rad, L4 quad/9f ±0.06/±0.16rad, L5 five-way/8f ±0.05/±0.14rad with `pierce: 1`.
- [ ] **Step 2:** Replace the hardcoded shooting block with `fireWeapon()`, which reads `CFG.weapons[player.weaponLevel - 1]` and emits bullets with `vx`/`vy` derived from each shot's angle. Bullets gain a `pierce` field; on hitting an enemy, a bullet with `pierce > 0` decrements it and survives instead of being removed.
- [ ] **Step 3:** Set `player.weaponLevel = 1` in `startGame()` (Bulwark's wider spread applies as a per-ship angle multiplier, not a level change).
- [ ] **Step 4:** Add the `'weapon'` pickup — a yellow **W** orb. Rebalance the drop table to 40% weapon / 30% shield / 30% boost. On collect: `weaponLevel = min(5, weaponLevel + 1)`, `Sound.play('weaponUp')`, flash text `WEAPON ${n}`.
- [ ] **Step 5:** In `hitPlayer()`, after the shield/invincible check fails, `weaponLevel = max(1, weaponLevel - 1)` and flash text `-WEAPON` in red.
- [ ] **Step 6:** Reduce boost to a speed and fire-rate buff only (it no longer adds a third bullet — the weapon level owns shot count).
- [ ] **Step 7:** Show the weapon level on the HUD as five small pips.
- [ ] **Step 8: Verify in Chrome.** Play. Confirm collecting W pips raise the level and visibly widen the spread; confirm level 5 rounds pass through an enemy and hit a second; confirm taking a hit drops one pip and shows `-WEAPON`; confirm the level never drops below 1 or rises above 5. Console error-free.
- [ ] **Step 9: Commit** — `feat: add 5-level weapon progression with loss-on-hit`

---

### Task 5: Enemy Roster and Formations

**Files:** Modify `void-runner.html`

**Interfaces consumed:** `difficulty()`, `FX`, `Sound`.
**Interfaces produced:** `makeEnemy(kind)` where kind ∈ `grunt | elite | kamikaze | turret | mine`; `spawnFormation(type)`; `enemy.kind`.

- [ ] **Step 1:** Refactor `makeEnemy()` to take a `kind` and return kind-specific stats; refactor `drawEnemy()` to switch on `e.kind`. Existing basic/elite become `grunt`/`elite` with unchanged appearance and behavior.
- [ ] **Step 2:** Add **kamikaze** — 1 HP, `vy = enemySpeed * 2.6`, locks `targetX` at spawn and steers toward it at 1.5px/frame, no weapon. Renders as a red swept-wing dart with a trailing flame. On contact or on death, `FX.explode` at small size.
- [ ] **Step 3:** Add **turret** — 8 HP, descends to `y = 140` then holds `holdTimer = 480`, firing a 3-round aimed burst every 90 frames; retreats upward when the timer expires. Renders as a grey hexagonal platform with a rotating barrel aimed at the player. Worth 300 points.
- [ ] **Step 4:** Add **mine** — 2 HP, `vy = 0.6`, no tracking. When the player is within 45px or HP hits 0, enter `arming` for 30 frames with a pulsing expanding ring, then detonate: damage the player if within 60px, `FX.explode` large, `FX.shake(12)`.
- [ ] **Step 5:** Build a spawn table keyed on level — grunt only at L1–2; +kamikaze from L3; +elite from L3 (existing); +mine from L4; +turret from L6 — with weights shifting toward harder kinds as level rises.
- [ ] **Step 6:** Add `spawnFormation(type)`: `'vee'` = 5 grunts in a V with a shared descent, `'line'` = 4 grunts in a row sweeping horizontally in lockstep. Tag each with `formationId`. Fire every third spawn cycle from level 3.
- [ ] **Step 7:** When the last member of a `formationId` dies, award +500, flash text `FORMATION!`, and `FX.hitStop(3)`.
- [ ] **Step 8: Verify in Chrome.** Use `]` to step through levels 1→8. Confirm by observation that each of the five kinds appears at its stated level and behaves as specified — kamikaze dives, turret parks and bursts then leaves, mine arms and detonates in a radius. Confirm a formation arrives intact and clearing it awards the bonus. Console error-free. Screenshot a formation.
- [ ] **Step 9: Commit** — `feat: add kamikaze, turret, and mine enemies plus formation waves`

---

### Task 6: Bosses

**Files:** Modify `void-runner.html`

**Interfaces consumed:** `FX`, `Sound`, `Music.setBoss`.
**Interfaces produced:** `boss` (nullable global), `spawnBoss(level)`, `updateBoss()`, `drawBoss()`, `drawBossBar()`; `state` sub-flag `bossActive`.

- [ ] **Step 1:** On entering a level divisible by 5, call `spawnBoss(level)` instead of showing the normal banner: set `bossActive = true`, suppress `makeEnemy` spawning, play `warning`, `Music.setBoss(true)`, and show a 90-frame WARNING banner with a pulsing red screen-edge vignette.
- [ ] **Step 2:** Create the boss object — `hp = maxHp = 600 + 400 * (level / 5)`, enters from the top to `y = 150`, then tracks the player horizontally at 1.2px/frame. Render as a large dark angular capital ship with glowing cores, three of which flash when damaged.
- [ ] **Step 3:** Implement phase 1 (HP > 66%) — a 12-way radial bullet ring every 120 frames.
- [ ] **Step 4:** Implement phase 2 (66% ≥ HP > 33%) — a 45-frame telegraphed charge (a thin bright targeting line), then a 90-frame sustained vertical beam that sweeps horizontally; contact with the beam damages the player at most once per 30 frames.
- [ ] **Step 5:** Implement phase 3 (HP ≤ 33%) — spawn a grunt every 90 frames while firing aimed 3-round spreads every 70 frames. Play a short sting and flash the boss on each phase transition.
- [ ] **Step 6:** Draw the HP bar across the top: segmented, colored by phase, with the boss name (`DREADNOUGHT MK.${level / 5}`).
- [ ] **Step 7:** On defeat — `FX.hitStop(8)`, `FX.slowMo(60, 0.3)`, a cascade of eight staggered `FX.explode` calls across the hull, `bigExplode` sound, award `2000 × (level / 5)`, guarantee a weapon pickup drop, clear `bossActive`, `Music.setBoss(false)`, resume normal spawning, and show the level banner.
- [ ] **Step 8:** Ensure death during a boss fight cleans up correctly — clear the boss, stop boss music, reset `bossActive`.
- [ ] **Step 9: Verify in Chrome.** Press `]` four times to reach level 5. Confirm the warning banner, klaxon, and music change. Confirm the HP bar depletes and all three phases occur in order (use `__vr` to read boss HP, and temporarily set `__vr.boss.hp` low to force transitions). Confirm the beam damages the player. Confirm the defeat sequence and that normal enemies resume afterward. Die during a boss fight and confirm a clean restart. Console error-free. Screenshot each phase.
- [ ] **Step 10: Commit** — `feat: add three-phase boss fights every 5 levels`

---

### Task 7: Ship Select and Credits

**Files:** Modify `void-runner.html`

**Interfaces consumed:** `CFG.ships`, `Save`, `Sound`.
**Interfaces produced:** `applyShip(id)`, start-screen selector state `selIndex`, hit-tested UI rects.

- [ ] **Step 1:** Define the four ships in `CFG.ships` with the exact stats from the spec table, plus per-ship hull colors and a `spreadMul` for Bulwark and `phase` for Phantom.
- [ ] **Step 2:** Implement `applyShip(id)` — called by `startGame()` to set `player.speed`, `lives`, fire-rate multiplier, hitbox size, and spread multiplier from the ship definition.
- [ ] **Step 3:** Implement Phantom's ability: one free hit per level, consumed in `hitPlayer()` before lives are decremented, with a distinct visual and a `phaseUsed` flag reset on level up.
- [ ] **Step 4:** Rebuild the start screen — animated preview of the selected ship, left/right chevrons, the ship's name and stat lines, and either LAUNCH (owned) or `BUY — ${cost} CR` (locked, dimmed when unaffordable).
- [ ] **Step 5:** Wire input — left/right arrows cycle, `B` buys, space launches (owned ships only). For touch, hit-test tap coordinates against the chevron, buy-button, and launch rects.
- [ ] **Step 6:** Implement buying — deduct credits, push the id to `Save.data.unlocked`, `Save.write()`, `Sound.play('uiBuy')`, and re-render the panel as owned.
- [ ] **Step 7:** On game over, compute `floor(score / CFG.creditsPerScore)`, add to `Save.data.credits`, `Save.write()`, and animate the number counting up on the game-over screen.
- [ ] **Step 8:** Increment `totalKills` on every enemy death and persist it with the run.
- [ ] **Step 9: Verify in Chrome.** Cycle all four ships with arrows and confirm the preview, stats, and lock state update. Confirm a locked ship cannot launch and that BUY is dimmed and inert without credits. Set `__vr.Save.data.credits = 5000; __vr.Save.write()`, reload, buy Needle, confirm it launches and visibly fires faster with fewer lives. Reload and confirm the purchase persisted. Verify a run banks credits and the counter animates. Console error-free. Screenshot the start screen.
- [ ] **Step 10: Commit** — `feat: add ship select, credits, and unlockable ships`

---

### Task 8: Balance Pass, Debug Removal, and Final Verification

**Files:** Modify `void-runner.html`

- [ ] **Step 1:** Play three full runs. Tune spawn weights, boss HP, and credit rate so that level 5 is reachable in a competent first run and the first ship unlock takes roughly two to three runs.
- [ ] **Step 2:** Remove the `]` level-skip key. Keep `window.__vr` only if it is inert — otherwise remove it too.
- [ ] **Step 3:** Confirm the entity caps hold under load: during a boss phase-3 fight, read `__vr` array lengths and confirm none exceeds its cap.
- [ ] **Step 4:** Test touch input via a resized narrow window — confirm ship select, buy, launch, and mute are all tappable.
- [ ] **Step 5:** Resize the window through several aspect ratios and confirm the canvas scales without distortion or clipping.
- [ ] **Step 6:** Simulate storage failure — in console, override `localStorage.setItem` to throw, reload, and confirm the game runs with defaults and no console errors.
- [ ] **Step 7:** Final full-run playthrough to level 10 with zero console errors, capturing screenshots of the start screen, mid-game, a boss, and game over.
- [ ] **Step 8: Commit** — `chore: balance pass, remove debug affordances`

---

## Self-Review

**Spec coverage:** Weapon progression → Task 4. Enemy roster → Task 5. Formations → Task 5.
Bosses → Task 6. Audio → Task 2. Visual feedback → Task 3. Persisted data → Task 1. Credits
→ Task 7. Ships → Task 7. Start screen → Tasks 1 and 7. Error handling → Task 1 (storage),
Task 2 (audio), Task 1 (caps). Testing → every task's verify step plus Task 8. No spec
section is unaddressed.

**Placeholders:** None. Every step names the file, the values, and the observation that
proves it works.

**Type consistency:** `FX.explode(x, y, size, color)`, `Sound.play(name)`,
`Save.data`/`Save.write()`, `makeEnemy(kind)`, `player.weaponLevel`, and `CFG.ships`/
`CFG.weapons` are used with identical names and shapes in every task that references them.
