import { NextResponse, type NextRequest } from 'next/server';
import { accountantClient } from '../../../lib/accountant-client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const apartmentId = searchParams.get('apartmentId');

    const params: { apartmentId?: string } = {};
    if (apartmentId) {
      params.apartmentId = apartmentId;
    }

    const { data } = await accountantClient.get('/accounts', { params });
    return NextResponse.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
