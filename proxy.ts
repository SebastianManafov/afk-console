import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = new Set(['/login', '/api/auth/login', '/healthz']);

function bytesToBase64Url(bytes: Uint8Array) {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function validSession(value: string | undefined) {
  if (!value) return false;
  const [version, expiresRaw, signature] = value.split('.');
  const expires = Number(expiresRaw);
  const secret = process.env.SESSION_SECRET;
  if (version !== 'v1' || !secret || secret.length < 32 || !Number.isFinite(expires) || expires < Date.now()) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = bytesToBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${version}.${expiresRaw}`))));
  if (expected.length !== signature?.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  return mismatch === 0;
}

function secure(response: NextResponse) {
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('x-frame-options', 'DENY');
  response.headers.set('referrer-policy', 'no-referrer');
  response.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  return response;
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (PUBLIC_PATHS.has(path) || path.startsWith('/_next/') || path === '/favicon.svg' || path === '/og.png') return secure(NextResponse.next());
  if (await validSession(request.cookies.get('hushcraft_session')?.value)) return secure(NextResponse.next());
  if (path.startsWith('/api/')) return secure(NextResponse.json({ error: 'Anmeldung erforderlich' }, { status: 401 }));
  return secure(NextResponse.redirect(new URL('/login', request.url)));
}

export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
