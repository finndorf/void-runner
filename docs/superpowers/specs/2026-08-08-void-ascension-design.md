# VOID RUNNER — VOID ASCENSION

Design spec, 2026-08-08. Supersedes the phase 2–4 outline in the roguelike-core spec.

This is the expansion that turns Void Runner from an eight-level roguelike into a
2,500-level ascension game with prestige, eleven rarity tiers, seventeen hand-built
bosses, and an economy that stays coherent from a 20 HP grunt to a 10,000,000 HP
mothership.

Everything here was inferred from a single request. Where the request left a
question open, this document answers it and says so. Nothing was left for the
player to decide later.

---

## 0. The design constraint that matters most

> *"Me and my dad both really enjoy this, and i wanna be able to talk about a
> common interest between us."*

That is the actual specification. Everything below serves it, which means two
things concretely:

- **Two people of different skill levels must both have a good time.** The
  difficulty curve is long and smooth rather than spiky, and death is never
  sudden or unexplained. Every boss telegraphs.
- **The game must be worth talking about.** Bosses have names. Runs have
  stories. "I got a DYNACLOCKED on the Threshold" is a sentence someone wants to
  say out loud. That is why the rarity ladder is loud and the bosses are not
  recolours.

> *"We used to not be able to get to the second boss and now we can't."*

Read as: it used to be hard, it stopped being hard, make it hard again. The whole
numbers section below is that sentence turned into arithmetic.

---

## 1. The HP system

Everything runs on hit points now. No more `hp--`.

| | value |
| --- | --- |
| Player base shot | **10 damage** |
| Basic grunt, level 1 | **20 HP** (two shots) |
| Base DPS | 6 shots/sec × 2 bullets × 10 = **120** |

### Enemy health

```
enemyHp(kind, level) = round(ENEMY[kind].hp * level^0.92)
```

Per-kind base HP, which is the `hp` field multiplied by the curve:

| kind | base HP | ×grunt | role |
| --- | --- | --- | --- |
| grunt | 20 | 1.0 | the baseline |
| kamikaze | 14 | 0.7 | dies fast, hits hard |
| elite | 60 | 3.0 | the bread-and-butter threat from level 30 on |
| turret | 90 | 4.5 | stationary, high value |
| mine | 24 | 1.2 | armed obstacle |
| **lancer**\* | 45 | 2.25 | fires only forward — see §6 |
| **weaver**\* | 35 | 1.75 | strafes, hard to lead |
| **bulwark drone**\* | 160 | 8.0 | shielded front arc |
| **swarmling**\* | 8 | 0.4 | arrives in tens |
| **harbinger**\* | 400 | 20.0 | mini-boss, level 200+ |

\* new this update.

**On "at level 100 they should take like 50 hits or so":** at level 100 a grunt is
1,384 HP and an elite is 4,152 HP. Against a realistic level-100 build (~55 damage
per bullet) that is **25 hits for a grunt and 45–55 for an elite**. By level 100
elites are the common sight, not grunts — so the enemy you spend most of your time
shooting takes about fifty hits, which is the ask. Grunts stay lighter on purpose;
if the trash took fifty hits too, the screen would stop clearing and the game would
turn into a slog rather than a fight.

### Boss health

Each boss gets an explicit hand-set number rather than a formula, because each boss
is a hand-built fight. The numbers were fitted so that a *reasonable* build at that
level kills the boss in the target time:

| level | boss | HP | target fight |
| --- | --- | --- | --- |
| 10 | SCRAPJAW | 6,600 | 25s |
| 20 | HALO WARDEN | 14,000 | 28s |
| 30 | THE CHOIR | 21,000 | 30s |
| 40 | MAGNETAR | 30,000 | 31s |
| 50 | VOIDGATE PRIME | 38,000 | 33s |
| 75 | RUSTFALL | 62,000 | 37s |
| 100 | THE LONG SILENCE | 88,000 | 40s |
| 150 | HIVE EMPRESS | 148,000 | 46s |
| 200 | THE CARTOGRAPHER | 217,000 | 52s |
| 250 | NULLPOINT | 295,000 | 58s |
| 300 | SEVEN ANGLES | 381,000 | 63s |
| 350 | THE WIDOW | 474,000 | 69s |
| 400 | ASHEN CHOIRMASTER | 576,000 | 74s |
| 500 | THE THRESHOLD | 800,000 | 84s |
| 750 | PALE HERALD | 1,500,000 | 106s |
| 1000 | IRON LITANY | 2,300,000 | 128s |
| **2500** | **THE DREADED SCOURGE OF HUMANITY — WARR MOTHERSHIP** | **10,000,000** | **240s** |

The 10,000,000 figure was the anchor. Everything else was fitted backwards from it
so that the curve arrives there naturally: total player power growth from a bare
level-1 ship to a best-in-game level-2500 build is **349×**, and 10,000,000 ÷ that
final DPS is 4.0 minutes exactly as requested.

**Boss levels:** 10, 20, 30, 40, 50, 75, 100, 150, 200, 250, 300, 350, 400, 500,
750, 1000, then **every 100 levels from 1100 onward**, with 2500 being the
Mothership.

*Inference stated plainly:* the request listed bosses up to 1000, then "2500, that
repeats every 100 levels". Leaving levels 1100–2400 bossless would be 1,400 levels
of nothing, so bosses continue every 100 through that stretch. Those are **WARR
ARMADA escorts** — each one composites the mechanics of two earlier bosses into a
fight neither of them was. That is a real fight, not a recolour, but it is honestly
a combinatorial system rather than fourteen more bespoke bosses. The seventeen named
bosses above are fully hand-built and share no code paths.

After 2500 the Mothership returns every 100 levels as **SCOURGE ASCENDANT ×N**,
HP × 1.6ⁿ, gaining one additional phase each return.

### The speed curves saturate

Found while building the bosses, and the single most consequential bug in the
project. `difficulty()` was linear and unbounded — `enemySpeed = 1.2 + 0.2·lv`,
`bulletSpeed = 2.5 + 0.15·lv`. Fine for eight levels. At level 2500 that is an
enemy bullet crossing the entire 720px screen in **1.9 frames**, and enemies
moving at 501 px/frame. Everything past roughly level 150 was not hard, it was
mathematically undodgeable.

