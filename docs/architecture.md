# Architecture

RCC is a server-rendered runtime with a static browser dashboard.

```text
Browser dashboard
  ├─ HTTPS/REST ── authentication, configuration and commands
  ├─ WebSocket ─── state, diagnostics and chat
  └─ Socket.IO ─── live chunks, entities, HUD and POV controls
                       │
Node.js runtime ── MultiBotManager ── one BotService per account
                       │
                  Mineflayer clients ── Minecraft servers
```

## Main directories

- `src/` — authenticated HTTP server, configuration, bots, policies and automation
- `public/` — static dashboard and generated POV browser assets
- `viewer-client/` — source for the browser-side 3D viewer
- `scripts/` — deterministic build helpers
- `test/` — policy, authentication, persistence and integration tests
- `docs/` — public project documentation

The POV worker is generated during `pnpm build` and intentionally excluded from Git because it is a large deterministic dependency artifact.
