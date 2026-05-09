import crypto from 'node:crypto';
import fs from 'node:fs';
import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Cron } from '@nestjs/schedule';
import { AccountantClientService } from '../../common/services/accountant-client.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { config } from '../../config';
import type { AccrualSnapshot, ApartmentSnapshot, InvoiceSnapshot, ScanSummary } from '../../types';
import { KvartplataAdapter } from './adapter';
import { ManualScanDto } from './dto/manual-scan.dto';

@Injectable()
export class ScrapingService {
  private readonly adapter = new KvartplataAdapter();

  constructor(
    private readonly accountantClientService: AccountantClientService,
    private readonly prisma: PrismaService,
    @Inject('ACCOUNTANT_SERVICE') private readonly accountantClient: ClientProxy
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
    const runId = crypto.randomUUID();
    const log = (message: string) => {
      const timestamp = new Date().toLocaleString('ru-RU', { timeZone: config.TZ });
      console.log(`[${timestamp}] [scan:${trigger}] ${message}`);
    };

    await this.prisma.run.create({
      data: {
        id: runId,
        startedAt,
        trigger,
        status: 'warning',
        message: 'Run started',
        summaryJson: '{}'
      }
    });

    try {
      log('Run started');
      const dbApartments = await this.accountantClientService.findApartments({
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
              ? dbApartments.map((item: any) => item.externalId)
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
        return await this.finalize(runId, {
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

      // Async emit: just tell accountant to save, don't wait
      for (const apartment of apartments) {
        this.accountantClient.emit('upsert_apartment', apartment);
      }
      log(`Apartments/accounts discovery sent to accountant: total=${apartments.length}`);

      for (const accrual of accruals) {
        this.accountantClient.emit('upsert_accrual', accrual);
      }
      log(`Accruals discovery sent to accountant: total=${accruals.length}`);

      let uploadedInvoices = 0;
      for (const invoice of invoices) {
        if (invoice.available && invoice.invoiceUrl) {
          try {
            // 1. Get pre-signed URL from accountant
            const { url, key } = await this.accountantClientService.getUploadUrl(invoice.apartmentExternalId, invoice.periodLabel);
            
            // 2. Download from external site
            log(`Downloading invoice: ${invoice.periodLabel} (${invoice.apartmentExternalId})`);
            const pdfBuffer = await this.adapter.downloadInvoice(invoice.invoiceUrl);
            
            // 3. Upload to S3 directly via pre-signed URL
            const uploadResponse = await fetch(url, {
                method: 'PUT',
                body: new Uint8Array(pdfBuffer),
                headers: { 'Content-Type': 'application/pdf' }
            });

            if (!uploadResponse.ok) {
                throw new Error(`S3 upload failed: ${uploadResponse.statusText}`);
            }

            // 4. Enrich metadata
            const raw = JSON.parse(invoice.rawJson || '{}');
            raw.s3Key = key;
            invoice.rawJson = JSON.stringify(raw);
            invoice.downloaded = true;
            invoice.localFilePath = key; // Use S3 key as path reference
            uploadedInvoices++;
          } catch (err: any) {
            log(`Failed to process S3 upload for invoice: ${err.message}`);
          }
        }
        this.accountantClient.emit('upsert_invoice', invoice);
      }
      log(`Invoices discovery sent to accountant: total=${invoices.length}, uploaded=${uploadedInvoices}`);

      const summary = await this.finalize(runId, {
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        trigger,
        status: degraded ? 'warning' : 'success',
        message,
        apartmentsScanned: apartments.length,
        accrualsObserved: accruals.length,
        invoicesObserved: invoices.length,
        newApartments: 0, 
        newAccruals: 0,
        newInvoices: 0,
        needsLogin
      });

      log(`Run finished with status=${summary.status}`);
      return summary;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Run failed: ${message}`);
      return await this.finalize(runId, {
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
    return [];
  }

  private async finalize(runId: string, summary: ScanSummary): Promise<ScanSummary> {
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

function dedupe<T>(items: T[], getKey: (item: T) => string): T[] {
  const map = new Map<string, T>();
  for (const item of items) map.set(getKey(item), item);
  return [...map.values()];
}
