import { NextResponse } from 'next/server';

export async function GET() {
  // TODO: Replace with real DB queries via Prisma client
  const data = {
    totalPayments: 42,
    pendingPayments: 5,
    upcomingEvents: 3,
  };
  return NextResponse.json(data);
}
