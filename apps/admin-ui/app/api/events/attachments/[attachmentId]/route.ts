import { NextResponse, type NextRequest } from 'next/server';
import { accountantClient } from '../../../../../lib/accountant-client';

export async function DELETE(
  request: NextRequest,
  { params }: { params: { attachmentId: string } }
) {
  try {
    const { data } = await accountantClient.delete(`/events/attachments/${params.attachmentId}`);
    return NextResponse.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
