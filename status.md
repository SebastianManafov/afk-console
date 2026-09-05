# RCC Status

Updated: 2026-09-05

## Current status

RCC’s browser dashboard and POV control path are implemented and verified. The
POV sidebar now exposes Bot POV and Freecam as an expandable nested mode choice
while retaining the shared renderer and existing Bot POV control path.

Live block-state forwarding is implemented. The self-player swimming/crawling
pose path now recognizes both the authoritative metadata pose and Minecraft’s
shared-flags swimming bit. The viewer also infers crawling for the self bot
from authoritative collision shapes when the lowest collision face covering
the player footprint leaves between 0.6 and 1.5 blocks of clearance. Relevant
block updates re-evaluate the render pose immediately. Browser caching is no
longer part of the investigation.
The fallback is render-only; Minecraft remains authoritative for the actual
server-side pose. The viewer now also has a client-only Crawl view override,
available from the button in the POV or with the `C` key, for layouts such as
an anvil in a 1x1 space where collision inference is ambiguous. The automatic
fallback remains deliberately conservative: it requires a collision surface
covering the full player footprint, so multi-box blocks can still require the
manual override.

## Completed

- POV control uses Mineflayer movement and interaction states directly.
- POV mode selection lives in the expandable sidebar item under `08 POV`: Bot
  POV controls the real bot, while Freecam moves only the local camera through
  the loaded world.
- Accounts show a derived token status with no token value in the browser;
  Microsoft OAuth and Minecraft Java tokens are selected explicitly, stored in
  separate encrypted per-account paths, and displayed only as safe status
  metadata.
- README includes the Access Token Tutorial with the exact Microsoft OAuth and
  Minecraft Java terminology, clipboard-safe helper commands, and verified
  Prism Launcher extraction guidance; other launcher-specific extraction uses
  the generic method where no stable path was verified.
- The legacy `CHANGELOG.md` was removed; `README.md` is the primary project
  overview and usage documentation.
- Viewer leases use reliable one-second heartbeats with a five-second dead-man
  timeout and refresh on valid movement, look, and action input.
- Lease expiry and every authoritative cleanup path clear movement states,
  stop digging, and deactivate held-item use.
- POV controls remain admin-only and require a maximized card, Bot POV mode,
  and pointer lock owned by the active iframe.
- Guests retain read-only dashboard, viewer, Freecam, diagnostics, and preview
  access.
- The dashboard frontend was consolidated into a warm, editorial minimalist
  visual system with consistent typography, spacing, borders, buttons, forms,
  tables, dialogs, empty states, and responsive layouts.
- POV canvas chrome was reduced to the gameplay HUD, crosshair, chat, player
  list, and minimap; Bot POV and Freecam selection remains in the dashboard.
- Generated POV assets were rebuilt through the existing CSP-safe build
  pipeline.
- Modern 1.21.3+/26.1 movement synchronizes complete `player_input` state,
  movement rotation, horizontal-collision flags, and `tick_end`; legacy
  protocol movement remains on Mineflayer’s native path.
- Authoritative Mineflayer/WorldView `blockUpdate` events are forwarded to the
  browser viewer as position plus state ID, so redstone and other live block
  states do not require chunk reloads.
- When the self bot is inside a low-clearance collision space and the server
  omits a swimming pose, the viewer bridge maps the geometry-derived state to
  the swimming/crawling render pose without changing Minecraft movement.
- The client-only Crawl view button and `C` key lower the local POV and rotate
  the rendered self-player model without sending a pose or movement change to
  Minecraft.
- Anvil and other multi-box collision layouts are documented as an inference
  limitation rather than changing Minecraft's authoritative pose state.

## Pose synchronization

- Commit `ed8d998` added self-only raw `entity_metadata` packet logging,
  Mineflayer metadata indexes 0 and 6, shared flag `0x10`, normalized pose,
  emitted `selfEntity`/`position` payloads, browser pose reception, viewer
  entity lookup, `SkinnedMesh` selection, and model rotation before/after
  `applyPlayerPose()` and `viewer.updateEntity()`.
