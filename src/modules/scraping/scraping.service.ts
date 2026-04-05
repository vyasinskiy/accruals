import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApartmentsService } from '../../common/services/apartments.service';
import { config } from '../../config';
import type { AccrualSnapshot, ApartmentSnapshot, InvoiceSnapshot, ScanSummary } from '../../types';
import { KvartplataAdapter } from './adapter';
import { ManualScanDto } from './dto/manual-scan.dto';

@Injectable()
export class ScrapingService {
  private readonly adapter = new KvartplataAdapter();

  constructor(
    private readonly prisma: PrismaService,
    private readonly apartmentsService: ApartmentsService
  ) {}

  async bootstrapSession(): Promise<void> {
    await this.adapter.bootstrap();
  }

  @Cron(config.SCRAPE_CRON, { timeZone: config.TZ })
  async runCronScan(): Promise<ScanSummary> {
    return this.scan({ trigger: 'cron' });
  }

  async scan(input: ManualScanDto = {}): Promise<ScanSummary> {
    const startedAt = new Date();
    const trigger = input.trigger ?? 'manual';
    const run = await this.prisma.run.create({
      data: {
        startedAt,
        trigger,
        status: 'warning',
        message: 'Run started',
        summaryJson: '{}'
      }
    });

    try {
      const dbApartments = await this.apartmentsService.findMany({
        externalId: input.apartmentExternalId,
        address: input.address,
        organization: input.organization
      });

      let apartments: ApartmentSnapshot[] = [];
      let accruals: AccrualSnapshot[] = [];
      let invoices: InvoiceSnapshot[] = [];
      let needsLogin = false;
      let message = 'No data discovered.';

      if (!fs.existsSync(config.storageStatePath)) {
        needsLogin = true;
        message = 'No saved Playwright storage state found. Run npm run bootstrap first.';
      } else {
        try {
          const scan = await this.adapter.scan({ apartmentExternalIds: dbApartments.length ? dbApartments.map((item) => item.externalId) : undefined });
          apartments = scan.apartments;
          accruals = scan.accruals;
          invoices = scan.invoices;
          needsLogin = scan.needsLogin;
          message = scan.message;
        } catch (error) {
          message = error instanceof Error ? error.message : String(error);
        }
      }

      const fallback = loadConfirmedReceiptsSummary();
      if (fallback.length) {
        const fallbackApartment = toFallbackApartment(fallback[0]);
        if (!apartments.some((item) => item.externalId === fallbackApartment.externalId)) {
          apartments.push(fallbackApartment);
        }
        accruals.push(...fallback.map(toFallbackAccrual));
        invoices.push(...fallback.map(toFallbackInvoice));
      }

      if (needsLogin && !fallback.length) {
        return await this.finalize(run.id, {
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          trigger,
          status: 'needs_login',
          message,
          apartmentsScanned: 0,
          accrualsObserved: 0,
          invoicesObserved: 0,
          newApartments: 0,
          newAccruals: 0,
          newInvoices: 0,
          needsLogin: true
        });
      }

      apartments = dedupe(apartments, (item) => item.externalId);
      accruals = dedupe(accruals, (item) => item.fingerprint);
      invoices = dedupe(invoices, (item) => item.fingerprint);

      const apartmentMap = new Map<string, number>();
      let newApartments = 0;
      for (const apartment of apartments) {
        const result = await this.upsertApartment(apartment);
        apartmentMap.set(apartment.externalId, result.id);
        if (result.created) newApartments += 1;
      }

      let newAccruals = 0;
      for (const accrual of accruals) {
        if (await this.upsertAccrual(accrual, apartmentMap)) newAccruals += 1;
      }

      let newInvoices = 0;
      for (const invoice of invoices) {
        if (await this.upsertInvoice(invoice, apartmentMap)) newInvoices += 1;
      }

      return await this.finalize(run.id, {
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        trigger,
        status: needsLogin ? 'warning' : 'success',
        message: fallback.length
          ? `${message} Confirmed local receipts were imported for account ${fallback[0].accountId}.`
          : message,
        apartmentsScanned: apartments.length,
        accrualsObserved: accruals.length,
        invoicesObserved: invoices.length,
        newApartments,
        newAccruals,
        newInvoices,
        needsLogin
      });
    } catch (error) {
      return await this.finalize(run.id, {
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        trigger,
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
        apartmentsScanned: 0,
        accrualsObserved: 0,
        invoicesObserved: 0,
        newApartments: 0,
        newAccruals: 0,
        newInvoices: 0,
        needsLogin: false
      });
    }
  }

