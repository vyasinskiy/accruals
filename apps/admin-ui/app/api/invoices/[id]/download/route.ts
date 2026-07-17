import { NextResponse, type NextRequest } from 'next/server';
import { accountantClient } from '../../../../../lib/accountant-client';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
    }

    const { data } = await accountantClient.get(`/invoices/${id}`);
    if (data && data.downloadUrl) {
      return NextResponse.redirect(data.downloadUrl);
    }

    return NextResponse.json({ error: 'Invoice PDF download URL not found or S3 is disabled' }, { status: 404 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
