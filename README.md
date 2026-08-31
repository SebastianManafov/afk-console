# Remote Console Client (RCC)

Privater Mineflayer-Client mit Web-Dashboard, Live-POV, getrennten Sell- und Spawner-Makros sowie Discord-Webhooks.

Das Dashboard besitzt eine dichte AFK-Console-Navigation mit Servers, Accounts und Proxies sowie Connect, Chat, Movement, Inventory, POV, Server-Proxies, Macros, Webhooks und Settings. Gestaltung, Marke und Implementierung sind eigenständig; fremde Logos und Quelltexte werden nicht übernommen.

Serverprofil, Adresse, Port, Minecraft-Version, Microsoft-Konto und Auto-Connect können direkt in der Settings-Seite geändert werden und bleiben im konfigurierten Datenordner persistent.

## Aktueller Funktionsumfang

- Microsoft OAuth mit Gerätecode, Link und Kopierbutton direkt im Dashboard
- getrennte Aktionen für Speichern, Microsoft-Login, Connect und Reconnect; dadurch entstehen keine unbeabsichtigten mehrfachen Gerätecodes
- individuelle Reconnect-Regeln pro Account mit frei wählbarer Verzögerungsfolge, sichtbarem Countdown und Abbruch
- Join- und World-Change-Befehle pro Serverprofil
- zufällige Anti-AFK-Aktivität mit einstellbarem Mindest- und Höchstintervall
- wiederholte Chatnachrichten oder Befehle mit sicherem Timer
- Schutz vor parallelen Direktverbindungen derselben Serveradresse über unterschiedliche Profile
- Accounts pausieren und später fortsetzen, ohne ihre Microsoft-Anmeldung zu löschen
- Live-Konsole für Chat, Warnungen, Kicks und Verbindungsfehler
- Discord-Ereignisse für Join, Disconnect, Kick, Makro-Erfolg, Makro-Fehler und Arrow-Abbruch
- Sell-Zeitfenster, frei wählbare Pausen und konfigurierbare Befehls-/Klickzeiten
- Spawner-Zeitfenster, automatische GUI-Slot-Erkennung und frei konfigurierbare Fallback-Slots
- vollständige Spawner-Anlaufsequenz: `/home oben`, `/home unten`, W/S/D, Spawner-Rechtsklick, Makro, `/home afk`
- optionaler Bone-Order-Ablauf nach erfolgreichem Spawner-Lauf: `/home oben`, `/order bone`, höchste Order erkennen, alle Bones mit zufälligen einstellbaren Pausen liefern, `/home afk`
- sichtbarer Arrow-Guard, Makro-Durchläufe, Erfolge und aktuelle Laufzeit
- Statusleiste für Ping, RAM, Prozesslaufzeit und Railway-Bereitschaft
- Live-Positionsansicht, Inventar/Hotbar, Light/Dark Mode und mobile Navigation
- JSON-Backup/Import sowie Not-Aus für Verbindung und beide Makros
- AES-256-GCM-Verschlüsselung der Discord-Webhook-URL und aller Dateien im Microsoft-Token-Verzeichnis
- parallele Mineflayer-Instanzen für mehrere aktivierte Accounts mit getrennten OAuth-Verzeichnissen
- mehrere Serverprofile und HTTP-CONNECT-Proxies mit Account-Zuordnung und Latenztest
- globale oder pro Account getrennte Sell-/Spawner-Konfigurationen
- optionaler TOTP-Zweifaktor-Login über `DASHBOARD_TOTP_SECRET`
- Erkennung typischer Wartungs- und Serverneustart-Kickmeldungen
- lesbarer letzter Kick-/Verbindungsfehler direkt am betroffenen Account
- klickfreie Makro-Vorschau sowie Übernahme der Makro-Konfiguration auf mehrere ausgewählte Accounts
- Bearbeiten und Löschen gespeicherter Server- und Proxyprofile
- sichtbare Warnung, wenn ein erkennbares OAuth-Ablaufdatum weniger als 15 Minuten entfernt ist

Die Connect-Seite kann mehrere Accounts auswählen und gleichzeitig starten, stoppen oder neu verbinden. Jeder Account erhält einen getrennten Token-Ordner und kann einem eigenen Server sowie HTTP-CONNECT-Proxy zugewiesen werden. SOCKS5 ist noch nicht integriert.

Eine leere Auswahl führt niemals mehr eine Aktion für alle Accounts aus. Der Not-Aus deaktiviert neben den globalen Makros auch alle individuellen Account-Makros. Konfigurationsänderungen werden transaktional validiert: Ein ungültiges Server-, E-Mail- oder Reconnect-Profil verändert weder die laufende noch die gespeicherte Konfiguration.

