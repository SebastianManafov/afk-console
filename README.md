# Remote Console Client (RCC)

[![CI](https://github.com/SebastianManafov/afk-console/actions/workflows/ci.yml/badge.svg)](https://github.com/SebastianManafov/afk-console/actions/workflows/ci.yml)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-5FA04E?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

RCC is a self-hosted Minecraft Java console client with a private web dashboard, encrypted authentication session storage, multi-account control, automation and a live 3D point-of-view viewer.

> [!IMPORTANT]
> RCC is an independent community project. It is not affiliated with Mojang Studios or Microsoft. Check the rules of every Minecraft server before using automation.

## Highlights

- Microsoft device-code authentication; RCC never receives your Microsoft password
- encrypted OAuth/Minecraft session cache and dashboard secrets using AES-256-GCM
- multiple accounts, server profiles and optional HTTP CONNECT proxies
- connect, chat, movement, inventory and reconnect controls from the browser
- live textured 3D world viewer with Bot POV, Freecam, HUD, chat and inventory; browser bot controls are admin-only and fail closed on focus, visibility, disconnect and world transitions
- guarded Sell and Spawner automation with previews, schedules and cancellation
- connection diagnostics, Discord webhooks, TOTP and emergency stop
- local, Codespaces and container-based operation

## Quickstart

Requirements: Node.js 22 or newer and a Minecraft Java account.

```bash
git clone https://github.com/SebastianManafov/afk-console.git
cd afk-console
pnpm install --frozen-lockfile
pnpm build
```

Create secure runtime values:

```bash
export DASHBOARD_PASSWORD='replace-with-a-strong-password'
export SESSION_SECRET="$(openssl rand -hex 32)"
export CONFIG_ENCRYPTION_KEY="$(openssl rand -hex 32)"
export DATA_DIR="$PWD/data"
export AUTO_CONNECT=false
pnpm start
```

Open `http://localhost:3000`, sign in, create a server and Microsoft account, then follow the visible Microsoft device-code flow.

## GitHub Codespaces

Open **Code → Codespaces → Create codespace on main**, then run the Quickstart commands. When RCC reports `Dashboard running on port 3000`, open port `3000` from the **Ports** panel and keep its visibility **Private**.

The Minecraft connection uses the Codespace host's public egress address—not the IP of a powered-off laptop. Codespaces can stop after inactivity and is intended for testing rather than guaranteed 24/7 hosting.

## Documentation

- [Configuration and secrets](docs/configuration.md)
- [Architecture and data flow](docs/architecture.md)
- [Automation safety](docs/automation.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)

## Development

```bash
pnpm install --frozen-lockfile
pnpm test
```

`pnpm test` compiles TypeScript, generates the versioned POV item icons, builds the browser POV bundle and CSP-safe worker, then runs the complete Node.js test suite.

## Security

Never commit `.env`, `data/`, Microsoft cache files, dashboard passwords, session keys, proxy credentials or webhook URLs. Changing `SESSION_SECRET` or `CONFIG_ENCRYPTION_KEY` makes existing encrypted vault files unreadable without the previous key.

Report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

RCC is available under the [MIT License](LICENSE).
