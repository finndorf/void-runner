# VOID RUNNER

A single-file arcade space shooter. No build step, no dependencies, no server —
the entire game (code, styles, and synthesized audio) lives in `void-runner.html`.

**Play it:** https://voidrunner.vercel.app

## Running it locally

Open `void-runner.html` in any browser. That's it.

## What's in here

| Path | What it is |
| --- | --- |
| `void-runner.html` | The whole game. |
| `vercel.json` | Serves the game at the site root. |
| `docs/superpowers/specs/` | The 2.0 design spec. |
| `docs/superpowers/plans/` | The 2.0 implementation plan. |

## Deploying

Pushing to `main` deploys to production automatically via Vercel's GitHub
integration. To deploy by hand instead:

```
vercel deploy --prod
```

## Features

- 5-level weapon progression, with weapon loss on hit
- Kamikaze, turret, and mine enemies plus formation waves
- Three-phase boss fights every 5 levels
- Ship select, credits, and unlockable ships
- Procedural music and synthesized sound effects
- Hit-stop, shockwave explosions, hit flash, and a combo meter
- Progress saved in the browser