- `normalizePlayerPose()` recognizes metadata pose value `3` and shared-flags
  bit `0x10`; the latter is required because Mineflayer stores the byte but
  does not map its swimming meaning.
- The target runtime trace reached the server/browser/model stages with
  `standing`: self metadata contained `metadata[0]=0`, no `metadata[6]`, and
  no `0x10`; the browser received `standing`, found the real viewer
  `SkinnedMesh`, and applied rotation `0`. No crawl transition was present in
  that capture.
- Listener cleanup and low-clearance enter/leave transitions are covered by
  the viewer-state tests. Server traces are now gated by
  `RCC_POSE_DIAGNOSTICS=true`; browser model traces are gated by the
  `poseDiagnostics=1` viewer query parameter.

## Verification

- The current collision-derived crawl fallback still needs verification in a
  Node 22/pnpm 11 checkout; Node and pnpm were unavailable in this workspace,
  so it was not rerun here.
- The client-only Crawl view override was added after the recorded verification
  and also needs the next Node 22/pnpm 11 build/test pass.
- The preceding snapshot's `pnpm build` passed.
- The preceding snapshot's `pnpm test` passed: 68 tests, 0 failures; the
  client-only override still needs to be included in a fresh run.
- POV item-icon and geometry regressions passed for 1.21.4, including Y=`-64`
  and Y=`288` sections.
- `git diff --check` passed for the client override change.
- Browser visual QA passed across login, dashboard pages, settings, POV mode
  selection, accounts token-type editor, macros, inventory, chat, dark theme,
  dialogs, and responsive layout using an offline local run. No Minecraft
  server was joined during verification.
- Token-vault and dashboard redaction tests confirm submitted access tokens are
  encrypted at rest, Minecraft Java profiles are validated server-side, direct
  Minecraft sessions bypass Microsoft Authflow, and tokens are absent from
  normal API/state responses.
- Pose instrumentation and the shared-flags fix are committed and pushed to
  `origin/main` at `ed8d998`; collision inference is at `580ad5a`, and the
  client-only Crawl view override is at `18f2375`.

## Using browser controls

1. Log in with an admin dashboard session.
2. Open `POV`, expand `08 POV` in the sidebar, and choose `Bot POV` or
   `Freecam`.
3. Maximize one bot card, then click the canvas to acquire pointer lock.
4. In Bot POV, use `W`, `A`, `S`, `D` for movement; mouse movement to look;
   `Space` to jump; `Shift` to sneak; and `Ctrl` to sprint. Freecam movement
   stays client-side and does not send Minecraft movement controls.
5. Use `Crawl view` or press `C` to force a client-only swimming/crawling view;
   press it again to return to the server-reported pose.
6. Press `Escape` to release controls. After a disconnect, timeout, or world
   transition, click the canvas again once the bot is stable to reacquire the
   lease.

Non-maximized cards and Freecam never emit bot controls.

## Next operator step

Once the latest commit is available in the target environment, rebuild and
start the dashboard. In the 1x1 anvil layout, use `Crawl view` or press `C` and
verify that the POV camera lowers and the rendered model rotates horizontally.
Then test automatic detection separately. If the raw metadata path still
needs investigation, set `RCC_POSE_DIAGNOSTICS=true` and add
`?poseDiagnostics=1` to the viewer URL temporarily.

For Codespaces:

```bash
cd /workspaces/afk-console
git pull --ff-only
pnpm install --frozen-lockfile --prod=false
pnpm run build
```

Start only after the build succeeds:

```bash
pnpm start
```

## Constraints

- Keep the configured 26.1/26.1.2 bot protocol path intact.
- Keep the Prismarine-compatible 1.21.4 render profile local to the viewer.
- Edit viewer sources and regenerate `public/pov-viewer/index.js` through
  `pnpm build`; do not hand-edit generated bundles.
- Do not commit `.env`, account tokens, proxy credentials, webhook URLs, or
  other live-server secrets.
