import fs from 'node:fs';
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
      if (!fs.existsSync(config.storageStatePath)) {
        return await this.finalize(run.id, {
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          trigger,
          status: 'needs_login',
          message: 'No saved Playwright storage state found. Run npm run bootstrap first.',
          apartmentsScanned: 0,
          accrualsObserved: 0,
          invoicesObserved: 0,
          newApartments: 0,
          newAccruals: 0,
          newInvoices: 0,
          needsLogin: true
        });
      }

      const dbApartments = await this.apartmentsService.findMany({
        externalId: input.apartmentExternalId,
        address: input.address,
        organization: input.organization
      });

      const scan = await this.adapter.scan({ apartmentExternalIds: dbApartments.length ? dbApartments.map((item) => item.externalId) : undefined });

      if (scan.needsLogin) {
        return await this.finalize(run.id, {
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          trigger,
          status: 'needs_login',
          message: scan.message,
          apartmentsScanned: 0,
          accrualsObserved: 0,
          invoicesObserved: 0,
          newApartments: 0,
          newAccruals: 0,
          newInvoices: 0,
          needsLogin: true
        });
      }

      const apartmentMap = new Map<string, number>();
      let newApartments = 0;
      for (const apartment of scan.apartments) {
        const result = await this.upsertApartment(apartment);
        apartmentMap.set(apartment.externalId, result.id);
        if (result.created) newApartments += 1;
      }

      let newAccruals = 0;
      for (const accrual of scan.accruals) {
        if (await this.upsertAccrual(accrual, apartmentMap)) newAccruals += 1;
      }

      let newInvoices = 0;
      for (const invoice of scan.invoices) {
        if (await this.upsertInvoice(invoice, apartmentMap)) newInvoices += 1;
      }

      return await this.finalize(run.id, {
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        trigger,
        status: 'success',
        message: scan.message,
        apartmentsScanned: scan.apartments.length,
        accrualsObserved: scan.accruals.length,
        invoicesObserved: scan.invoices.length,
        newApartments,
        newAccruals,
        newInvoices,
        needsLogin: false
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

    await this.prisma.invoice.upsert({
      where: { fingerprint: invoice.fingerprint },
      create: {
        apartmentId,
        apartmentExternalId: invoice.apartmentExternalId,
        periodLabel: invoice.periodLabel,
        invoiceUrl: invoice.invoiceUrl ?? null,
        utilitiesUrl: invoice.utilitiesUrl ?? null,
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
