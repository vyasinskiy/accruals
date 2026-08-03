import { NextResponse, type NextRequest } from 'next/server';
import { accountantClient } from '../../../../lib/accountant-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.ids || !Array.isArray(body.ids)) {
      return NextResponse.json({ error: 'Invalid ids array' }, { status: 400 });
    }
    const { data } = await accountantClient.post('/invoices/bulk-delete', { ids: body.ids });
    return NextResponse.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
