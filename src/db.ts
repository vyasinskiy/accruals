import { PrismaClient } from '@prisma/client';
import type { ReceiptSnapshot, RunStatus, ScanSummary } from './types';

const prismaClientSingleton = globalThis as typeof globalThis & { prisma?: PrismaClient };

export const prisma = prismaClientSingleton.prisma ?? new PrismaClient();
if (!prismaClientSingleton.prisma) {
  prismaClientSingleton.prisma = prisma;
}

export class AppDb {
  async insertRunStart(startedAt: string): Promise<number> {
    const run = await prisma.run.create({
      data: {
        startedAt: new Date(startedAt),
        status: 'warning',
        message: 'Run started',
        summaryJson: '{}'
      }
    });

    return run.id;
  }

  async upsertReceipt(receipt: ReceiptSnapshot, runId: number): Promise<boolean> {
    const existing = await prisma.receipt.findUnique({
      where: { fingerprint: receipt.fingerprint },
      select: { id: true }
    });

    const data = {
      accountExternalId: receipt.accountExternalId,
      monthLabel: receipt.monthLabel,
      amountText: receipt.amountText,
      statusText: receipt.statusText ?? null,
      receiptAvailable: receipt.receiptAvailable,
      receiptUrl: receipt.receiptUrl ?? null,
      receiptDownloaded: receipt.receiptDownloaded,
      lastSeenAt: new Date(receipt.observedAt),
      rawJson: receipt.rawJson ?? null
    };

    const record = existing
      ? await prisma.receipt.update({
          where: { fingerprint: receipt.fingerprint },
          data
        })
      : await prisma.receipt.create({
          data: {
            ...data,
            fingerprint: receipt.fingerprint,
            firstSeenAt: new Date(receipt.observedAt)
          }
        });

    await prisma.receiptObservation.create({
      data: {
        receiptId: record.id,
        receiptFingerprint: receipt.fingerprint,
        observedAt: new Date(receipt.observedAt),
        runId,
        rawJson: receipt.rawJson ?? null
      }
    });

    return !existing;
  }

  async finalizeRun(runId: number, summary: ScanSummary): Promise<void> {
    await prisma.run.update({
      where: { id: runId },
      data: {
        finishedAt: new Date(summary.finishedAt),
        status: summary.status,
        message: summary.message,
        accountsScanned: summary.accountsScanned,
        receiptsObserved: summary.receiptsObserved,
        newReceipts: summary.newReceipts.length,
        needsLogin: summary.needsLogin,
        summaryJson: JSON.stringify(summary)
      }
    });
  }

  async getPendingNewReceiptsSinceLastRun(): Promise<ReceiptSnapshot[]> {
    const lastRunWithNewReceipts = await prisma.run.findFirst({
      where: { newReceipts: { gt: 0 }, finishedAt: { not: null } },
      orderBy: { id: 'desc' },
      select: { finishedAt: true }
    });

    if (!lastRunWithNewReceipts?.finishedAt) {
      return [];
    }

    const rows = await prisma.receipt.findMany({
      where: { firstSeenAt: lastRunWithNewReceipts.finishedAt },
      orderBy: { firstSeenAt: 'desc' }
    });

    return rows.map(mapReceiptRow);
  }

  async getLastRunStatus(): Promise<{ status: RunStatus; message: string; needsLogin: boolean } | null> {
    const row = await prisma.run.findFirst({
      orderBy: { id: 'desc' },
      select: { status: true, message: true, needsLogin: true }
    });

    if (!row) return null;
    return { status: row.status as RunStatus, message: row.message, needsLogin: row.needsLogin };
  }

  async close(): Promise<void> {
    await prisma.$disconnect();
  }
}

function mapReceiptRow(row: {
  accountExternalId: string;
  monthLabel: string;
  amountText: string;
  statusText: string | null;
  receiptAvailable: boolean;
  receiptUrl: string | null;
  receiptDownloaded: boolean;
  fingerprint: string;
  lastSeenAt: Date;
  rawJson: string | null;
}): ReceiptSnapshot {
  return {
    accountExternalId: row.accountExternalId,
    monthLabel: row.monthLabel,
    amountText: row.amountText,
    statusText: row.statusText ?? undefined,
    receiptAvailable: row.receiptAvailable,
    receiptUrl: row.receiptUrl ?? undefined,
    receiptDownloaded: row.receiptDownloaded,
    fingerprint: row.fingerprint,
    observedAt: row.lastSeenAt.toISOString(),
    rawJson: row.rawJson ?? undefined
  };
}
