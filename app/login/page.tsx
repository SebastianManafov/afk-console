'use client';

import { FormEvent, useState } from 'react';

export default function LoginPage() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const data = new FormData(event.currentTarget);
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: data.get('username'), password: data.get('password') }) });
    const result = await response.json() as { error?: string };
    if (response.ok) window.location.assign('/'); else { setError(result.error ?? 'Anmeldung fehlgeschlagen'); setBusy(false); }
  }
  return <main className="login-shell"><section className="login-card"><div className="brand-mark">H</div><p className="eyebrow">HUSHCRAFT / SECURE ACCESS</p><h1>AFK Console</h1><p className="login-copy">Melde dich an, um deine serverseitige Minecraft-Instanz zu steuern.</p><form onSubmit={submit}><label>Benutzername<input name="username" autoComplete="username" required /></label><label>Passwort<input name="password" type="password" autoComplete="current-password" required minLength={14} /></label>{error && <p className="login-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy}>{busy ? 'Wird geprüft …' : 'Sicher anmelden'}</button></form><small>12-Stunden-Session · HttpOnly · SameSite Strict</small></section></main>;
}