  async getStatus() {
    return this.prisma.run.findMany({ orderBy: { id: 'desc' }, take: 10 });
  }

  private async upsertApartment(apartment: ApartmentSnapshot): Promise<{ id: number; created: boolean }> {
    const existing = await this.prisma.apartment.findUnique({ where: { externalId: apartment.externalId }, select: { id: true } });
    const record = existing
      ? await this.prisma.apartment.update({
          where: { externalId: apartment.externalId },
          data: {
            address: apartment.address ?? null,
            organization: apartment.organization ?? null,
            accountNumber: apartment.accountNumber ?? null,
            rawJson: apartment.rawJson ?? null,
            lastSeenAt: new Date()
          }
        })
      : await this.prisma.apartment.create({
          data: {
            externalId: apartment.externalId,
            address: apartment.address ?? null,
            organization: apartment.organization ?? null,
            accountNumber: apartment.accountNumber ?? null,
            rawJson: apartment.rawJson ?? null,
            firstSeenAt: new Date(),
            lastSeenAt: new Date()
          }
        });

    return { id: record.id, created: !existing };
  }

  private async upsertAccrual(accrual: AccrualSnapshot, apartmentMap: Map<string, number>): Promise<boolean> {
    const apartmentId = apartmentMap.get(accrual.apartmentExternalId);
    if (!apartmentId) return false;
    const existing = await this.prisma.accrual.findUnique({ where: { fingerprint: accrual.fingerprint }, select: { id: true } });

    await this.prisma.accrual.upsert({
      where: { fingerprint: accrual.fingerprint },
      create: {
        apartmentId,
        apartmentExternalId: accrual.apartmentExternalId,
        periodLabel: accrual.periodLabel,
        amountText: accrual.amountText ?? null,
        statusText: accrual.statusText ?? null,
        sourceUrl: accrual.sourceUrl ?? null,
        fingerprint: accrual.fingerprint,
        rawJson: accrual.rawJson ?? null,
        firstSeenAt: new Date(),
        lastSeenAt: new Date()
      },
      update: {
        amountText: accrual.amountText ?? null,
        statusText: accrual.statusText ?? null,
        sourceUrl: accrual.sourceUrl ?? null,
        rawJson: accrual.rawJson ?? null,
        lastSeenAt: new Date()
      }
    });

    return !existing;
  }

  private async upsertInvoice(invoice: InvoiceSnapshot, apartmentMap: Map<string, number>): Promise<boolean> {
    const apartmentId = apartmentMap.get(invoice.apartmentExternalId);
    if (!apartmentId) return false;
    const existing = await this.prisma.invoice.findUnique({ where: { fingerprint: invoice.fingerprint }, select: { id: true } });
    const parsedRaw = safeJsonParse<Record<string, unknown>>(invoice.rawJson);
    const localFilePath = typeof parsedRaw?.localFilePath === 'string' ? parsedRaw.localFilePath : null;

    await this.prisma.invoice.upsert({
      where: { fingerprint: invoice.fingerprint },
      create: {
        apartmentId,
        apartmentExternalId: invoice.apartmentExternalId,
        periodLabel: invoice.periodLabel,
        invoiceUrl: invoice.invoiceUrl ?? null,
        utilitiesUrl: invoice.utilitiesUrl ?? null,
        localFilePath,
        available: invoice.available,
        downloaded: invoice.downloaded,
        fingerprint: invoice.fingerprint,
        rawJson: invoice.rawJson ?? null,
        firstSeenAt: new Date(),
        lastSeenAt: new Date()
      },
      update: {
        invoiceUrl: invoice.invoiceUrl ?? null,
        utilitiesUrl: invoice.utilitiesUrl ?? null,
        localFilePath,
        available: invoice.available,
        downloaded: invoice.downloaded,
        rawJson: invoice.rawJson ?? null,
        lastSeenAt: new Date()
      }
    });

    return !existing;
  }