Both curves are now unchanged up to a knee (level 24 and level 50 respectively)
so the opening game plays exactly as tuned, then creep gently and saturate.
Enemy bullets stay slower than the player's own 11 px/frame at every depth, and
nothing ever crosses the screen in under a second. Asserted by test.

### The old `bossHpMultiplier` is deleted

Scaling boss HP by scrap *spent* was the single worst number in the previous
version — it meant buying upgrades could make your run harder, which is a
punishment for playing the game. Boss HP is now fixed per level. Getting stronger
now only ever helps.

---

## 2. Eleven rarity tiers

| # | tier | colour | stacks | base weight | obtained |
| --- | --- | --- | --- | --- | --- |
| 1 | COMMON | `#b8c4d0` | 5 | 51.5 | start |
| 2 | UNCOMMON | `#44dd77` | 5 | 27 | start |
| 3 | RARE | `#3399ff` | 3 | 13 | start |
| 4 | EPIC | `#aa66ff` | 2 | 6 | start |
| 5 | LEGENDARY | `#ffaa22` | 1 | 1.7 | start |
| 6 | **MYTHIC** | `#ff3388` | 1 | 0.49 | start |
| 7 | APEX | `#00ffee` ↔ `#ffdd33` | 1 | 0.30 | start |
| 8 | **OVERCLOCKED** | white core, prismatic edge | 1 | 0.01 | start |
| 9 | **HYPERCLOCKED** | `#ff00cc` ↔ `#00ffcc` | 1 | — | voidbirth 1 |
| 10 | **UBERCLOCKED** | molten gold, animated | 1 | — | voidbirth 2 |
| 11 | **DYNACLOCKED** | inverts the screen for a frame | 1 | — | voidbirth 3 |

Weights sum to exactly 100.00. MYTHIC sits between LEGENDARY and APEX as specified.
OVERCLOCKED is 0.01% — **one in ten thousand slots**, roughly one every 1,100 runs
at base odds. It is meant to be a story, not a plan.

### Prices

| tier | price |
| --- | --- |
| COMMON | 240 |
| UNCOMMON | 500 |
| RARE | 900 |
| EPIC | 2,100 |
| LEGENDARY | 4,500 |
| MYTHIC | 7,000 |
| APEX | 11,000 |
| OVERCLOCKED | 20,000 |
| HYPERCLOCKED | 34,000 |
| UBERCLOCKED | 55,000 |
| DYNACLOCKED | 90,000 |

---

## 3. Voidbirth

At levels **50, 100, 200, 350, and 500** the run does not continue — it ascends.

**You keep:** your score, your credits, your ships, your records.
**You lose:** every upgrade, and all unspent scrap.
**You gain:** the entire rarity ladder shifts up one rung.

### What "everything moves up" means mechanically

Each upgrade carries a **lineage**, and voidbirth advances every lineage one step:

```
RELOAD COIL (COMMON, +5% fire rate)
  → VB1 → RELOAD ARRAY      (UNCOMMON, +11%)
  → VB2 → RELOAD LATTICE    (RARE,     +24%)
  → VB3 → RELOAD CASCADE    (EPIC,     +53%)
  → VB4 → RELOAD SINGULARITY(LEGENDARY,+117%)
```

So the shop's floor tier rises with each voidbirth: after VB1 no COMMON ever
appears, after VB2 no UNCOMMON, and so on. The upgrade *identities* survive — this
is the answer to *"make sure the earlier game commons are not gone… some of the
apex are just much much better versions of them"*. RELOAD COIL is still in the game
at level 2,000; it is just called RELOAD SINGULARITY and it does twenty times as
much.

### The odds shift down one rung

Exactly as requested — the chance of a MYTHIC becomes the chance a LEGENDARY had,
and so on:

| | floor | …ceiling |
| --- | --- | --- |
| **VB0** | COMMON 51.5 · UNCOMMON 27 · RARE 13 · EPIC 6 · LEGENDARY 1.7 · MYTHIC 0.49 · APEX 0.30 · OVERCLOCKED 0.01 |
| **VB1** | UNCOMMON 51.5 · RARE 27 · EPIC 13 · LEGENDARY 6 · MYTHIC 1.7 · APEX 0.49 · OVERCLOCKED 0.30 · **HYPERCLOCKED 0.01** |
| **VB2** | RARE 51.5 · EPIC 27 · LEGENDARY 13 · MYTHIC 6 · APEX 1.7 · OVERCLOCKED 0.49 · HYPERCLOCKED 0.30 · **UBERCLOCKED 0.01** |
| **VB3** | EPIC 51.5 · LEGENDARY 27 · MYTHIC 13 · APEX 6 · OVERCLOCKED 1.7 · HYPERCLOCKED 0.49 · UBERCLOCKED 0.30 · **DYNACLOCKED 0.01** |
| **VB4** | LEGENDARY 51.5 · MYTHIC 27 · APEX 13 · OVERCLOCKED 6 · HYPERCLOCKED 1.7 · UBERCLOCKED 0.49 · DYNACLOCKED 0.31 |
| **VB5** | MYTHIC 51.5 · APEX 27 · OVERCLOCKED 13 · HYPERCLOCKED 6 · UBERCLOCKED 1.7 · DYNACLOCKED 0.80 |

One table, one rule: shift the base weight vector right by the voidbirth count and
give the top tier whatever rounding is left. HYPER/UBER/DYNACLOCKED are literally
unreachable before their voidbirth, because their weight does not exist in the
vector until then.

### The Voidbirth sequence

Not a menu. When the level-50 boss dies the screen does not go to the shop:

1. All input locks. The soundtrack drops to a single held note.
2. The player ship drifts to centre screen and the starfield reverses.
3. Each owned upgrade card flies off screen one at a time and burns — you watch the
   run you built come apart. This takes about four seconds and it is meant to hurt.
4. A white flash. `VOIDBIRTH I` in full-screen type.
5. The tier ladder redraws with the new floor and the newly unlocked top tier
   highlighted.
6. The ship re-forms with a new hull trim colour that persists for the rest of the
   run, so you can see at a glance how deep someone is.

---

## 4. The shop

Three changes, all from the request.

