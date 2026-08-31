# Remote Console Client (RCC)

Private-login web console plus a persistent Minecraft Java worker, prepared as two Railway services. Both run server-side when the user's computer is off. The worker has no public domain and is called by the web service over Railway private networking.

The dashboard is also compatible with a private Codex Sites deployment. On Sites, the platform-provided OpenAI identity header grants access and the custom Railway login is bypassed. Sites cannot host the persistent raw-TCP Minecraft worker; set `WORKER_URL` and `WORKER_API_TOKEN` as Sites secrets pointing to the external worker.

## Security invariants

- Minecraft and Microsoft cache values are worker environment variables only.
- The browser never receives proxy credentials, the worker API token, or Microsoft tokens.
- RCC uses the Railway worker's egress IP exclusively. Local-machine connections are rejected.
- The public website is protected by a signed, 12-hour `HttpOnly`, `Secure`, `SameSite=Strict` session.
- The worker API requires a 32+ character bearer token. Only `/healthz` is unauthenticated.

For defense in depth, restrict the worker's egress at the infrastructure/proxy layer to the SOCKS5 proxy. Respect the Minecraft server's bot, AFK, proxy and VPN rules.

## Railway layout

Create two services from the same GitHub repository:

1. `afk-web`: root directory `/`, config file `/railway.toml`, public domain enabled.
2. `afk-worker`: root directory `/worker`, config file `/worker/railway.toml`, no public domain.

Attach a Railway Volume to `afk-worker` at `/home/node/.minecraft` so Microsoft device-auth refresh tokens survive redeployments. On first connection, read the device code from the dashboard logs or worker deployment logs and complete it at the displayed Microsoft URL.

## Web variables

```text
DASHBOARD_USERNAME=<private login name>
DASHBOARD_PASSWORD=<strong unique password, at least 14 characters>
SESSION_SECRET=<random value, at least 32 characters>
WORKER_API_TOKEN=<same random value as worker API_TOKEN>
WORKER_URL=http://${{afk-worker.RAILWAY_PRIVATE_DOMAIN}}:${{afk-worker.PORT}}
SITE_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
```

## Worker variables

```text
API_TOKEN=<same random value as web WORKER_API_TOKEN, at least 32 characters>
MINECRAFT_HOST=play.example.net
MINECRAFT_PORT=25565
MINECRAFT_USERNAME=<stable account/cache identifier, normally Microsoft email>
AUTH_CACHE_DIR=/home/node/.minecraft
```

Railway supplies `PORT`; neither service needs a manual `PORT` variable. Both services bind it on `0.0.0.0`.

RCC connects directly through Railway's server network. The dashboard device is never used as a Minecraft connection path.

## Local checks

- Website: `npm install && npm run build && npm start`
- Worker: `cd worker && npm install && API_TOKEN='<32+ chars>' npm start`
- Health: website `/healthz`, worker `/healthz`