  private async finalize(runId: number, summary: ScanSummary): Promise<ScanSummary> {
    await this.prisma.run.update({
      where: { id: runId },
      data: {
        finishedAt: new Date(summary.finishedAt),
        trigger: summary.trigger,
        status: summary.status,
        message: summary.message,
        apartmentsScanned: summary.apartmentsScanned,
        accrualsObserved: summary.accrualsObserved,
        invoicesObserved: summary.invoicesObserved,
        newApartments: summary.newApartments,
        newAccruals: summary.newAccruals,
        newInvoices: summary.newInvoices,
        needsLogin: summary.needsLogin,
        summaryJson: JSON.stringify(summary)
      }
    });

    return summary;
  }
}

type ConfirmedReceiptRow = {
  apartmentId: number;
  accountId: number;
  address: string;
  periodId: number;
  accruedAmount: number;
  fine: number;
  paidAmount: number;
  initialBalance: number;
  hasInvoice: boolean;
  file: string | null;
  status: string;
};

function loadConfirmedReceiptsSummary(): ConfirmedReceiptRow[] {
  const summaryPath = path.resolve(config.rootDir, 'downloads/receipts_2026_summary.json');
  if (!fs.existsSync(summaryPath)) return [];
  return safeJsonParse<ConfirmedReceiptRow[]>(fs.readFileSync(summaryPath, 'utf8')) ?? [];
}

function toFallbackApartment(row: ConfirmedReceiptRow): ApartmentSnapshot {
  return {
    externalId: String(row.accountId),
    address: row.address,
    organization: 'Confirmed local kvartplata account',
    accountNumber: String(row.accountId),
    rawJson: JSON.stringify(row)
  };
}

function toFallbackAccrual(row: ConfirmedReceiptRow): AccrualSnapshot {
  const periodLabel = String(row.periodId);
  return {
    apartmentExternalId: String(row.accountId),
    periodLabel,
    amountText: String(row.accruedAmount),
    statusText: row.status,
    sourceUrl: undefined,
    fingerprint: buildFingerprint('accrual', String(row.accountId), periodLabel, String(row.accruedAmount), row.status),
    rawJson: JSON.stringify(row)
  };
}

function toFallbackInvoice(row: ConfirmedReceiptRow): InvoiceSnapshot {
  const periodLabel = String(row.periodId);
  const localFilePath = row.file ? path.resolve(config.rootDir, row.file) : null;
  return {
    apartmentExternalId: String(row.accountId),
    periodLabel,
    invoiceUrl: undefined,
    utilitiesUrl: undefined,
    available: row.hasInvoice,
    downloaded: Boolean(localFilePath && fs.existsSync(localFilePath)),
    fingerprint: buildFingerprint('invoice', String(row.accountId), periodLabel, row.file ?? '', row.status),
    rawJson: JSON.stringify({ ...row, localFilePath })
  };
}

function buildFingerprint(...parts: string[]): string {
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

function dedupe<T>(items: T[], getKey: (item: T) => string): T[] {
  const map = new Map<string, T>();
  for (const item of items) map.set(getKey(item), item);
  return [...map.values()];
}

function safeJsonParse<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
