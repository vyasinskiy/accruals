import { NextResponse } from 'next/server';
import { watcherClient } from '../../../../lib/watcher-client';

export async function GET() {
  try {
    const { data } = await watcherClient.get('/scraping/runs');
    return NextResponse.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
