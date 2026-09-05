# Architecture

RCC is a server-rendered runtime with a static browser dashboard.

```text
Browser dashboard
  ├─ HTTPS/REST ── authentication, configuration and commands
  ├─ WebSocket ─── state, diagnostics and chat
  └─ Socket.IO ─── live chunks, block states, entities, HUD and POV controls
                       │
        maximized-card activation → iframe pointer lock → one-account lease
                       │
Node.js runtime ── viewer-control-socket ── MultiBotManager ── one BotService per account
                       │
                  Mineflayer clients ── Minecraft servers
```

The authenticated Socket.IO handshake binds a viewer to the requested account. Guests receive the same read-only terrain, entity, HUD, chat and inventory stream, but only admins may acquire that account's five-second dead-man lease. Heartbeats run reliably once per second, and valid control input also refreshes the lease; the lease is denied to competing sessions and releases Mineflayer movement, digging and held-item state on expiry. The BotService also waits for Mineflayer's server-position/`forcedMove` readiness signal in addition to `physicsEnabled` before exposing movement, and revokes the lease before world transitions, reconnects, disconnects and disposal. The parent dashboard sends same-origin activation messages only to the selected maximized iframe, and the iframe requires that activation, Bot POV mode, its own pointer lock, a live socket and a granted lease before it emits control.

POV world state remains event-driven: Mineflayer updates its authoritative world, `WorldView` emits chunk and block changes, and the authenticated server forwards those changes over Socket.IO. The browser's Prismarine Viewer applies each block state with `setBlockStateId`, which dirties only the affected section and its culling neighbours. Mineflayer entity metadata is normalized into RCC player poses before it crosses the same boundary; when a server omits the crawl pose, the self-player bridge checks authoritative collision shapes around the bot, calculates the lowest collision face covering the player footprint, and treats only a 0.6-to-1.5-block clearance as swimming/crawling. Relevant `blockUpdate` events re-evaluate that inferred pose immediately. The browser applies pose transforms to the player model child while keeping world position, yaw, interpolation and nametags on the entity root. This fallback changes the rendered POV state only; Minecraft remains authoritative for the actual server-side entity pose.

Pose diagnostics are disabled in normal operation. Set `RCC_POSE_DIAGNOSTICS=true` for server-side `[POSE]` traces, and add `?poseDiagnostics=1` to the viewer URL only when browser-side model tracing is needed. The viewer also provides a client-only Crawl view toggle (button or `C` key) for cases where the server's pose metadata or collision geometry cannot be inferred; it changes only the local camera/model presentation.

For modern 1.21.3+/26.1 movement, RCC synchronizes the complete `player_input` state with each movement packet, keeps rotation and horizontal-collision flags consistent with the local physics entity, and closes physics ticks with the supported `tick_end` packet. Legacy protocol movement remains on Mineflayer's native path.

## Main directories

- `src/` — authenticated HTTP server, configuration, bots, policies and automation
- `public/` — static dashboard and generated POV browser assets
- `viewer-client/` — source for the browser-side 3D viewer
- `scripts/` — deterministic build helpers
- `test/` — policy, authentication, persistence and integration tests
- `docs/` — public project documentation

The POV worker is generated during `pnpm build` and intentionally excluded from Git because it is a large deterministic dependency artifact.
