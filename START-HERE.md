# Remote Console Client (RCC) – Weitergabe

Dieses Paket enthält ausschließlich den Quellcode. Es enthält keine Minecraft-Konten, OAuth-Tokens, Webhook-URLs, Proxy-Passwörter, Dashboard-Passwörter, Logs oder gespeicherte Laufzeitkonfiguration.

## Mit Codex einrichten

1. ZIP in einen neuen Ordner entpacken.
2. Den Ordner als neues Projekt in Codex öffnen.
3. Codex mitteilen: „Installiere die Abhängigkeiten, erstelle sichere Umgebungsvariablen und deploye dieses Node.js-Projekt auf Railway. Verwende zunächst `AUTO_CONNECT=false`.“
4. Auf Railway ein Volume mit dem Mount-Pfad `/data` anlegen.
5. Nach dem Deployment die von Railway erzeugte Domain öffnen.

## Benötigte Umgebungsvariablen

```text
DASHBOARD_PASSWORD=<eigenes Passwort mit mindestens 12 Zeichen>
SESSION_SECRET=<eigener zufälliger Schlüssel mit mindestens 32 Zeichen>
CONFIG_ENCRYPTION_KEY=<eigener zufälliger Schlüssel mit mindestens 32 Zeichen>
DATA_DIR=/data
AUTO_CONNECT=false
```

`GUEST_PASSWORD` und `DASHBOARD_TOTP_SECRET` sind optional. Eine feste Website-URL ist nicht im Projekt hinterlegt; der jeweilige Host erzeugt sie beim Deployment.

## Lokal

```bash
cp .env.example .env
npm install
npm run build
npm start
```

Vor dem ersten echten Minecraft-Connect müssen Serverprofil und Microsoft-Konto im Dashboard vom neuen Betreiber eingerichtet werden.
