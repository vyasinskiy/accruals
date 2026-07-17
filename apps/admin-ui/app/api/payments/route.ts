import { NextResponse, type NextRequest } from 'next/server';
import { accountantClient } from '../../../lib/accountant-client';

export async function GET() {
  try {
    const { data } = await accountantClient.get('/payments');
    return NextResponse.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, paymentId, comment } = body;

    if (!paymentId) {
      return NextResponse.json({ error: 'Missing paymentId' }, { status: 400 });
    }

    if (action === 'confirm') {
      const { data } = await accountantClient.post('/payments/confirm', {
        paymentId: Number(paymentId),
        confirmedBy: 1, // default admin ID or verified ID
      });
      return NextResponse.json(data);
    } else if (action === 'reject') {
      const { data } = await accountantClient.post('/payments/reject', {
        paymentId: Number(paymentId),
        confirmedBy: 1,
        comment,
      });
      return NextResponse.json(data);
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