## Stand der Makroanalyse

Die bereitgestellte Mod-JAR `hugosmp-macro-0.2.3+mc1.21.11.jar` wurde nur zur Verhaltensanalyse verwendet. Die Implementierung in diesem Projekt ist eigenständig.

Festgestellte Spawner-Struktur:

- 6-reihiges Container-GUI
- Inhalt: Slots `0–44`
- `Sell All`: Slot `45`
- Seite links/rechts: Slots `48` und `50`
- `Drop All`: Slot `53`
- Synchronisationswartezeit der Referenz: bis zu 3 Sekunden
- maximal 30 Seiten
- Mod-Standardwerte: Sell `150/400 ms`, Shift-Click aktiv; Spawner `250 ms`, Modus `ALWAYS`, Drop-Item `minecraft:bone`

Das Screenshotbild bestätigt das 6-reihige GUI mit Titel `SPAWNER`, Knochen im Inhaltsbereich und dem Drop-All-Element unten rechts. Der echte Mineflayer-Lauf schreibt Titel, Slotnummern und Item-IDs der Steuerungselemente ins Log. Damit können Namen/Lore später verifiziert werden, ohne sie aus Pixeln zu raten.

Mit aktivem Skeleton-Filter entspricht der rekonstruierte Ablauf dem beobachteten Mod-Verhalten: reine Bone-Seiten verwenden Drop All, gemischte Seiten entfernen das konfigurierte Drop-Item einzeln, Restinhalte werden über Sell All verarbeitet und anschließend wird über Slot 48 zurückgeblättert. Der Arrow Guard läuft als zusätzliche Sicherheitsprüfung davor.

### Arrow Guard

Vor `Drop All` prüft der Client alle erreichbaren vollen Seiten in einem zerstörungsfreien Preflight. Sobald `arrow` beziehungsweise `minecraft:arrow` in Slot `0–44` gefunden wird:

1. kein Drop-All-Klick,
2. Makrostatus `ARROW_FILTER_ABORT`,
3. Spawner-GUI wird geschlossen,
4. Bot und Sell-Makro bleiben online,
5. optionaler Discord-Webhook wird gesendet.

## Lokal starten

Node.js 22 oder neuer wird benötigt.

```bash
cp .env.example .env
npm install
npm run build
npm start
```

Die Werte aus `.env` müssen als echte Umgebungsvariablen geladen werden. Besonders wichtig:

- `MC_USERNAME`: Microsoft-Konto des Minecraft-Accounts
- `DASHBOARD_PASSWORD`: lokal mindestens 8 Zeichen, in Produktion mindestens 12 Zeichen
- `SESSION_SECRET`: mindestens 32 zufällige Zeichen
- `CONFIG_ENCRYPTION_KEY`: optionaler separater Schlüssel für die Webhook-Verschlüsselung; andernfalls wird `SESSION_SECRET` verwendet
- `AUTO_CONNECT=true`: optionaler automatischer Start

Microsoft-Tokens speichert Mineflayer je Account unter `DATA_DIR/accounts/<account-id>/auth`. Der Client stellt die Dateien nur für den laufenden Login beziehungsweise die aktive Verbindung wieder her und verschlüsselt sie anschließend als `.vault`-Dateien mit AES-256-GCM. Dieser Ordner darf trotzdem niemals in Git committed werden. Ein Wechsel von `CONFIG_ENCRYPTION_KEY` oder `SESSION_SECRET` macht vorhandene Vault-Dateien ohne den alten Schlüssel unlesbar.
Die Discord-Webhook-URL wird mit AES-256-GCM im Volume verschlüsselt und in der Dashboard-API nur als `configured` ausgegeben.

## GitHub Codespaces verwenden

1. Im GitHub-Repository **Code → Codespaces → Create codespace on main** auswählen.
2. Im Codespaces-Terminal einmalig installieren und bauen:

```bash
npm install
npm run build
```

3. Für jeden neuen Codespace sichere Laufzeitvariablen setzen. Das Dashboard-Passwort muss mindestens acht Zeichen lang sein:

```bash
export DASHBOARD_PASSWORD='DEIN-SICHERES-PASSWORT'
export SESSION_SECRET="$(openssl rand -hex 32)"
export CONFIG_ENCRYPTION_KEY="$(openssl rand -hex 32)"
export DATA_DIR="$PWD/data"
export AUTO_CONNECT=false
npm start
```