### No timer

The countdown is gone entirely. The shop stays open until you leave. This removes
the worst pressure in the previous version — being rushed through the one moment
that is supposed to be a breather — and it makes the shop a place to think, which
is what a roguelike shop is for.

### It docks *after* the level, with real time between visits

The cargo ship is no longer a slab that slides in. It is a proper hauler:

- It arrives from the top-right on a curve, running lights blinking, with a visible
  **thruster burn that flips for deceleration**.
- **Docking clamps extend** from its underside and connect to the player's hull with
  a short animation and a mechanical clunk.
- A **lit cargo bay** opens along its flank and the three upgrade cards rise out of
  it on platforms. The cards are physically inside the ship, not floating in space.
- The hull is 3× the size of the old one, painted, panel-lined, weathered, and it
  has a **name stencilled on the side** that changes per visit (`HAULER MERIDIAN`,
  `TUG BLACKFOOT`, …).
- On departure the clamps release, it pitches away, and burns out of frame.

### Shop frequency

| after | shop appears |
| --- | --- |
| VB0 | every level |
| VB1 | every 2nd level |
| VB2 | every 4th level |
| VB3+ | every 8th level (the cap) |

Scrap income per level is raised to compensate so total purchasing power per level
is roughly flat — you shop less often but each visit matters more.

### SKIP

A **SKIP** button, and the `S` key. Leaves immediately without buying. Distinct from
DEPART only in intent; it is there because at high levels you will often be saving
for a tier the shop cannot show you yet, and clicking through three cards you do not
want is friction.

Rerolls stay, at `300 × 2^uses`, reset each visit.

---

## 5. Upgrades

**114 upgrades**, up from 29, spread across all eleven tiers. Twenty-two of them
carry a lineage, so voidbirth renames them as they climb.

Every effect key in the catalogue is read by `resolveStats`, and every stat
`resolveStats` produces is consumed by the game. That is checked mechanically,
not by eye: a card whose effect goes nowhere is the exact bug that shipped a
2,100-scrap dead PHASE DRIVE last time.

| tier | count | stacks | character |
| --- | --- | --- | --- |
| COMMON | 14 | 5 | small numbers |
| UNCOMMON | 14 | 5 | small numbers, second-order stats |
| RARE | 14 | 3 | conditional effects |
| EPIC | 13 | 2 | new firing behaviour |
| LEGENDARY | 12 | 1 | named abilities |
| MYTHIC | 11 | 1 | rule-benders |
| APEX | 10 | 1 | run-defining |
| OVERCLOCKED | 8 | 1 | breaks a rule of the game |
| HYPERCLOCKED | 7 | 1 | breaks two |
| UBERCLOCKED | 6 | 1 | absurd |
| DYNACLOCKED | 5 | 1 | the ceiling |

That is enough that a player who has seen a hundred shops has still not seen
everything, which answers *"make many, many more upgrades in all categories so you
never stop learning about new ones"* and *"make it so late game you dont run out of
upgrades"*.

### The nerf pass

> *"Nerf everything so the skill is not taken away."*

Every stat upgrade comes down, roughly 35%:

| upgrade | was | now |
| --- | --- | --- |
| RELOAD COIL | +8% fire rate | **+5%** |
| HEAVY ROUNDS | +10% damage | **+6%** |
| THRUSTERS | +8% speed | **+5%** |
| TWIN FEED | +15% fire rate | **+10%** |
| AP ROUNDS | +18% damage | **+12%** |
| EVASION FIELD | +12% spd / −10% size | **+8% / −6%** |

The floor on fire rate rises from 4 frames to **6 frames** (10 shots/sec), so no
build ever becomes a solid beam that removes aiming from the game. Shield charges
now cap at 4. VAMPIRIC CORE goes from a life per 30 kills to a life per 60.

### HUNTER ROUNDS moves to APEX

> *"Make the autoaim one like a apex because its too cracked."*

Agreed and done. Homing removes the single most important skill in the game
(leading a moving target), so it cannot be a 900-scrap RARE. It becomes an APEX at
11,000 — and its homing strength is cut from 0.045 to **0.03 rad/frame**, so even
at APEX it assists your aim rather than replacing it.

The RARE slot it vacates goes to **TRACER ROUNDS**: your bullets draw a faint
predictive line to the nearest enemy. All of the information, none of the aiming.

### Lineages

Twenty-two lineages run the full ladder, so voidbirth always has somewhere to send
every upgrade. A representative set:

| COMMON | → LEGENDARY | → DYNACLOCKED |
| --- | --- | --- |
| RELOAD COIL | RELOAD CASCADE | **CHRONOSTALL** — time slows while you hold fire |
| HEAVY ROUNDS | SIEGE ROUNDS | **KINETIC VERDICT** — first hit each level deals 5% max HP |
| PLATING | AEGIS LATTICE | **THE UNBROKEN** — shields regenerate faster than they break |
| SCRAP MAGNET | SALVAGE ENGINE | **MIDAS FIELD** — enemies drop scrap continuously while alive |
| TIGHT BARREL | RAIL ALIGNMENT | **THE NEEDLE** — one shot, infinite pierce, screen-height |

---

## 6. Enemies

### They stop being triangles

Every enemy gets a drawn hull with panel lines, lit engines, and a silhouette
readable at a glance:

| kind | silhouette |
| --- | --- |
| grunt | stubby four-fin interceptor, twin engines |
| kamikaze | forward-swept ram prow, no guns, one huge engine |
| elite | broad gunship, side pods, armoured canopy |
| turret | hexagonal weapons platform on a gimbal ring |
| mine | spherical casing, folding petals that open when armed |
| lancer | long thin hull, single forward barrel, no side arc |
| weaver | twin-boom frame that visibly banks into its strafe |
| bulwark drone | wedge with a physical front shield plate |
| swarmling | tiny darting mote, always in tens |
| harbinger | a small mothership with its own health bar |

They also **grow**: enemy render radius scales `r × (1 + level^0.35 / 11)`, capped
at 2.4×, so a level-2000 grunt is genuinely a large ship rather than the same
sprite with more HP. The divisor is 11 rather than 22 because at 22 the cap was
unreachable — a level-2500 enemy only reached 1.70×, and 2.4× would not have
arrived until somewhere past level 17,000.

