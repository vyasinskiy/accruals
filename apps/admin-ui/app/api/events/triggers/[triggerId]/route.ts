import { NextResponse, type NextRequest } from 'next/server';
import { accountantClient } from '../../../../../lib/accountant-client';

export async function PUT(
  request: NextRequest,
  { params }: { params: { triggerId: string } }
) {
  try {
    const body = await request.json();
    const { data } = await accountantClient.put(`/events/triggers/${params.triggerId}`, body);
    return NextResponse.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
