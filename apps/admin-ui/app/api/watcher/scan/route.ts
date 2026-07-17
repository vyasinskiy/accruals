import { NextResponse, type NextRequest } from 'next/server';
import { watcherClient } from '../../../../lib/watcher-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { data } = await watcherClient.post('/scraping/scan', body);
    return NextResponse.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