### Fixing the side attack

> *"make it so at a certain point the ships just fire forwards so they cant hit you
> from the side, or at least make a way for you to hit them when they are there"*

Both, actually:

1. **Firing arc restriction.** Every shooting enemy now has a `arc` field. From
   level 15 onward, grunts, elites, and lancers may only fire within ±40° of
   straight down. An enemy off to your side physically cannot shoot you; it has to
   commit to your column first, which is a telegraph you can read and punish.
2. **You can reach them.** The base firing pattern gains a slight outward bias at
   the edges, and `TRACER ROUNDS`, `SIDE PODS`, and the new UNCOMMON `GIMBAL MOUNT`
   (+18° aim cone toward the nearest enemy) all give real answers to side targets
   without handing over auto-aim.

### Meteorites

> *"As you progress farther, different metorites appear, that are stronger."*

Five classes, each with a distinct behaviour and not just more HP:

| class | from | HP | behaviour |
| --- | --- | --- | --- |
| ICE | 1 | 30 | shatters into three harmless shards |
| IRON | 25 | 120 | does not break up; must be destroyed or dodged |
| OBSIDIAN | 100 | 400 | splits into two live OBSIDIAN halves |
| VOIDGLASS | 400 | 1,400 | refracts your shots back at you |
| SINGULARITY SHARD | 1000 | 5,000 | drags everything on screen toward it, including you |

---

## 7. Bosses

Seventeen bosses, no shared attack code. Each has a name, a distinct silhouette,
its own phase count, and **one mechanic no other boss has**.

| lv | name | phases | the mechanic that is only here |
| --- | --- | --- | --- |
| 10 | **SCRAPJAW** | 2 | Four bolt-on armour plates absorb *all* damage. Break them off to expose a core. Teaches "find the weak point". |
| 20 | **HALO WARDEN** | 3 | A rotating shield ring with one gap. Damage only lands through the gap, so you orbit to stay in it. |
| 30 | **THE CHOIR** | 3 | Three linked heads, one shared HP pool. Each head you kill makes the survivors faster — kill order is the puzzle. |
| 40 | **MAGNETAR** | 3 | Polarity flips every 6s: pulls you in, then shoves you out. Its bullets curve with the field. |
| 50 | **VOIDGATE PRIME** | 4 | Opens portals and spawns *mirrors of your own ship* that fire your current build back at you. |
| 75 | **RUSTFALL** | 3 | Sheds permanent wreckage. The arena fills with obstacles over the fight — late phases are fought in a junkyard. |
| 100 | **THE LONG SILENCE** | 4 | Kills the lights. The screen goes to near-black and you fight by muzzle flash and audio cue alone. |
| 150 | **HIVE EMPRESS** | 4 | Regenerates unless the field is clear of her brood. A pure crowd-control check. |
| 200 | **THE CARTOGRAPHER** | 4 | Divides the arena into a lit grid and detonates cells in telegraphed patterns. Positional, not reflexive. |
| 250 | **NULLPOINT** | 4 | Jams one of your upgrades at a time, greyed out on the HUD. You fight through the hole in your own build. |
| 300 | **SEVEN ANGLES** | 5 | A rotating polygon that *gains a side each phase*; every side is an independent gun. |
| 350 | **THE WIDOW** | 4 | Tethers a chain to your ship. You take damage while it is taut — so you must fly *toward* her. Inverts every instinct. |
| 400 | **ASHEN CHOIRMASTER** | 5 | Conducts. Every attack lands on a 4-beat bar you can hear. The fight is played to the music. |
| 500 | **THE THRESHOLD** | 5 | Copies your build and fights you with it. The stronger you came, the stronger it is. |
| 750 | **PALE HERALD** | 5 | First mothership. Destructible hangar bays must be cleared before the core is reachable. |
| 1000 | **IRON LITANY** | 6 | So large the camera pans: you fly *along* its flank and the fight scrolls sideways. |
| 2500 | **THE DREADED SCOURGE OF HUMANITY — WARR MOTHERSHIP** | 7 | The Devouring: it eats sections of the arena permanently, shrinking the space you have left, phase by phase. |

The last three fill the screen. IRON LITANY is 3× canvas width; the Mothership is
drawn as a scrolling structure rather than a sprite.

---

## 8. Ships

Eleven ships, from four. Each gets its own hull draw function — the current code
draws one silhouette for every ship and only swaps colours, which is exactly the
"recolour" problem the request objects to.

| id | name | cost | hook |
| --- | --- | --- | --- |
| vanguard | VANGUARD | 0 | the baseline |
| needle | NEEDLE | 500 | fastest fire, 2 lives |
| bulwark | BULWARK | 1,200 | starts shielded |
| phantom | PHANTOM | 3,000 | tiny hitbox, phases one hit per level |
| **warden** | WARDEN | 1,800 | first hit each level strips no upgrade |
| **scavenger** | SCAVENGER | 2,500 | +25% scrap, pulls drops toward you |
| **revenant** | REVENANT | 4,500 | starts every run with one free RARE |
| **titan** | TITAN | 9,000 | 5 lives, regenerates one every 5 levels |
| **oracle** | ORACLE | 14,000 | shop always shows one tier higher on slot 1 |
| **wraith** | WRAITH | 22,000 | invisible to enemy targeting for 2s after a kill |
| **ascendant** | ASCENDANT | 50,000 | starts at voidbirth 1. Unlocked only by reaching VB3. |

---

## 9. Audio

### Soundtrack

The current music is a single detuned saw arpeggio. The replacement is a **five-voice
engine**: sub bass, bass arp, pad, lead, and a drum voice (kick / snare / hat /
crash), all synthesised inline with no assets.

Six themes, selected by depth, each with its own scale, tempo, and drum pattern:

| depth | theme | character |
| --- | --- | --- |
| 1–49 | **OUTER DRIFT** | 108 bpm, minor pentatonic, sparse |
| 50–199 | **THE BELT** | 124 bpm, driving, syncopated bass |
| 200–499 | **DEEP FIELD** | 132 bpm, dorian, wide pads |
| 500–999 | **THE SILENCE** | 96 bpm, almost no percussion, dread |
| 1000+ | **WARSPACE** | 148 bpm, aggressive, half-time drops |
| bosses | **per-boss stinger** | each of the 17 gets its own bass motif |

