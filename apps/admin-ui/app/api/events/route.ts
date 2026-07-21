import { NextResponse, type NextRequest } from 'next/server';
import { accountantClient } from '../../../lib/accountant-client';

export async function GET() {
  try {
    const { data } = await accountantClient.get('/events');
    return NextResponse.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { data } = await accountantClient.post('/events', body);
    return NextResponse.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
