# VOID RUNNER 2.0 — Design

Date: 2026-08-03
Status: Approved

## Context

VOID RUNNER is a vertical-scrolling arcade space shooter in a single self-contained HTML
file (~720 lines, canvas 2D). v1 has: a player ship with auto-fire and left/right movement,
two enemy types (basic V-shape, elite diamond), splitting asteroids, shield and boost
powerups, particles, screen shake, combo scoring, and a level that increments every 28
seconds. There is no sound and no persistence — the high score resets on refresh.

Three problems drive this rework:

1. **Sameness.** After level 3 nothing new appears. Difficulty scales but content does not.
2. **No juice.** The game reads as flat: no audio, thin impact feedback.
3. **No retention.** Nothing survives a page refresh, so there is no reason to return.

## Goals

- Introduce enough content variety that a run stays interesting to level 15+.
- Make every impact feel physical through audio and visual feedback.
- Give the player a persistent reason to start another run.

## Non-goals

- Multiplayer, leaderboards, or any server component.
- External asset files. The game must remain one double-clickable HTML file.
- A control or difficulty overhaul. Current controls are fine.
- A framework or build step.

## Constraints

- **Single file.** All code, audio synthesis, and styling inline. No network requests.
- **Canvas 2D only.** No WebGL.
- **Works on keyboard and touch.** Every new UI element must be tappable.
- **60fps on a laptop.** Object counts and particle budgets must stay bounded.

## Architecture

The file stays single, but is reorganized into clearly delimited sections in this order:

1. **Config** — tunable constants (ship stats, costs, spawn tables, audio settings)
2. **Persistence** — `Save` module wrapping `localStorage`
3. **Audio** — `Sound` module (Web Audio synthesis) and `Music` module
4. **Entities** — factories for player, enemies, bosses, bullets, pickups, particles
5. **Systems** — spawn director, collision, effects (shake/hit-stop/flash)
6. **Rendering** — background, entities, HUD, screens
7. **Screens** — start/ship-select, play, boss intro, game over
8. **Loop** — fixed-step update, render, state machine

Each module exposes a small named interface and holds its own state. Rendering never
mutates game state; update never draws.

### State machine

```
start  ──launch──►  play  ──lives=0──►  dead  ──retry──►  start
  ▲                  │                                      │
  └──────────────────┴──────── select ship / buy ───────────┘
```

`play` has a sub-state `boss` that suppresses normal spawning until the boss dies.

## Feature 1 — Variety

### Weapon progression

Replaces the boost pickup's role as the primary offensive upgrade.

- Weapon level 1–5, starts each run at 1.
- Yellow **W** pickups increase the level by 1 (capped at 5).
- **Taking a hit drops the weapon level by 1** (floor of 1). This is the core tension: the
  build is the thing you protect.

| Lvl | Pattern |
|-----|---------|
| 1 | Twin forward shot (v1 behavior) |
| 2 | Twin + faster fire rate |
| 3 | Triple, slight spread |
| 4 | Quad, wider spread |
| 5 | Five-way spread, rounds pierce one enemy |

Boost becomes a short-lived speed + fire-rate buff only. Shield is unchanged.

### Enemy roster

Existing: **Grunt** (V-shape, zigzag, aimed single shot) and **Elite** (diamond, spread shot).
Adding three:

- **Kamikaze** — 1 HP, high speed, no weapon. Locks onto the player's x position on spawn
  and accelerates downward. Explodes on contact or when leaving the screen.
- **Turret** — 8 HP, descends to y ≈ 140 and holds position for ~8 seconds, firing 3-round
  aimed bursts, then retreats upward. High score value.
- **Mine** — 2 HP, drifts slowly downward with no tracking. Detonates in a 60px radius when
  the player comes within 45px, or when shot. Telegraphs with a pulsing ring for 30 frames
  before exploding.

### Formation waves

Every third spawn cycle (and only from level 3), the director emits a formation instead of a
single enemy: five Grunts in a V, or a line of four that sweeps horizontally in lockstep.
Killing an entire formation awards a bonus and a flash text.

### Bosses

Spawn on entering levels 5, 10, 15, and every 5 thereafter. On boss spawn: a warning klaxon,
a red screen-edge pulse, and a 90-frame "WARNING" banner. Normal spawning pauses; existing
enemies remain.

- HP bar pinned across the top of the screen.
- HP scales with level: `600 + 400 × (level / 5)`.
- Three phases, switching at 66% and 33% HP, each with a distinct pattern:
  1. **Radial burst** — 12-way bullet ring every 2 seconds while tracking the player slowly.
  2. **Sweeping laser** — telegraphed 45-frame charge, then a sustained vertical beam that
     sweeps across the screen.
  3. **Minion swarm** — spawns Grunts continuously while firing aimed spreads.