Boss music transitions on phase change rather than restarting. The Voidbirth
sequence has its own cue.

### SFX

Every sound is rebuilt with a proper envelope and at least two oscillators. New
sounds for: tier reveal (one per tier, escalating — DYNACLOCKED is unmistakable),
docking clamps, plate break, shield break, boss phase change, voidbirth, upgrade
strip, meteorite class impacts.

---

## 10. Save format

Version **2 → 3**. Migration is mandatory and non-destructive; v1 and v2 saves both
upgrade in place, as they did before.

New fields:

```
voidbirths: 0, bestLevel: 1, bestVoidbirth: 0,
tiersFound: { MYTHIC: 0, OVERCLOCKED: 0, HYPERCLOCKED: 0, UBERCLOCKED: 0, DYNACLOCKED: 0 },
bossesKilled: {}, unlocked: [...]  // ascendant appended on VB3
```

The rule from last time holds and is non-negotiable: **only write the save when the
load succeeded.** An unrecognised save is never overwritten.

---

## 11. Build order

Six phases. Each one ends with the game playable and pushed.

| # | phase | why this order |
| --- | --- | --- |
| **A** | HP system, 11 tiers, nerf pass, shop rework (no timer, SKIP, docking art), upgrade catalog to 114 — **DONE** | Everything else is denominated in these numbers. Building bosses first would mean rebuilding them. |
| **B** | Voidbirth: prestige at 50/100/200/350/500, lineages, odds shift, shop frequency decay, the three locked tiers — **DONE** | The tier ladder must exist before content can be spread across it. |
| **C** | Enemies: ten kinds with real hulls, size/HP scaling, firing arcs — **DONE** (meteorite classes still to wire) | Bosses reuse enemy rendering and the arc system. |
| **D** | Bosses: seventeen hand-built fights plus the ARMADA compositor — **DONE** | The largest phase by far. Built as a registry so each fight owns its state, attacks, hull and damage rules, with only the chrome shared. `tools/bosscheck.mjs` benches each one headlessly and fails it if it throws, skips a phase, or turns out to be unkillable. |
| **E** | Ships: seven new hulls with individual draw functions and hooks — **DONE** | Eleven ships. `SHIP_ART` registry; `tools/shipcheck.mjs` draws each hull through a colour-blind recording canvas and fails any two whose geometry matches, so a recolour cannot pass. | Independent of everything else; safe to do late. |
| **F** | Audio: five-voice engine, six themes, per-boss motifs, SFX rebuild | In progress. |

### The dead-capability audit

`tools/hookaudit.mjs` is the standing answer to this project's recurring bug —
content that takes the player's scrap or credits and does nothing. It proves,
mechanically, that every upgrade effect key is read by `resolveStats`, every
stat `resolveStats` produces is consumed by the game, every ship hook is read,
every boss in the table has a bespoke registry entry, and every ship has hull
art. Run it after adding anything.

It exists because a grep came back clean twice while dead content shipped: a
2,100-scrap PHASE DRIVE that could never fire, and later 22 upgrade effect keys
that nothing consumed.

### The rule carried forward from last time

Every serious bug in the roguelike build had one root cause: **a system was deleted
and its dependents were never re-audited.** This expansion deletes more than that
one did — `bossHpMultiplier`, the whole `hp--` damage path, the shop timer, the
single `drawShip` silhouette, the RARE homing slot.

So each phase **begins** with an explicit written audit answering: *what read the
thing we just removed?* Not a grep — a list, written down, checked off. The grep
came back clean last time and four real bugs still shipped.

---

## 12. Verification

The pure-block discipline holds and expands. Everything decidable without a canvas
lives between the `ROGUELIKE CORE (PURE)` sentinels and is tested by
`node --test tests/*.mjs`:

- the HP curves at levels 1, 10, 100, 500, 1000, 2500
- all eleven tier weight vectors at every voidbirth level, each summing to 100
- lineage advancement: every lineage resolves at every voidbirth depth, no gaps
- HYPER/UBER/DYNACLOCKED are unreachable before their voidbirth — asserted directly
- shop frequency by voidbirth count
- upgrade eligibility and stacking across all 114 entries
- boss HP table completeness and monotonicity
- save migration from v1, v2, and garbage

Target: **150+ tests**, up from 49. Anything requiring a canvas is verified by
driving the real game and capturing screenshots, boss by boss.

---

# ADDENDUM — VOID ASCENSION II (2026-08-08, second pass)

A second request arrived after the first shipped. Where it contradicts anything
above, **this addendum wins** and the section above is history.

## 0. The two numbers that changed everything

> *"make warr have 1B, and the first boss have 1k."*

Boss health is now `hp = 1000 × (level/10)^2.5`, fitted to exactly those two
fixed points. It lands on 1,000 at level 10 and 988,211,769 at level 2,500,
rounded to 1,000,000,000.

Those two numbers cannot both be true under the old economy — a bare shot did a
flat 10 damage forever, so a billion-HP boss is a five-hour fight. So the floor
of the player's damage now rides the **same exponent as enemy health**:

```
RLCore.baseDamageAt(level) = 10 × level^0.95
RLCore.enemyHp(kind, level) = base × level^0.95
```

Your build is a **multiple of the baseline**, not a footrace against it. Two bare
shots kill a grunt at level 1 and at level 2,500 — a test asserts it at both
ends. The Mothership bench is 1,891 frames, which is what it was at 10,000,000
HP, so the fight is the same length and a hundred times the number.

**Nothing is deleted in one frame.** `capDamage` caps a boss hit at 1/14th of its
max HP and an ordinary enemy hit at half. Anything at or under 16 HP — the really
weak early ones — can still pop in one shot.

## 1. The roster: ninety-five ships in ten bands

Ten bands of ten levels. Each band is a **wholly new set**, and each has one more
member than the band below it: 5, 6, 7 … 14. Past level 100 the bands cycle
through the top six; the ships repeat, their health does not.

