# RCC Status

Updated: 2026-09-03

## Current status

RCC’s browser dashboard and POV control path are implemented and verified. The
latest frontend redesign is available on `origin/main` in commit `ef81477`
(`Redesign dashboard with warm minimal UI`).

## Completed

- POV control uses Mineflayer movement and interaction states directly.
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
- POV HUD styling, control hints, status states, and accessibility attributes
  were refreshed without changing renderer or control behavior.
- Generated POV assets were rebuilt through the existing CSP-safe build
  pipeline.

## Verification

- `pnpm build` passed.
- `pnpm test` passed: 50 tests, 0 failures.
- POV item-icon and geometry regressions passed for 1.21.4, including Y=`-64`
  and Y=`288` sections.
- `git diff --check` passed.
- Browser visual QA passed across login, dashboard pages, settings, POV,
  macros, inventory, chat, dark theme, dialogs, and responsive layout using
  an offline local run. No Minecraft server was joined during verification.
- The working tree is clean and `HEAD` matches `origin/main`.

## Using browser controls

1. Log in with an admin dashboard session.
2. Open `POV` and maximize the bot card.
3. Click the canvas to acquire pointer lock.
4. Use `W`, `A`, `S`, `D` for movement; mouse movement to look; `Space` to
   jump; `Shift` to sneak; and `Ctrl` to sprint.
5. Press `Escape` to release controls. After a disconnect, timeout, or world
   transition, click the canvas again once the bot is stable to reacquire the
   lease.

Non-maximized cards and Freecam never emit bot controls.

## Next operator step

Pull the pushed commit, rebuild, and start the dashboard in the target
environment. Then perform live browser QA with an authorized admin account
against the intended Minecraft server, including pointer-lock switching,
minimize/restore, tab hiding, reconnects, macros, and world transitions.

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