4. Wenn im Terminal `Dashboard läuft auf Port 3000` erscheint, im Codespaces-Dialog **Open in Browser** anklicken. Falls kein Dialog erscheint: unten **Ports** öffnen, Port `3000` suchen und auf die URL klicken. Die Port-Sichtbarkeit auf **Private** lassen.
5. Mit `DASHBOARD_PASSWORD` anmelden. Unter **Servers** die Minecraft-Adresse und Version speichern, unter **Accounts** das Microsoft-Konto anlegen und anschließend auf **Microsoft-Login** klicken.
6. Den angezeigten Gerätecode ausschließlich auf `https://www.microsoft.com/link` eingeben. Danach im Dashboard das Konto auswählen und **Connect** drücken. RCC speichert die Sitzung verschlüsselt unter `DATA_DIR`; solange derselbe Codespace und dieselben Schlüssel verwendet werden, ist keine erneute Anmeldung nötig.

Codespaces wird bei Inaktivität gestoppt und eignet sich deshalb zum Testen, nicht als garantierter 24/7-Host. Die Minecraft-Verbindung verwendet die öffentliche Ausgangs-IP des laufenden Codespace, niemals die IP des ausgeschalteten Macs.

## Live-POV und Steuerung

Nach einem erfolgreichen Serverbeitritt im Dashboard **POV** öffnen. `Live verbunden` bestätigt, dass Welt- und Entitätsdaten ankommen.

- **Bot POV**: echte Sicht des Bots; klicken, dann mit Maus umsehen und mit `W`, `A`, `S`, `D` laufen
- `Leertaste`: springen, linke Umschalttaste: schleichen, linke Strg-Taste: sprinten
- Linksklick: Block abbauen oder Entity angreifen; Rechtsklick: benutzen
- Mausrad oder `1`–`9`: Hotbar auswählen; `Esc`: Maus freigeben
- **Freecam** oder `F`: unabhängige Kamera; `WASD`, Maus, Leertaste/Umschalt bewegen die Kamera, nicht den Bot
- `Tab`: Spielerliste einblenden; `M`: Minimap ein-/ausblenden

Wenn Spieler sichtbar sind, aber Blöcke fehlen, zuerst die im Serverprofil eingetragene Minecraft-Version prüfen. RCC enthält die Viewer-Daten für `26.1.2`; eine abweichende Server-/Protokollversion kann das Welt-Rendering verhindern.

## Vor dem echten automatischen Betrieb noch zu verifizieren

- exakter Titel und Item-ID/Lore von Slot 53
- ob `/home oben` und `/home unten` auf HugoSMP zuverlässig teleportieren und die W/S/D-Sequenz den Spawner in Reichweite bringt
- Verhalten des Page-Right-Buttons auf der letzten Seite
- echte Erfolgsanzeige beziehungsweise Chatmeldung nach `Drop All`
- `/sell`-GUI-Titel und Bestätigung in Slot 35

Bis diese Punkte im echten Protokolllog bestätigt sind, sollten manuelle Testläufe mit einem leeren oder unwichtigen Inventar erfolgen. Prüfe außerdem die HugoSMP-Regeln zu automatisierten Clients.

Die Bone-Order-Funktion ist aus Sicherheitsgründen standardmäßig ausgeschaltet. Der Listenaufbau ist durch den Screenshot bekannt; das Detail-GUI nach Auswahl einer Order muss noch per Live-Log bestätigt werden. Deshalb werden erkannte Preis-/Order-Texte bevorzugt und andernfalls die konfigurierten Fallback-Slots verwendet. Vor dem ersten produktiven Lauf sollte die klickfreie Vorschau geprüft und anschließend ein beaufsichtigter Test mit wenigen Bones durchgeführt werden.

Der bereitgestellte `ORDERS`-Screenshot zeigt vier Inhaltsreihen (`0–35`) und die Steuerleiste `36–44`; die Seitennavigation liegt bei `39/41`. Die automatische Suche ignoriert die weißen Platzhalter, berücksichtigt ausschließlich Bone-Items, durchsucht bis zu 30 Seiten und vergleicht Preisangaben aus Name/Lore/NBT. Wenn das Server-GUI keine lesbare Preisangabe übermittelt, wird der erste erkannte Bone-Eintrag verwendet; Slot `2` bleibt der manuell einstellbare letzte Fallback. Nach der Auswahl wartet der Client zwingend auf das Fenster `ORDER BELIEFERN`; dort ist laut Screenshot das orange Symbol in Slot `6` die Aktion für das gesamte Inventar. Erst danach wird Slot `6` betätigt.
