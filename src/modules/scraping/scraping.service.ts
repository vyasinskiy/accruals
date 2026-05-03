import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
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
    private readonly apartmentsService: ApartmentsService,
    @Inject('NOTIFICATIONS_SERVICE') private readonly client: ClientProxy
  ) {}

  async bootstrapSession(): Promise<void> {
    await this.adapter.bootstrap();
  }

  @Cron(config.SCRAPE_CRON, { timeZone: config.TZ })
  async runCronScan(): Promise<ScanSummary> {
    console.log(`[cron] Starting scheduled scan (schedule: ${config.SCRAPE_CRON})`);
    return this.scan({ trigger: 'cron' });
  }

  async scan(input: ManualScanDto = {}): Promise<ScanSummary> {
    const startedAt = new Date();
    const trigger = input.trigger ?? 'manual';
    const log = (message: string) => {
      const timestamp = new Date().toLocaleString('ru-RU', { timeZone: config.TZ });
      console.log(`[${timestamp}] [scan:${trigger}] ${message}`);
    };
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
      log('Run started');
      const dbApartments = await this.apartmentsService.findMany({
        externalId: input.apartmentExternalId,
        address: input.address,
        organization: input.organization
      });
      const hasExplicitApartmentFilter = Boolean(input.apartmentExternalId || input.address || input.organization);
      if (hasExplicitApartmentFilter) {
        log(`DB filter matched apartments/accounts: ${dbApartments.length}`);
      }

      let apartments: ApartmentSnapshot[] = [];
      let accruals: AccrualSnapshot[] = [];
      let invoices: InvoiceSnapshot[] = [];
      let needsLogin = false;
      let degraded = false;
      let message = 'No data discovered.';

      if (!fs.existsSync(config.storageStatePath)) {
        needsLogin = true;
        message = 'No saved Playwright storage state found. Run npm run bootstrap first.';
        log(message);
      } else {
        try {
          const scan = await this.adapter.scan({
            apartmentExternalIds: hasExplicitApartmentFilter && dbApartments.length
              ? dbApartments.map((item) => item.externalId)
              : undefined,
            log
          });
          apartments = scan.apartments;
          accruals = scan.accruals;
          invoices = scan.invoices;
          needsLogin = scan.needsLogin;
          degraded = scan.degraded;
          message = scan.message;
          log(message);
        } catch (error) {
          degraded = true;
          message = error instanceof Error ? error.message : String(error);
          log(`Live scan failed: ${message}`);
        }
      }

      if (needsLogin) {
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
      log(`Apartments/accounts upserted: total=${apartments.length}, new=${newApartments}`);

      let newAccrualsCount = 0;
      for (const accrual of accruals) {
        if (await this.upsertAccrual(accrual, apartmentMap)) {
          newAccrualsCount += 1;
          this.client.emit('notify_accrual', {
            message: `🔔 <b>Новое начисление!</b>\n\nПериод: ${accrual.periodLabel}\nСумма: ${accrual.amountText}\nСтатус: ${accrual.statusText}\nАдрес: ${apartments.find(a => a.externalId === accrual.apartmentExternalId)?.address || 'неизвестен'}`
          });
        }
      }
      log(`Accruals upserted: total=${accruals.length}, new=${newAccrualsCount}`);

      let newInvoicesCount = 0;
      for (const invoice of invoices) {
        if (await this.upsertInvoice(invoice, apartmentMap)) {
          newInvoicesCount += 1;
          this.client.emit('notify_accrual', {
            message: `📄 <b>Доступна новая квитанция!</b>\n\nПериод: ${invoice.periodLabel}\nАдрес: ${apartments.find(a => a.externalId === invoice.apartmentExternalId)?.address || 'неизвестен'}`
          });
        }
      }
      log(`Invoices upserted: total=${invoices.length}, new=${newInvoicesCount}`);

      const summary = await this.finalize(run.id, {
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        trigger,
        status: degraded ? 'warning' : 'success',
        message,
        apartmentsScanned: apartments.length,
        accrualsObserved: accruals.length,
        invoicesObserved: invoices.length,
        newApartments,
        newAccruals: newAccrualsCount,
        newInvoices: newInvoicesCount,
        needsLogin
      });

      log(`Run finished with status=${summary.status}`);
      return summary;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Run failed: ${message}`);
      return await this.finalize(run.id, {
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        trigger,
        status: 'error',
        message,
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
