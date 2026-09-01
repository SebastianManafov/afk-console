# Working on RCC

This file applies to the entire `afk-console` repository. If a deeper directory
contains another `AGENTS.md`, its instructions apply to that subtree as well.
Direct system, developer, and user instructions always take precedence.

## Project purpose

RCC (Remote Console Client) is a self-hosted Minecraft Java client with a
password-protected web dashboard. It manages multiple accounts, server
profiles, movement, chat, inventory, automation, encrypted authentication
state, and a browser-based 3D point-of-view viewer.

Keep changes focused on RCC. Do not copy proprietary code, branded assets, or
private data from another dashboard or service.

## Repository map

- `src/index.ts` — application entry point and shutdown handling.
- `src/server.ts` — HTTP/static server, authentication boundary, WebSocket and
  Socket.IO APIs, and viewer event wiring.
- `src/bot-service.ts` — Minecraft connection lifecycle and protocol handling.
- `src/multi-bot-manager.ts` — account synchronization and multi-bot control.
- `src/auth.ts`, `src/token-vault.ts`, `src/config.ts` — authentication,
  encrypted session storage, configuration, and persistence.
- `src/*-macro.ts` — guarded automation workflows.
- `viewer-client/` — browser viewer entry point, compatibility aliases, and
  canvas shim used by webpack.
- `scripts/build-pov-worker.cjs` — reproducibly patches the Prismarine worker
  during `pnpm build`.
- `scripts/test-pov-worker.cjs` — regression checks for the generated viewer
  worker.
- `public/` — dashboard files and viewer assets. `dist/` and
  `public/pov-viewer/index.js`/`worker.js` are build outputs.
- `test/` — TypeScript unit and integration tests.
- `docs/` — configuration, architecture, and automation documentation.

## Toolchain and commands

Use Node.js 22 or newer and pnpm 11 (Corepack may be used to activate the
version declared in `package.json`). Run commands from this repository root.

```bash
pnpm install --frozen-lockfile
pnpm build       # TypeScript, browser bundle, and patched POV worker
pnpm test        # build, POV worker regression test, and Node test suite
pnpm dev         # development server with TypeScript watch mode
pnpm start       # run the compiled server after pnpm build
```

For a local run, copy `.env.example` to `.env` or export equivalent variables.
At minimum, set a dashboard password of at least eight characters,
`SESSION_SECRET`, and `CONFIG_ENCRYPTION_KEY` (use random 32-byte values).
Open the dashboard at `http://localhost:3000` unless a different port is
configured.

## Viewer and Minecraft-version rules

- Keep the existing `26.1`/`26.1.2` path working; do not silently change the
  bot protocol or the configured server version.
- The Prismarine-compatible render profile is `1.21.4`. The worker may map
  `26.1.2` to the compatible worker schema, but that mapping must stay local to
  viewer rendering.
- World rendering must support the modern vertical range from Y=-64 through at
  least Y=300. Preserve regression coverage for a negative section and a high
  section (currently exercised at Y=-64 and Y=288).
- Edit `viewer-client/` or `scripts/build-pov-worker.cjs`, then run `pnpm build`;
  do not hand-edit generated bundles or `dist/`.
- Preserve authenticated viewer endpoints and the existing Bot POV/freecam,
  player-entity, HUD, inventory, chat, and WASD/mouse control behavior unless a
  change explicitly requires otherwise.

## Implementation guidance

- Follow the existing TypeScript/ESM style and strict compiler settings. Keep
  CommonJS-only build helpers in `.cjs` files.
- Prefer small, typed changes over broad rewrites. Validate untrusted network,
  browser, and Minecraft packet data at the boundary.
- Reuse existing events, snapshots, policies, and error handling instead of
  duplicating state or bypassing safety checks.
- Add or update tests for backend behavior, protocol edge cases, persistence,
  and viewer regressions. For visual changes, verify the built dashboard in a
  browser and include a screenshot without personal account information when
  appropriate.
- Update `README.md` or the relevant file in `docs/` when setup, behavior,
  configuration, or supported versions change.

## Security and data handling

- Never commit `.env`, `data/`, Microsoft OAuth caches, account tokens,
  dashboard passwords, session/configuration keys, proxy credentials, webhook
  URLs, or live-server dumps.
- Never log credentials or tokens. Keep the dashboard authenticated and do not
  expose port 3000 publicly without an appropriate network boundary.
- Treat proxy configuration as routing, not as an anonymity guarantee.
- Do not weaken authentication, encryption, login rate limiting, control
  authorization, or emergency-stop behavior to make a feature easier to test.
- Use only synthetic fixtures in tests and examples.

## Change and verification workflow

1. Read the relevant source, tests, and documentation before editing.
2. Check `git status` and keep unrelated user changes untouched.
3. Make the smallest coherent change and add regression coverage where useful.
4. Run the narrowest relevant check, then run `pnpm test` for code changes.
5. Run `git diff --check`, review the final diff, and confirm no secrets or
   generated artifacts were added accidentally.
6. Summarize what changed, what was verified, and any remaining limitation.

Use imperative, focused commit messages (for example, `Fix negative-height
POV sections`). After a completed code change, create the focused commit
automatically once the relevant checks pass. Documentation-only or exploratory
changes may remain uncommitted unless requested otherwise. Do not push to a
remote, rewrite history, force-push, or delete data unless the user explicitly
asks for it.
