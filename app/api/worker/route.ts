import { NextRequest, NextResponse } from 'next/server';

const allowedActions = new Set(['status', 'connect', 'disconnect', 'chat']);

async function relay(request: NextRequest, action: string) {
  const workerUrl = process.env.WORKER_URL?.replace(/\/$/, '');
  const token = process.env.WORKER_API_TOKEN;
  if (!workerUrl || !token) {
    return NextResponse.json({ error: 'Worker ist noch nicht konfiguriert', configured: false }, { status: 503 });
  }
  if (!allowedActions.has(action)) return NextResponse.json({ error: 'Ungültige Aktion' }, { status: 400 });
  const upstream = await fetch(`${workerUrl}/v1/${action}`, {
    method: request.method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: request.method === 'POST' ? await request.text() : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  return new NextResponse(upstream.body, { status: upstream.status, headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' } });
}

export async function GET(request: NextRequest) { return relay(request, 'status'); }
export async function POST(request: NextRequest) {
  const action = request.nextUrl.searchParams.get('action') ?? '';
  return relay(request, action);
}
