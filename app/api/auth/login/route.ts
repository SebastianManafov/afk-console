import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

const attempts = new Map<string, { count: number; resetAt: number }>();

function equal(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const client = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const current = attempts.get(client);
  if (current && current.resetAt > Date.now() && current.count >= 5) {
    return NextResponse.json({ error: 'Zu viele Versuche. Bitte später erneut versuchen.' }, { status: 429, headers: { 'retry-after': String(Math.ceil((current.resetAt - Date.now()) / 1000)) } });
  }
  const configuredUser = process.env.DASHBOARD_USERNAME ?? '';
  const configuredPassword = process.env.DASHBOARD_PASSWORD ?? '';
  const secret = process.env.SESSION_SECRET ?? '';
  if (!configuredUser || configuredPassword.length < 14 || secret.length < 32) {
    return NextResponse.json({ error: 'Login-Secrets sind nicht sicher konfiguriert' }, { status: 503 });
  }
  const { username, password } = await request.json() as { username?: string; password?: string };
  if (!equal(String(username ?? ''), configuredUser) || !equal(String(password ?? ''), configuredPassword)) {
    const resetAt = current?.resetAt && current.resetAt > Date.now() ? current.resetAt : Date.now() + 15 * 60 * 1000;
    attempts.set(client, { count: (current?.resetAt && current.resetAt > Date.now() ? current.count : 0) + 1, resetAt });
    await new Promise((resolve) => setTimeout(resolve, 350));
    return NextResponse.json({ error: 'Anmeldedaten sind ungültig' }, { status: 401 });
  }
  attempts.delete(client);
  const expires = Date.now() + 12 * 60 * 60 * 1000;
  const payload = `v1.${expires}`;
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  const response = NextResponse.json({ authenticated: true });
  response.cookies.set('hushcraft_session', `${payload}.${signature}`, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 12 * 60 * 60,
  });
  return response;
}
