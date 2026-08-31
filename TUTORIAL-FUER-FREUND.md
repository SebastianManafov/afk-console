# Remote Console Client (RCC) – Kurzanleitung

## Voraussetzungen

- Node.js 20 oder neuer
- Eine eigene Microsoft-/Minecraft-Anmeldung

## Lokal starten

1. ZIP entpacken und im Ordner ein Terminal öffnen.
2. Abhängigkeiten installieren: `npm install`.
3. `.env.example` nach `.env` kopieren.
4. In `.env` ein eigenes Dashboard-Passwort sowie zufällige Werte für `SESSION_SECRET` und `CONFIG_ENCRYPTION_KEY` setzen.
5. `AUTO_CONNECT=false` belassen.
6. Projekt bauen: `npm run build`.
7. Dashboard starten: `npm start`.
8. Im Browser `http://127.0.0.1:3000` öffnen.

## Anmeldung und Nutzung

Im Dashboard anmelden, unter **Accounts** die eigene Microsoft-Adresse eintragen und den angezeigten Microsoft-Code im Browser bestätigen. Danach kann der Bot unter **Connect** manuell verbunden werden. Makros bleiben standardmäßig deaktiviert.

## Sicherheit

`.env`, `data/`, Auth-Dateien und Logs niemals weitergeben oder in Git hochladen. Das Dashboard-Passwort nur lokal verwenden.
