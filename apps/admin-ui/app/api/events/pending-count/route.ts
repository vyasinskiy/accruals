import { NextResponse } from 'next/server';
import { accountantClient } from '../../../../lib/accountant-client';

export async function GET() {
  try {
    const { data } = await accountantClient.get('/events/pending-count');
    return NextResponse.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
