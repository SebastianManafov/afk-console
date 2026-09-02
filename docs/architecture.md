# Architecture

RCC is a server-rendered runtime with a static browser dashboard.

```text
Browser dashboard
  ├─ HTTPS/REST ── authentication, configuration and commands
  ├─ WebSocket ─── state, diagnostics and chat
  └─ Socket.IO ─── live chunks, entities, HUD and POV controls
                       │
        maximized-card activation → iframe pointer lock → one-account lease
                       │
Node.js runtime ── viewer-control-socket ── MultiBotManager ── one BotService per account
                       │
                  Mineflayer clients ── Minecraft servers
```

The authenticated Socket.IO handshake binds a viewer to the requested account. Guests receive the same read-only terrain, entity, HUD, chat and inventory stream, but only admins may acquire that account's five-second dead-man lease. Heartbeats run reliably once per second, and valid control input also refreshes the lease; the lease is denied to competing sessions and releases Mineflayer movement, digging and held-item state on expiry. The BotService also revokes the lease before world transitions, reconnects, disconnects and disposal. The parent dashboard sends same-origin activation messages only to the selected maximized iframe, and the iframe requires that activation, Bot POV mode, its own pointer lock, a live socket and a granted lease before it emits control.

## Main directories

- `src/` — authenticated HTTP server, configuration, bots, policies and automation
- `public/` — static dashboard and generated POV browser assets
- `viewer-client/` — source for the browser-side 3D viewer
- `scripts/` — deterministic build helpers
- `test/` — policy, authentication, persistence and integration tests
- `docs/` — public project documentation

The POV worker is generated during `pnpm build` and intentionally excluded from Git because it is a large deterministic dependency artifact.
