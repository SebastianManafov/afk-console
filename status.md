# RCC Status

Updated: 2026-09-03

## Current status

RCC’s browser dashboard and POV control path are implemented and verified. The
POV sidebar now exposes Bot POV and Freecam as an expandable nested mode choice
while retaining the shared renderer and existing Bot POV control path.

Live block-state forwarding is implemented. The self-player swimming/crawling
pose issue is still under investigation: commit `cee601e` adds change-gated
server and browser diagnostics for the complete pose pipeline. The A–F failure
classification is pending a trace from the running Minecraft bot; browser
caching is no longer part of the investigation.

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

## Pose investigation

- The diagnostic commit logs self-only raw `entity_metadata` packets,
  Mineflayer metadata indexes 0 and 6, shared flag `0x10`, normalized pose,
  emitted `selfEntity`/`position` payloads, browser pose reception, viewer
  entity lookup, `SkinnedMesh` selection, and model rotation before/after
  `applyPlayerPose()` and `viewer.updateEntity()`.
- `normalizePlayerPose()` currently recognizes metadata pose value `3`, but
  the shared-flags swimming bit `0x10` remains to be applied after live
  evidence identifies the failing stage.
- Listener cleanup is covered by the viewer-state test; no live Minecraft
  reproduction has been captured yet, so A–F is not classified.

## Verification

- `pnpm build` passed.
- `pnpm test` passed: 66 tests, 0 failures.
- POV item-icon and geometry regressions passed for 1.21.4, including Y=`-64`
  and Y=`288` sections.
- `git diff --check` passed.
- Browser visual QA passed across login, dashboard pages, settings, POV mode
  selection, accounts token-type editor, macros, inventory, chat, dark theme,
  dialogs, and responsive layout using an offline local run. No Minecraft
  server was joined during verification.
- Token-vault and dashboard redaction tests confirm submitted access tokens are
  encrypted at rest, Minecraft Java profiles are validated server-side, direct
  Minecraft sessions bypass Microsoft Authflow, and tokens are absent from
  normal API/state responses.
- Pose instrumentation is committed and pushed to `origin/main` at `cee601e`;
  this status update is the only pending change.

## Using browser controls

1. Log in with an admin dashboard session.
2. Open `POV`, expand `08 POV` in the sidebar, and choose `Bot POV` or
   `Freecam`.
3. Maximize one bot card, then click the canvas to acquire pointer lock.
4. In Bot POV, use `W`, `A`, `S`, `D` for movement; mouse movement to look;
   `Space` to jump; `Shift` to sneak; and `Ctrl` to sprint. Freecam movement
   stays client-side and does not send Minecraft movement controls.
5. Press `Escape` to release controls. After a disconnect, timeout, or world
   transition, click the canvas again once the bot is stable to reacquire the
   lease.

Non-maximized cards and Freecam never emit bot controls.

## Next operator step

Pull the pushed diagnostic commit, rebuild, and start the dashboard in the
target environment. Reproduce the bot’s swimming/crawling state, then collect
all server log lines and browser DevTools console lines containing
`[POV pose]`. Those logs are required to classify A–F before changing the pose
implementation.

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
