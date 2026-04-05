import Database from 'better-sqlite3';
import { config } from './config';
import type { ReceiptSnapshot, RunStatus, ScanSummary } from './types';

export class AppDb {
  private readonly db: Database.Database;

  constructor() {
    this.db = new Database(config.databasePath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        message TEXT NOT NULL,
        accounts_scanned INTEGER NOT NULL DEFAULT 0,
        receipts_observed INTEGER NOT NULL DEFAULT 0,
        new_receipts INTEGER NOT NULL DEFAULT 0,
        needs_login INTEGER NOT NULL DEFAULT 0,
        summary_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS receipts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_external_id TEXT NOT NULL,
        month_label TEXT NOT NULL,
        amount_text TEXT NOT NULL,
        status_text TEXT,
        receipt_available INTEGER NOT NULL DEFAULT 0,
        receipt_url TEXT,
        receipt_downloaded INTEGER NOT NULL DEFAULT 0,
        fingerprint TEXT NOT NULL UNIQUE,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        raw_json TEXT
      );

      CREATE TABLE IF NOT EXISTS receipt_observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        receipt_fingerprint TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        run_id INTEGER,
        raw_json TEXT,
        FOREIGN KEY (run_id) REFERENCES runs(id)
      );

      CREATE INDEX IF NOT EXISTS idx_receipts_account_month ON receipts(account_external_id, month_label);
      CREATE INDEX IF NOT EXISTS idx_receipt_observations_fingerprint ON receipt_observations(receipt_fingerprint);
    `);
  }

  insertRunStart(startedAt: string): number {
    const stmt = this.db.prepare(`
      INSERT INTO runs (started_at, status, message, summary_json)
      VALUES (?, 'warning', 'Run started', '{}')
    `);
    const result = stmt.run(startedAt);
    return Number(result.lastInsertRowid);
  }

  upsertReceipt(receipt: ReceiptSnapshot, runId: number): boolean {
    const existing = this.db.prepare('SELECT fingerprint FROM receipts WHERE fingerprint = ?').get(receipt.fingerprint) as { fingerprint?: string } | undefined;

    if (existing?.fingerprint) {
      this.db.prepare(`
        UPDATE receipts
        SET amount_text = ?,
            status_text = ?,
            receipt_available = ?,
            receipt_url = ?,
            receipt_downloaded = ?,
            last_seen_at = ?,
            raw_json = ?
        WHERE fingerprint = ?
      `).run(
        receipt.amountText,
        receipt.statusText ?? null,
        receipt.receiptAvailable ? 1 : 0,
        receipt.receiptUrl ?? null,
        receipt.receiptDownloaded ? 1 : 0,
        receipt.observedAt,
        receipt.rawJson ?? null,
        receipt.fingerprint
      );
    } else {
      this.db.prepare(`
        INSERT INTO receipts (
          account_external_id, month_label, amount_text, status_text,
          receipt_available, receipt_url, receipt_downloaded, fingerprint,
          first_seen_at, last_seen_at, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        receipt.accountExternalId,
        receipt.monthLabel,
        receipt.amountText,
        receipt.statusText ?? null,
        receipt.receiptAvailable ? 1 : 0,
        receipt.receiptUrl ?? null,
        receipt.receiptDownloaded ? 1 : 0,
        receipt.fingerprint,
        receipt.observedAt,
        receipt.observedAt,
        receipt.rawJson ?? null
      );
    }

    this.db.prepare(`
      INSERT INTO receipt_observations (receipt_fingerprint, observed_at, run_id, raw_json)
      VALUES (?, ?, ?, ?)
    `).run(receipt.fingerprint, receipt.observedAt, runId, receipt.rawJson ?? null);

    return !existing?.fingerprint;
  }

  finalizeRun(runId: number, summary: ScanSummary): void {
    this.db.prepare(`
      UPDATE runs
      SET finished_at = ?,
          status = ?,
          message = ?,
          accounts_scanned = ?,
          receipts_observed = ?,
          new_receipts = ?,
          needs_login = ?,
          summary_json = ?
      WHERE id = ?
    `).run(
      summary.finishedAt,
      summary.status,
      summary.message,
      summary.accountsScanned,
      summary.receiptsObserved,
      summary.newReceipts.length,
      summary.needsLogin ? 1 : 0,
      JSON.stringify(summary),
      runId
    );
  }

  getPendingNewReceiptsSinceLastRun(): ReceiptSnapshot[] {
    const rows = this.db.prepare(`
      SELECT r.*
      FROM receipts r
      JOIN runs run ON run.finished_at = r.first_seen_at
      WHERE run.new_receipts > 0
      ORDER BY r.first_seen_at DESC
    `).all() as any[];

    return rows.map(mapReceiptRow);
  }

  getLastRunStatus(): { status: RunStatus; message: string; needsLogin: boolean } | null {
    const row = this.db.prepare(`
      SELECT status, message, needs_login
      FROM runs
      ORDER BY id DESC
      LIMIT 1
    `).get() as { status: RunStatus; message: string; needs_login: number } | undefined;

    if (!row) return null;
    return { status: row.status, message: row.message, needsLogin: Boolean(row.needs_login) };
  }

  close(): void {
    this.db.close();
  }
}

function mapReceiptRow(row: any): ReceiptSnapshot {
  return {
    accountExternalId: row.account_external_id,
    monthLabel: row.month_label,
    amountText: row.amount_text,
    statusText: row.status_text ?? undefined,
    receiptAvailable: Boolean(row.receipt_available),
    receiptUrl: row.receipt_url ?? undefined,
    receiptDownloaded: Boolean(row.receipt_downloaded),
    fingerprint: row.fingerprint,
    observedAt: row.last_seen_at,
    rawJson: row.raw_json ?? undefined
  };
}
