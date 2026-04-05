import fs from 'node:fs';
import { KvartplataAdapter } from './adapter';
import { AppDb } from './db';
import { buildNeedsLoginMessage, buildNewReceiptsMessage, sendTelegramMessage } from './telegram';
import type { ScanSummary } from './types';

export async function bootstrapSession(): Promise<void> {
  const adapter = new KvartplataAdapter();
  await adapter.bootstrap();
}

export async function runScan(notify = false): Promise<ScanSummary> {
  const startedAt = new Date().toISOString();
  const db = new AppDb();
  const runId = await db.insertRunStart(startedAt);
  const adapter = new KvartplataAdapter();

  try {
    if (!fs.existsSync(requireStorageStatePath())) {
      const summary: ScanSummary = {
        startedAt,
        finishedAt: new Date().toISOString(),
        status: 'needs_login',
        message: 'No saved Playwright storage state found. Run bootstrap first.',
        accountsScanned: 0,
        receiptsObserved: 0,
        newReceipts: [],
        knownReceipts: 0,
        needsLogin: true
      };
      await db.finalizeRun(runId, summary);
      if (notify) await sendTelegramMessage(buildNeedsLoginMessage(summary));
      return summary;
    }

    const scan = await adapter.scan();
    const newReceipts: ScanSummary['newReceipts'] = [];

    for (const receipt of scan.receipts) {
      if (await db.upsertReceipt(receipt, runId)) {
        newReceipts.push(receipt);
      }
    }

    const summary: ScanSummary = {
      startedAt,
      finishedAt: new Date().toISOString(),
      status: scan.needsLogin ? 'needs_login' : newReceipts.length > 0 ? 'success' : 'warning',
      message: scan.needsLogin
        ? scan.message
        : newReceipts.length > 0
          ? `Found ${newReceipts.length} new receipt(s).`
          : scan.message,
      accountsScanned: scan.accounts.length,
      receiptsObserved: scan.receipts.length,
      newReceipts,
      knownReceipts: scan.receipts.length - newReceipts.length,
      needsLogin: scan.needsLogin
    };

    await db.finalizeRun(runId, summary);

    if (notify) {
      if (summary.needsLogin) {
        await sendTelegramMessage(buildNeedsLoginMessage(summary));
      } else if (summary.newReceipts.length > 0) {
        await sendTelegramMessage(buildNewReceiptsMessage(summary));
      }
    }

    return summary;
  } catch (error) {
    const summary: ScanSummary = {
      startedAt,
      finishedAt: new Date().toISOString(),
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
      accountsScanned: 0,
      receiptsObserved: 0,
      newReceipts: [],
      knownReceipts: 0,
      needsLogin: false
    };
    await db.finalizeRun(runId, summary);
    throw error;
  } finally {
    await db.close();
  }
}

function requireStorageStatePath(): string {
  const { config } = require('./config') as typeof import('./config');
  return config.storageStatePath;
}
