> [!WARNING]
> This is a passion project built and maintained with AI.

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

## Access Token Tutorial

RCC supports two different token types. They cannot be exchanged:

| Token type | RCC option | Purpose |
| --- | --- | --- |
| Microsoft OAuth Access Token | Microsoft OAuth Access Token | Microsoft authentication / Prismarine Authflow |
| Minecraft Java Access Token | Minecraft Java Access Token | Direct Minecraft Java authentication |

> [!WARNING]
> Access tokens are credentials. Never share them, post them in GitHub issues, screenshots, Discord, logs, or commits.

Run the commands below from the RCC repository root. The helper uses the installed `prismarine-auth` package. Login instructions go to the terminal's error stream, while standard output contains only the final token so it can be sent directly to a clipboard command. Use a clipboard pipe; running the helper without one prints the credential in the terminal.

## Microsoft OAuth Access Token

This works regardless of which Minecraft launcher you normally use. It uses the current `Authflow.getMsaToken()` device-code method.

### Windows PowerShell

```powershell
node scripts/get-access-token.cjs msa | Set-Clipboard
```

Complete the Microsoft login shown in the terminal, then in RCC open **Accounts → Edit → Token type → Microsoft OAuth Access Token**, paste with **Ctrl+V**, and select **Save profile**.

### macOS

```bash
node scripts/get-access-token.cjs msa | pbcopy
```

Paste into **Accounts → Edit → Token type → Microsoft OAuth Access Token**. Clear the clipboard afterwards with:

```bash
pbcopy </dev/null
```

### Linux Wayland

```bash
node scripts/get-access-token.cjs msa | wl-copy
```

### Linux X11

```bash
node scripts/get-access-token.cjs msa | xclip -selection clipboard
```

## Minecraft Java Access Token

This is the final Minecraft Services access token used for a Minecraft Java session. It is not a Microsoft OAuth token, Xbox token, XSTS token, or refresh token.

### Generic method

The helper uses the current `getMinecraftJavaToken({ fetchProfile: true })` method and validates that a Minecraft Java profile was returned.

Windows PowerShell:

```powershell
node scripts/get-access-token.cjs minecraft | Set-Clipboard
```

macOS:

```bash
node scripts/get-access-token.cjs minecraft | pbcopy
```

Linux Wayland:

```bash
node scripts/get-access-token.cjs minecraft | wl-copy
```

Linux X11:

```bash
node scripts/get-access-token.cjs minecraft | xclip -selection clipboard
```

Complete the Microsoft login, then paste into **Accounts → Edit → Token type → Minecraft Java Access Token → Access token → Save profile**. RCC should show `Valid · Minecraft`.

### Get Minecraft Java Token From Your Launcher

The generic method above is the recommended option. RCC does not bypass launcher encryption, inspect other processes, read browser cookies, or dump memory.

<details>
<summary>Official Minecraft Launcher</summary>

Direct token extraction is not currently documented reliably for the current launcher builds. Use the generic method:

```text
Windows: node scripts/get-access-token.cjs minecraft | Set-Clipboard
macOS:   node scripts/get-access-token.cjs minecraft | pbcopy
Linux:   node scripts/get-access-token.cjs minecraft | wl-copy
```

</details>

<details>
<summary>Lunar Client</summary>

Direct token extraction is not currently documented reliably. Use the generic method:

```text
Windows: node scripts/get-access-token.cjs minecraft | Set-Clipboard
macOS:   node scripts/get-access-token.cjs minecraft | pbcopy
Linux:   node scripts/get-access-token.cjs minecraft | wl-copy
```

</details>

<details>
<summary>CurseForge</summary>

Direct token extraction is not currently documented reliably. Use the generic method:

```text
Windows: node scripts/get-access-token.cjs minecraft | Set-Clipboard
macOS:   node scripts/get-access-token.cjs minecraft | pbcopy
Linux:   node scripts/get-access-token.cjs minecraft | wl-copy
```

</details>

<details>
<summary>Modrinth App</summary>

The current Modrinth App stores Minecraft credentials in its internal SQLite data store, but a stable, safe cross-platform extraction command is not documented here. Use the generic method:

```text
Windows: node scripts/get-access-token.cjs minecraft | Set-Clipboard
macOS:   node scripts/get-access-token.cjs minecraft | pbcopy
Linux:   node scripts/get-access-token.cjs minecraft | wl-copy
```

</details>

<details>
<summary>Prism Launcher</summary>

The current Prism Launcher stores the final Minecraft/Yggdrasil access token in `accounts.json` under `ygg.token`, with the selected player name under `profile.name`. Close Prism Launcher before reading the file. The RCC helper reads only that token, never prints the account JSON, and never modifies the file.

Windows:

```powershell
node scripts/get-access-token.cjs prism "PlayerName" | Set-Clipboard
```

macOS:

```bash
node scripts/get-access-token.cjs prism "PlayerName" | pbcopy
```

Linux Wayland:

```bash
node scripts/get-access-token.cjs prism "PlayerName" | wl-copy
```

Linux X11:

```bash
node scripts/get-access-token.cjs prism "PlayerName" | xclip -selection clipboard
```

The helper checks the current standard locations: `%APPDATA%/PrismLauncher` on Windows, `~/Library/Application Support/PrismLauncher` on macOS, and `~/.local/share/PrismLauncher` on Linux, including the standard Linux Flatpak location. If Prism uses a portable or custom data directory, set `PRISM_LAUNCHER_ACCOUNTS` to the `accounts.json` file first. If multiple accounts exist, replace `PlayerName` with the exact Minecraft player name.

Then paste into **Accounts → Edit → Token type → Minecraft Java Access Token → Access token → Save profile**.

</details>

<details>
<summary>Badlion Client</summary>

Direct token extraction is not currently documented reliably. Use the generic method:

```text
Windows: node scripts/get-access-token.cjs minecraft | Set-Clipboard
macOS:   node scripts/get-access-token.cjs minecraft | pbcopy
Linux:   node scripts/get-access-token.cjs minecraft | wl-copy
```

</details>

<details>
<summary>LabyMod 4</summary>

Direct token extraction is not currently documented reliably. Use the generic method:

```text
Windows: node scripts/get-access-token.cjs minecraft | Set-Clipboard
macOS:   node scripts/get-access-token.cjs minecraft | pbcopy
Linux:   node scripts/get-access-token.cjs minecraft | wl-copy
```

</details>

<details>
<summary>Dawn / Feather</summary>

Direct token extraction is not currently documented reliably. Use the generic method:

```text
Windows: node scripts/get-access-token.cjs minecraft | Set-Clipboard
macOS:   node scripts/get-access-token.cjs minecraft | pbcopy
Linux:   node scripts/get-access-token.cjs minecraft | wl-copy
```

</details>

<details>
<summary>ATLauncher</summary>

ATLauncher stores account data relative to its configured launcher working directory and its current account implementation refreshes Microsoft-backed credentials. There is no stable, verified cross-platform extraction command for the final token. Use the generic method:

```text
Windows: node scripts/get-access-token.cjs minecraft | Set-Clipboard
macOS:   node scripts/get-access-token.cjs minecraft | pbcopy
Linux:   node scripts/get-access-token.cjs minecraft | wl-copy
```

</details>

<details>
<summary>FTB App</summary>

Direct token extraction is not currently documented reliably. Use the generic method:

```text
Windows: node scripts/get-access-token.cjs minecraft | Set-Clipboard
macOS:   node scripts/get-access-token.cjs minecraft | pbcopy
Linux:   node scripts/get-access-token.cjs minecraft | wl-copy
```

</details>

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
