# Configuration

RCC reads secrets from environment variables and stores runtime state below `DATA_DIR`.

| Variable | Required | Description |
| --- | --- | --- |
| `DASHBOARD_PASSWORD` | Yes | Dashboard password; minimum 8 characters locally and 12 in production |
| `SESSION_SECRET` | Yes | Random secret with at least 32 characters |
| `CONFIG_ENCRYPTION_KEY` | Recommended | Dedicated 32+ character key for encrypted configuration and token vaults |
| `DATA_DIR` | Recommended | Persistent private runtime directory; defaults to `./data` |
| `PORT` | No | HTTP port; defaults to `3000` |
| `AUTO_CONNECT` | No | Set to `true` only when unattended startup is intentional |
| `DASHBOARD_TOTP_SECRET` | No | Base32 TOTP secret for dashboard two-factor authentication |

Minecraft servers, accounts, reconnect rules, proxies, macros and webhooks are configured through the dashboard. The `.env.example` file contains placeholders only.

The browser POV terrain renderer uses the Prismarine-compatible Minecraft `1.21.4` render profile. RCC keeps the configured `26.1` and `26.1.2` protocol paths working and maps them to that profile only inside viewer rendering.

## Token persistence

Each account receives a private directory at `DATA_DIR/accounts/<account-id>/auth`. RCC restores Microsoft cache files only while authenticating or connecting and stores them encrypted at rest. Keep the same encryption key to reuse a session.

## Network identity

Without a configured proxy, Minecraft sees the public egress IP of the machine running RCC. A Codespace therefore uses the Codespace egress IP. HTTP CONNECT proxies are optional and selected per account.
