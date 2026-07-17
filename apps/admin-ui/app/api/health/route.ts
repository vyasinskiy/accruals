// app/api/health/route.ts
import type { NextRequest } from 'next/server';

export async function GET(_req: NextRequest) {
  return new Response(JSON.stringify({ status: 'ok' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