- Defeat: hit-stop, slow-motion beat, large explosion cascade, big score award, and a
  guaranteed weapon pickup.

## Feature 2 — Juice

### Audio

Web Audio API, synthesized at runtime. No files.

- **SFX** — player laser (short square-wave chirp with pitch drop), enemy hit (filtered
  noise click), explosion (noise burst through a lowpass sweep), powerup (rising triad),
  shield break (metallic ring), weapon-up (ascending arpeggio), player death (descending
  saw), boss warning (two-tone klaxon), level up (major chord sting).
- **Music** — a procedural bass + arpeggio loop with a simple drum pulse. Tempo and layer
  count increase with level; boss fights switch to a tense variant.
- Voice limiting: a hard cap on simultaneous SFX voices so a busy screen does not clip.
- Muted by `M` or a tappable speaker icon. Mute state persists.
- Audio context is created on first user input (browsers block autoplay before a gesture).

### Visual feedback

- **Hit flash** — enemies render white for 3 frames when damaged.
- **Hit-stop** — the update loop freezes for 3 frames on elite/boss/formation kills. The
  single highest-value change for perceived impact.
- **Explosions** — expanding shockwave ring + debris chunks with rotation + additive glow
  flash, replacing the current flat particle puff.
- **Muzzle flash** — a brief glow at each cannon on fire.
- **Warp streaks** — stars render as elongated streaks while boost is active.
- **Combo meter** — a HUD bar that drains, with the multiplier shown at its current tier.
- **Death sequence** — screen desaturates, brief slow-motion, then the game-over screen.

Particle budget is capped (hard limit on array length, oldest evicted) to protect frame rate.

## Feature 3 — Progression

### Persisted data

Single `localStorage` key `voidrunner.save`, holding JSON:

```
{ version, hiScore, bestLevel, totalRuns, totalKills, credits, unlocked[], selectedShip, muted }
```

All reads and writes wrap in `try/catch`. On any failure the game falls back to an
in-memory store and continues — a browser blocking storage degrades progress, never
playability. A `version` field allows future migration; an unrecognized version resets to
defaults rather than crashing.

### Credits

Banked at the end of every run, win or lose: `floor(score / 100)`. Shown counting up on the
game-over screen so the reward is visible.

### Ships

| Ship | Cost | Lives | Speed | Notes |
|------|------|-------|-------|-------|
| **Vanguard** | free | 3 | 5.5 | The v1 ship. Balanced. |
| **Needle** | 500 | 2 | 7.5 | ~40% faster fire rate. Fragile. |
| **Bulwark** | 1,500 | 4 | 4.0 | Starts each run with a shield; wider shot spread. |
| **Phantom** | 4,000 | 3 | 6.0 | Smaller hitbox; phases through one hit per level. |

Ship choice affects starting lives, movement speed, fire rate, hitbox size, and shot
pattern — no other systems.

### Start screen

Replaces the current static title screen:

- Title and animated ship preview of the currently selected ship.
- Ship selector: left/right arrows or tap arrows to cycle. Locked ships show their cost and
  a **BUY** action, enabled only when credits suffice.
- Stat block: best score, best level, total runs, total kills, credit balance.
- Launch prompt, mute icon.

## Error handling

- **Storage unavailable** — caught, in-memory fallback, no user-facing error.
- **Corrupt save** — JSON parse failure or version mismatch resets to defaults.
- **Audio unavailable** — if `AudioContext` construction throws, all sound calls become
  no-ops; the game runs silent.
- **Unbounded growth** — hard caps on particles, bullets, and enemies; oldest entries evicted.

## Testing

No test framework — this is a single HTML file with no build step. Verification is manual
and evidence-based, driven through Chrome:

1. Load the file; confirm zero console errors.
2. Start screen: cycle every ship, buy one with sufficient credits, confirm a locked ship
   cannot be bought without credits.
3. Play a run: confirm weapon level rises on pickup and falls on hit; confirm each of the
   five enemy types spawns and behaves as specified.
4. Force a boss (temporary debug key to jump levels): confirm all three phases, HP bar, and
   the defeat sequence.
5. Die deliberately: confirm credits bank, stats increment, and the values survive a reload.
6. Confirm mute persists across a reload.
7. Resize the window and confirm the canvas scales without distortion.

Screenshots captured at each stage as evidence.

## Risks

- **Scope.** This roughly triples the file. Mitigated by building and verifying in phases,
  committing each, so a broken phase never buries working ones.
- **Frame rate.** Bosses plus formations plus particles is the worst case. Mitigated by hard
  caps and by testing the boss fight specifically.
- **`file://` storage.** Chrome usually permits `localStorage` on `file://` but is not
  guaranteed to. Documented for the user; publishing to a URL is the reliable path if saved
  progress matters.
