import { NextResponse, type NextRequest } from 'next/server';
import { accountantClient } from '../../../lib/accountant-client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get('accountId');

    const params: { accountId?: string } = {};
    if (accountId) {
      params.accountId = accountId;
    }

    const { data } = await accountantClient.get('/invoices', { params });
    return NextResponse.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
