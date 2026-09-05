# Configuration

RCC reads secrets from environment variables and stores runtime state below `DATA_DIR`.

| Variable | Required | Description |
| --- | --- | --- |
| `DASHBOARD_PASSWORD` | Yes | Dashboard password; minimum 8 characters locally and 12 in production |
| `GUEST_PASSWORD` | No | Optional authenticated read-only dashboard password; it cannot change settings, bots, chat, macros, accounts or webhooks |
| `SESSION_SECRET` | Yes | Random secret with at least 32 characters |
| `CONFIG_ENCRYPTION_KEY` | Recommended | Dedicated 32+ character key for encrypted configuration and token vaults |
| `DATA_DIR` | Recommended | Persistent private runtime directory; defaults to `./data` |
| `PORT` | No | HTTP port; defaults to `3000` |
| `AUTO_CONNECT` | No | Set to `true` only when unattended startup is intentional |
| `DASHBOARD_TOTP_SECRET` | No | Base32 TOTP secret for dashboard two-factor authentication |

Minecraft servers, accounts, reconnect rules, proxies, macros and webhooks are configured through the dashboard. The `.env.example` file contains placeholders only.

The browser POV terrain renderer uses the Prismarine-compatible Minecraft `1.21.4` render profile. RCC keeps the configured `26.1` and `26.1.2` protocol paths working and maps them to that profile only inside viewer rendering.

Guests can inspect dashboard state, diagnostics, previews, inventory and POV terrain, but all state-changing controls are admin-only. Browser bot control is available only to an admin who maximizes one POV card, clicks its canvas to acquire iframe-owned pointer lock, and keeps that view active. Minimizing, switching, hiding the tab, losing focus, disconnecting, or entering a world transition releases movement and interaction controls. When Bot POV opens a real server container, pointer lock is released for the GUI; only the same active admin lease can click its server-provided slots, and Escape or `E` closes the server window through Mineflayer. Freecam never sends block, entity, item or GUI actions.

## Token persistence

Each account receives a private directory at `DATA_DIR/accounts/<account-id>/auth`. RCC restores Microsoft cache files only while authenticating or connecting and stores them encrypted at rest. Keep the same encryption key to reuse a session.

The Accounts editor can replace an access token without revealing the stored
value. Select one of the explicit token types: Microsoft OAuth, which continues
through the Prismarine authentication flow, or Minecraft Java, which is
validated against Minecraft Services and used as a direct Minecraft session.
Microsoft tokens remain in the encrypted OAuth cache; Minecraft Java tokens use
a separate encrypted per-account record and are never restored into the
Microsoft Authflow cache.

The dashboard receives only derived status metadata (`type`, `valid`, `expired`,
`invalid`, or `not_set`) and an optional expiry timestamp. Leaving the field
empty preserves the current token; **Remove token** deletes the account's
authentication cache. Both token inputs are password fields, and RCC never
returns, renders, logs, or copies the stored token.

The recommended path for Microsoft OAuth is the built-in device-code login.

## Network identity

Without a configured proxy, Minecraft sees the public egress IP of the machine running RCC. A Codespace therefore uses the Codespace egress IP. HTTP CONNECT proxies are optional and selected per account.
