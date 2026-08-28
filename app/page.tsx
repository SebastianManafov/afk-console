'use client';

import { FormEvent, useEffect, useState } from 'react';

type LogEntry = { time: string; tone?: 'ok' | 'warn'; text: string };
const initialLogs: LogEntry[] = [
  { time: '21:03:18', tone: 'ok', text: 'Proxy-Guard aktiv · Direktverbindungen blockiert' },
  { time: '21:03:19', text: 'Worker wartet auf eine sichere Konfiguration' },
];

export default function Home() {
  const [connected, setConnected] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>(initialLogs);
  const [command, setCommand] = useState('');
  const now = () => new Date().toLocaleTimeString('de-DE', { hour12: false });

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const response = await fetch('/api/worker', { cache: 'no-store' });
        if (!response.ok) return;
        const result = await response.json() as { status?: string; logs?: Array<{ time: string; text: string; tone?: 'ok' | 'warn' }> };
        if (!active) return;
        setConnected(result.status === 'online' || result.status === 'connecting');
        if (result.logs?.length) setLogs(result.logs.map((entry) => ({ ...entry, time: new Date(entry.time).toLocaleTimeString('de-DE', { hour12: false }) })));
      } catch { /* A temporary private-network failure is shown by the next explicit action. */ }
    }
    void refresh();
    const timer = window.setInterval(refresh, 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  async function toggleConnection() {
    const next = !connected;
    try {
      const response = await fetch(`/api/worker?action=${next ? 'connect' : 'disconnect'}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Worker nicht erreichbar');
      setConnected(next);
      setLogs((items) => [...items, { time: now(), tone: next ? 'ok' : undefined, text: next ? 'Sichere Railway-Verbindung angefordert' : 'Verbindung getrennt' }]);
    } catch (error) {
      setLogs((items) => [...items, { time: now(), tone: 'warn', text: error instanceof Error ? error.message : 'Worker nicht erreichbar' }]);
    }
  }

  async function sendCommand(event: FormEvent) {
    event.preventDefault();
    if (!connected || !command.trim()) return;
    const message = command.trim();
    try {
      const response = await fetch('/api/worker?action=chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Senden fehlgeschlagen');
      setLogs((items) => [...items, { time: now(), text: `> ${message}` }]);
      setCommand('');
    } catch (error) {
      setLogs((items) => [...items, { time: now(), tone: 'warn', text: error instanceof Error ? error.message : 'Senden fehlgeschlagen' }]);
    }
  }

  return (
    <main className="shell">
      <aside className="rail">
        <div className="brand-mark" aria-label="HushCraft">H</div>
        <nav aria-label="Hauptnavigation">
          <button className="rail-button active" aria-label="Konsole">⌘</button>
          <button className="rail-button" aria-label="Instanzen">▦</button>
          <button className="rail-button" aria-label="Sicherheit">◇</button>
        </nav>
        <div className="avatar" aria-label="Sicher angemeldet">✓</div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">AFK CONSOLE / JAVA</p><h1>Deine Welt bleibt online.</h1></div>
          <div className="top-actions"><div className="login-pill">✓ Sicher angemeldet</div><div className="safety-pill"><span /> PROXY-ONLY</div></div>
        </header>

        <div className="status-strip">
          <div className={`pulse ${connected ? 'live' : ''}`} />
          <div><strong>{connected ? 'Online' : 'Bereit zum Start'}</strong><small>{connected ? 'Serverseitige Instanz läuft' : 'Worker läuft unabhängig von deinem Laptop'}</small></div>
          <div className="status-metric"><small>Eigene IP</small><strong>Niemals genutzt</strong></div>
          <button className={connected ? 'danger-button' : 'primary-button'} onClick={toggleConnection}>{connected ? 'Verbindung trennen' : 'Sicher verbinden'}</button>
        </div>

        <div className="content-grid">
          <section className="console-card">
            <div className="card-head"><div><p className="eyebrow">LIVE SESSION</p><h2>Konsole</h2></div><span className="latency">{connected ? '42 ms' : '— ms'}</span></div>
            <div className="terminal" role="log" aria-live="polite">
              {logs.map((entry, index) => <p key={`${entry.time}-${index}`} className={entry.tone}><time>{entry.time}</time><span>{entry.text}</span></p>)}
              {!connected && <div className="terminal-empty"><span>⌁</span><strong>Noch offline</strong><small>Vervollständige rechts die Proxy-Konfiguration.</small></div>}
            </div>
            <form className="commandbar" onSubmit={sendCommand}>
              <span>›</span><input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Chat oder /command" disabled={!connected} aria-label="Chat oder Befehl" /><button disabled={!connected || !command.trim()}>Senden</button>
            </form>
          </section>

          <aside className="config-card">
            <div className="card-head"><div><p className="eyebrow">VERBINDUNG</p><h2>Instanz</h2></div><span className="lock">●</span></div>
            <label>Server-Adresse<input value="Railway Secret" disabled /></label>
            <div className="split"><label>Port<input value="Railway Secret" disabled /></label><label>Edition<select aria-label="Edition" defaultValue="java" disabled><option value="java">Java</option></select></label></div>
            <label>Minecraft-Konto<input value="Railway Secret" disabled /></label>
            <div className="proxy-box">
              <div className="proxy-title"><span className="shield">◆</span><div><strong>Proxy-Zwang aktiv</strong><small>Kein automatischer Direkt-Fallback</small></div></div>
              <label>SOCKS5 Proxy<input value="In Railway verschlüsselt" disabled /></label>
              <div className="guard-row"><span>Kill-Switch</span><strong>AN</strong></div>
            </div>
            <p className="privacy-note">Alle Konto-, Server- und Proxy-Daten liegen ausschließlich als Railway-Secrets auf dem Worker. Den Microsoft-Login bestätigst du einmalig per offiziellem Gerätecode.</p>
          </aside>
        </div>
        <footer><span>HUSHCRAFT</span><p>Mineflayer worker · SOCKS5 egress · serverseitig</p><span>v0.1</span></footer>
      </section>
    </main>
  );
}