One renderer, eight independent shape axes — nose, body, wing, gun pods, engines,
fins, cockpit, armament. `tools/genenemies.mjs` **refuses to emit two identical
hulls** and a test asserts all 95 silhouettes are distinct, because a roster of
95 "different" enemies that is really 68 shapes plus recolours is the exact thing
this expansion exists to prevent.

Six new behaviours join the nine that existed: `orbiter` (circles you),
`sniper` (paints a line, then fires down it), `splitter` (dies into two),
`shielder` (plates everything nearby), `bomber` (timed area denial), `blinker`
(teleports).

## 2. What a hit costs now

It used to strip an upgrade. That punished the thing you spent the run building,
and silently. **A hit now takes half your scrap.** GREED ENGINE deepens it to
three-quarters; ABSOLUTION zeroes it. `stripCheapest`/`stripN` were deleted —
what depended on them: `hitPlayer`, `stats.strips`, `stats.noStrip`, two card
texts, and one test section. All updated.

**Anything that gets past you costs a life.** Its partner rule is that most
enemies no longer leave: orbiters, snipers, shielders, bombers, turrets and
harbingers hold station, and drifters and weavers brake in the lower third and
turn to fight. What crosses the line has genuinely run the gauntlet.

## 3. Ascension, rewritten

Not five fixed levels any more. The first one lands the **frame the level-50
boss dies**, and after that **every boss is an ascension point**. You keep **5%**
of your scrap and **return to level 1** — the same ladder, climbed with better
cards.

## 4. SECRET

A twelfth tier that is deliberately **not on the ladder**. One in a million,
rolled before and independent of depth, never drifted into, never promoted into,
never climbing with voidbirth. Every card costs **one scrap** and does something
to the whole screen — WRONG WAY UP flips the galaxy (and the controls, or the
joke is just a broken game). LOTTERY's hull multiplies the odds sixty times and
nothing else.

## 5. Everything else

- **320 upgrades** (the brief asked for 250), all eleven tiers plus SECRET.
- **19 ships** on a linear ladder: free, then +1,500 a rung. BULWARK buffed off
  "worse at everything but dying". ASCENDANT now genuinely requires a run that
  reached Voidbirth V — it was purchasable the moment you could afford it, which
  made its own blurb a lie.
- **Ten skies and ten soundtrack themes**, one per band, so crossing level 11,
  21, 31 changes where you are, what you fight, and what it sounds like. Two new
  music voices: a sixteenth-note arp and a clap layer. OUTER DRIFT and THE
  SILENCE stay sparse on purpose.
- **Three volume buses** — music, ambience, attacks — plus rebindable keys and
  auto-skip, on a settings panel bound to ESC.
- **A bestiary**: 95 ships, 17 bosses, 320 cards. Unmet entries show their real
  silhouette but not their name. OVERCLOCKED and above stay hidden until found.
- **Meteors drop things**: eight classes, five payloads (scrap, shield, life,
  overdrive, cold snap), with a magnet stat to pull them in.
- **Boss order changed** so both damage-blocking fights — HALO WARDEN's ring and
  SCRAPJAW's plates — sit past level 100. No boss name says "void". THE CHOIR is
  now TRIAD: three hulls flying as one, because they are spaceships.

## 6. Still open

- Nullpoint's jam uptime and Hive Empress's brood clearability still need real
  human play. Benches prove they are killable, not that they are fun.
- The band-4/5 hit counts are fitted, not played. The brief said "like 50 hits
  or so" at level 50; the heaviest band-5 hull is ~65 bare shots, and a real
  build brings that to 15–20. That is a number to check with a controller in
  hand, not a spreadsheet.

---

# ADDENDUM II — "still too easy" (2026-08-08, third pass)

## 0. Why it was easy, and the actual fix

Addendum I made player damage and enemy health share one exponent (0.95). That
kept the fight length constant from level 1 to 2,500 — which is exactly the
problem. **Constant is easy**, because your build keeps growing on top of it.

The exponents are now deliberately unequal:

```
enemy health  = base × level^1.00 × pressure(level)
damage floor  =   10 × level^0.92
```

Enemy health outruns the damage floor by `level^0.08`, so the deeper you go the
more your build has to be carrying. On top of that, `pressureAt` multiplies
enemy health by a ramp that is **exactly 1.0 at or below level 7** — the brief
said "harder, but only after level 7 or so" — then climbs 2% a level to 2.5×
and creeps very slowly after that so the deep game never settles.

Bare hits to kill, lightest and heaviest hull in the band:

| level | 3 | 7 | 10 | 15 | 25 | 50 | 95 | 300 | 2500 |
|---|---|---|---|---|---|---|---|---|---|
| lightest | 2 | 2 | 2 | 6 | 16 | 76 | 506 | 591 | 1161 |
| heaviest | 7 | 7 | 8 | 20 | 46 | 203 | 1301 | 1548 | 2985 |

Levels 1–7 are untouched to the number. Level 10 onwards is where "the ships
feel too weak" gets answered.

**The wrap bug this exposed.** The roster cycles back to band 4 past level 100,
and band 4's hulls weigh a fifth of band 9's — so level 101 was *easier* than
level 100. `RLCore.deepBase` now takes only a ship's **relative weight inside
its own band** past the cliff and pins the absolute number to where band 9 left
off. A test walks every level from 8 to 3,000 and fails if difficulty ever dips.

## 1. Bosses

`hp = 6000 × (level/10)^2.377` — 6,000 at level 10, **3,000,000,000** at 2,500.
The first boss went up from 1,000 because 1,000 died in about a second to a bare
ship and a third of a second to any real build.

## 2. The charge shot

Auto-fire still runs, so the game is still playable hands-off and on a phone.
**Holding FIRE is the charge**: the ordinary gun goes quiet, a lance winds up
over 90 frames, and releasing fires it. 3× damage at the minimum useful charge,
**14× at full**, infinite pierce. Holding is a real trade — you give up DPS for
a few seconds to get a burst back — rather than a strictly better button.

## 3. Mobile

The old handler tracked one finger for everything, so you could steer *or* press
a button, never both. Touches are tracked by identifier now: a finger on the
CHARGE pad charges, any other finger steers, and sliding off the pad cancels.

## 4. Everything else

