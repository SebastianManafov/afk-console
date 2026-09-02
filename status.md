# POV Status

Updated: 2026-09-02

## Main goal

Fix the browser POV for Minecraft 1.21.4 so terrain blocks render correctly.
Do not spend time on 26.2. Keep the existing authenticated POV controls and
HUD behavior working.

## Confirmed root cause

The server is receiving and forwarding world data correctly. The browser
worker crashes before it can build meshes because the generated Prismarine
worker executes `eval("require")`. The dashboard Content Security Policy does
not allow `unsafe-eval`.

Observed browser error:

```text
Uncaught EvalError: Evaluating a string as JavaScript violates this Content
Security Policy directive because 'unsafe-eval' is not an allowed source
```

The live diagnostics showed 121 chunks loaded and initialized, with valid
1.21.4 sections from `minY=-64` through height `384`. The missing geometry was
therefore a worker failure, not missing chunk packets.

## Fix already applied

Commit `f9ac240` (`Fix CSP compatibility for 1.21.4 POV worker`) changes only
the build-time patch in `scripts/build-pov-worker.cjs`: the official
Prismarine worker is retained, but its Node fallback now detects Node without
using `eval`. The existing modern section-index patches remain in place.

`scripts/test-pov-worker.cjs` also rejects a generated worker containing the
CSP-blocked fallback.

## Verification completed

- `pnpm test` passed with all 37 tests.
- The POV worker geometry test passed for 1.21.4 at Y=`-64`, Y=`64`, and
  Y=`288`.
- The fix was pushed to `origin/main`.

## Next session

Validate the fix in the running dashboard/browser:

```bash
git stash push -m "local generated POV bundle" -- public/pov-viewer/index.js
git pull origin main
pnpm build
pnpm start
```

Open the POV page, hard-refresh it, and confirm that terrain blocks are visible
and that no worker CSP error appears in the browser console. If blocks still do
not render, capture the first new `[POV] worker error`, geometry count, and
browser console error before changing the renderer again.

## Important constraints

- Target render profile: Minecraft 1.21.4.
- Edit `viewer-client/` or `scripts/build-pov-worker.cjs`; regenerate outputs
  with `pnpm build` rather than hand-editing generated bundles.
- Preserve negative-height rendering, high sections, freecam, entity rendering,
  HUD, inventory, chat, and WASD/mouse controls.
- The working tree currently also has local changes in
  `scripts/build-pov-worker.cjs` and `scripts/test-pov-worker.cjs`, plus
  untracked `.pnpm-store/`, `viewer-client/pov-chunk.cjs`, and
  `viewer-client/pov-worker.cjs`; inspect these before overwriting anything.