- **Breaches removed.** Enemies leaving the bottom is free again.
- **Scrap always autocollects** (range 2,000). It is income, not a skill check —
  and tying it to an upgrade meant an ascension, which burns every upgrade,
  silently broke your ability to pick your own money up. That was the
  "voidbirth collecting debuff".
- **Shields and lives are scarcer**: cap 4→3, repair kits 2→1, and kill-count
  sources cost 80% more kills.
- **Every auto-targeting card moved up one rung**; HUNTER ROUNDS is OVERCLOCKED.
- **LOTTERY** gives a general two-rung shop bump instead of secret-only odds.
  `secretOdds` and `secretAwareRandom` were deleted with it.
- **ASCENDANT** fires much faster (fireMul 0.88 → 0.62).
- **Seven hulls redrawn** — magpie, ramhead, lantern, glacier, cartwheel,
  howitzer, domino, lottery — as actual ships with a nose, a canopy, wing roots
  and engine bells. MAGPIE is no longer a Vanguard with a hoop on it.
- **TRIAD is three different ships** — LANCE, MAUL, KEEL — each drawn as itself,
  each named in the boss bar, and each leaving its own wreck in formation.

---

# ADDENDUM III — "VOIDRUNNER BEYOND" (2026-08-09, fourth pass)

## 0. A correction from the last round

Addendum II recorded the voidbirth debuff as being about scrap collection. It
was not: the ask was **"the voidbirth's debuff of not opening shops every
time"**, and it is repeated here as *"when you voidbirth you can still get the
shop every time, because it becomes way too hard."*

`shopEvery` returned 1/2/4/8/8/8 by depth. That was meant to make each visit
weigh more; in practice a voidbirth burns your entire build and then makes it
*harder* to rebuild one, which is a punishment for succeeding. **Shops now open
after every level at every depth.**

## 1. Pace

The brief: *"It takes too long to get to the next level, make each level ½ as
long"* and *"Make later levels shorter."*

`levelSecondsAt` — 12 seconds at level 1 (was 24), shortening 0.02s a level to
a floor of 7. A level is a wave you clear, not a timer you wait out.

Credits loosened as well: divisor 300 → 110, tail 900 → 320. The compression
above the knee stays, so one very good run still cannot buy the whole hangar.

## 2. Bosses

*"BOSSES NEED WAY WAY WAY MORE HEALTH"* —

```
hp = 30000 × (level/10)^2.303
```

30,000 at level 10 (was 6,000, was 1,000 before that) to **10,000,000,000** at
2,500. `LINEAGE_GROWTH` went 2.2 → 2.5 alongside it: at voidbirth V a lineage
card is now ~98× its base rather than ~52×, which is what keeps the deepest
fights closable at all.

**PLASMA REVOLUTION** is the new seventh boss, at level 100. The arena stops
being open space and becomes **five lanes**; you are locked to one and hop
between them while it burns lanes out one at a time. One lane is *always*
standable — a test asserts it on every frame of every phase, because the
mechanic is a puzzle only if that holds. Nothing else in the roster restricts
where you may stand, which is the whole reason it exists.

**TRIAD moved to level 30** and MAGNETAR opens the run.

## 3. Two new areas

Bands 10 and 11 — **THE GLASS REACH** (101–110, 15 ships) and **THE LAST
ORCHARD** (111–120, 16 ships). 126 enemies now, all 126 silhouettes distinct.
Each area brings its own sky and its own soundtrack theme.

## 4. Waypoints

Reach a checkpoint five times and you may launch from it. **Capped at level
40** — past that the run has to be earned. Each hands you a starting build,
because arriving at level 40 with nothing is a death sentence, not a shortcut:

| waypoint | 10 | 20 | 30 | 40 |
|---|---|---|---|---|
| free upgrades | 5 | 10 | 20 | 20 |

An unearned waypoint silently falls back to level 1 rather than being trusted.

## 5. Everything else

- **Seven formations** on top of vee and line: wall, column, diamond, echelon,
  pincer, arrowhead. The pool widens with depth.
- **Bullets are neon white** again. The type-coloured tints made a busy screen
  read as confetti; crits keep a warm core because "that one hit hard" is worth
  saying.
- **All collector content deleted.** Everything auto-collects, so a card or a
  hull that improved collection was selling you something you already had. Four
  cards and MAGPIE's magnet hook went; MAGPIE now halves the scrap a hit costs.
- **Four more ships** — KESTREL (charges twice as fast), ANVIL (heaviest gun,
  six lives), HARBOUR (two extra shop cards), COMET (fastest hull, hits harder
  the faster it flies). 23 total.
- **ASCENDANT is now FLAGSHIP.** Calling the ship and the mechanic by the same
  word made every sentence about either one ambiguous.
- **Six more meteor classes**, arriving from level 180 to 900.

---

# ADDENDUM IV — visibility, cadence, the charge line (2026-08-09)

## 1. Bullets

The old shot was 3×10px with a gradient that faded to transparent at its own
tail, which is most of why it vanished against a bright nebula. Now 4.5×14 and
drawn in three layers: a soft halo so the shot carries its own light, an opaque
body that never fades, and a hard white core down the middle. Incoming fire got
the same treatment — glow plus a solid core — because a bullet you have to
dodge should never be a smudge.

## 2. Shop cadence — resolving an apparent contradiction

Two asks that sound opposed and are not:

- *"get rid of the voidbirth's debuff of not opening shops every time"*
- *"reduce the frequency that the cargo docker appears"*

The first is about **depth changing the cadence**; the second is about **the
cadence itself**. `SHOP_EVERY` is now a flat 2 at every voidbirth depth: half
as often as before, and a voidbirth never makes it worse. A test asserts the
docking pattern is byte-identical at depths 0 through 8.

Context for why every-level was wrong: levels are half as long now, so a shop
after each one meant docking roughly five times a minute. The cargo hauler had
stopped being an event and become a loading screen.

## 3. The charge line

Holding fire was one fixed mechanic every ship had identically. **Seventeen
cards** now build on it, spanning COMMON through OVERCLOCKED:

| key | what it does |
|---|---|
| `chargeSpeed` | wind-up rate (multiplier, base 1) |
| `chargePower` | lance damage (multiplier, base 1) |
| `chargeSpread` | extra lances either side of the main one |
| `chargeSplash` | burst radius where it lands |
| `chargeAuto` | fires at full charge and immediately starts the next |

`chargeSpeed` and `chargePower` are multipliers with a base of **1**, not 0 —
a test asserts neither can ever resolve below 1 at any depth, because a zero
would mean a lance that never winds up or does nothing at all.

**Inference stated:** "make charging up an upgrade feature" was read as *add an
upgrade family for it*, not *lock the charge behind an upgrade*. The base
charge still works on every hull. Gating it entirely would remove a working
mechanic, which is the more expensive mistake if the reading is wrong.

---

# ADDENDUM V — cadence and scrap (2026-08-11)

**`SHOP_EVERY` 2 → 4.** At 12-second levels the hauler now arrives about once a
minute. Still flat at every voidbirth depth — the test that asserts the docking
pattern is identical from depth 0 to 8 is the one that must never break, so it
reads the constant rather than a literal.

**Scrap is credited, never collected.** It used to spawn a hex that flew to the
ship; at a real kill rate that is a constant stream of small objects crossing
the screen, sitting on top of the one thing you actually need to see. It is
income — it just arrives. Consecutive grants inside 24 frames merge into a
single rising number instead of stacking a dozen on the same spot.

Boosts (shield, life, overdrive, cold snap) still drop as objects. They are
events, not income, and there are only ever a handful on screen. `PICKUP` lost
its `scrap` entry along with the collect and draw branches for it.

Verified in a browser: 2,500 frames of real play at level 30 put **zero**
pickups on screen, and income is unchanged (14,087 scrap over two levels with
no deaths — the low figure in the first measurement was the 50%-per-hit
penalty, not a regression).

---

# ADDENDUM VI — why it stopped being hard (2026-08-18)

## The measurement

A pilot that **never moves** — the worst possible player — booted headless:

| build | enemies on screen | incoming bullets | outcome |
|---|---|---|---|
| bare | 17.7 | 14.7 | dead in 8s |
| strong | 0.5–2.8 | **0.5–1** | 3 minutes, **zero hits** |

Then the decisive one. The immortal build was **invulnerable 87% of a
two-minute fight**, taking 32 shield blocks. The screen was *not* empty and it
*was* being hit — every block bought a mercy window nearly as long as the gap
until the next hit, so the windows chained into permanent immunity.

Two independent causes, then, and the second was the real one.

## 1. Threat was capped; damage was not

`spawnRate` floored at 35 frames from level 11 and never moved: 1.71 ships a
second at level 20 and the same 1.71 at level 2,500. Only health grew — and
**health is not threat**, because an enemy needs about a second and a half on
screen before it fires. Anything killed faster contributes nothing however
tough it was.

- `spawnRateAt` keeps shrinking past the knee, floor 5 frames (12/s).
- `spawnBurstAt` sends **groups**, up to 4 at a time. Rate alone cannot fill a
  screen against a build that deletes a ship on contact.
- `spawnReadiness` — at depth ships arrive with most of their firing cycle
  already spent, so a tough hull gets its round off before it dies. This is
  what finally makes enemy health mean something.
- Concurrent enemy cap 40 → 64.

Effective pressure: **1.7/s → 6.5/s at level 40, 19.6/s at level 90.**
Untouched below level 11.

## 2. Mercy windows chained

- `MAX_SHIELD_MERCY = 90` — a block bought up to 180 frames. Mercy nearly as
  long as the gap between hits *is* immunity.
- `mercyFor` decays the window on repeated blocks, floored so a block always
  reads.
- `SHIELD_REGEN_RATIO` forces regrowth strictly slower than the mercy granted,
  enforced on the **resolved stats** so no card *combination* can recreate the
  loop. A test pairs every regen card with every mercy card at every depth.
- `MAX_GRACE_SECONDS = 2.5` — one card gave five.
- The regen ceiling was `shieldCharges + 3`, letting a 3-charge build float
  six. Now the resolved cap.
- Lives from kills are capped at 3 a run: kill rate scales with damage, so an
  uncapped source means the stronger you get the more lives you gain.

## 3. You had to die to get paid

`endRun()` was the only place credits were banked, so a run you could not lose
paid **nothing**. This was arguably the more annoying half of the report.

- `bankCredits()` pays out every level clear, on the difference between earned
  and already-paid, so the compressive curve still applies to the run total.
- **RETIRE**, on the pause panel mid-run, ends the run deliberately. Two
  presses. A retired run and a wrecked one pay identically.

## Result — stationary pilot, level 60

| build | before | after |
|---|---|---|
| bare | 5.6s | 5.6s |
| strong | ~78s | 23.6s |
| maxed endgame | never died | 131.5s |

The gradient is the point: a big build should be *much* stronger, not immortal.
Early levels are untouched — a bare ship still survives 20s at level 1 standing
completely still.

---

# ADDENDUM VII — pause (2026-08-18)

**P pauses, ESCAPE opens settings.** They used to be the same action bound to
two keys; both opened the settings panel.

The pause is a freeze, not a state change: the game stays in `'play'` and the
loop simply stops advancing. Everything that ticks already lives inside
`update()`, so timers, mercy windows, spawn clocks and the level countdown all
hold exactly where they were — and the starfield stops too, because a frozen
game with moving scenery reads as a bug rather than as a pause.

**Save v6** strips `'p'` off the old settings binding. Without that, an
existing save would open the panel instead of pausing and nothing on screen
would explain why. A binding left empty by the strip falls back to its default
rather than becoming unreachable.

**Touch gets a pause button** (bottom left, clear of the charge pad), or the
feature would be desktop-only on the device it is most likely played on.

## What this turned up

Writing "no two actions share a default key" as a test failed immediately:
`'s'` was bound to both MOVE DOWN and SKIP SHOP.

`MOVE UP` and `MOVE DOWN` were **never read by anything**. The ship flies at a
fixed height by design, so vertical input has never done a thing — but both sat
in the settings screen as rows a player could carefully configure. That is this
project's oldest bug wearing a menu instead of an upgrade card.

Both removed, and `tools/hookaudit.mjs` gained two checks so it cannot recur:
every action in `BIND_ORDER` must be read by `keyMatches` or `held`, and no two
actions may claim the same default key.
