import fs from 'node:fs';
import { lastValueFrom } from 'rxjs';
import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Cron } from '@nestjs/schedule';
import parser from 'cron-parser';
import { AccountantClientService } from '../../common/services/accountant-client.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { config } from '../../config';
import type { AccrualSnapshot, ApartmentSnapshot, AccountSnapshot, InvoiceSnapshot, ScanSummary } from '../../types';
import { KvartplataAdapter } from './adapter';
import { ManualScanDto } from './dto/manual-scan.dto';
import { printSwaggerUrl } from '../../common/utils/swagger';

@Injectable()
export class ScrapingService implements OnApplicationBootstrap {
  private readonly adapter = new KvartplataAdapter();

  constructor(
    private readonly accountantClientService: AccountantClientService,
    private readonly prisma: PrismaService,
    @Inject('ACCOUNTANT_SERVICE') private readonly accountantClient: ClientProxy,
    @Inject('NOTIFICATIONS_SERVICE') private readonly notificationsClient: ClientProxy
  ) { }

  async bootstrapSession(): Promise<void> {
    await this.adapter.bootstrap();
  }

  async onApplicationBootstrap(): Promise<void> {
    // Delay check for 10 seconds to allow time synchronization inside VM
    setTimeout(async () => {
      console.log('[bootstrap] Checking for missed scheduled scans...');
      try {
        await this.checkAndRunMissedScan();
      } catch (error) {
        console.error('[bootstrap] Failed during bootstrap missed scan check:', error);
      }
    }, 10000);
  }

  @Cron(config.SCRAPE_CRON, { timeZone: config.TZ })
  async runCronScan(): Promise<ScanSummary> {
    console.log(`[cron] Starting scheduled scan (schedule: ${config.SCRAPE_CRON})`);
    return this.scan({ trigger: 'cron' });
  }

  @Cron('0 * * * *', { timeZone: config.TZ })
  async checkAndRunMissedScan(): Promise<void> {
    try {
      const options = {
        currentDate: new Date(),
        tz: config.TZ
      };
      const interval = parser.parseExpression(config.SCRAPE_CRON, options);
      const prevDate = interval.prev().toDate();

      const lastSuccessfulRun = await this.prisma.run.findFirst({
        where: {
          status: { in: ['success', 'warning'] },
          startedAt: { gte: prevDate }
        }
      });

      if (!lastSuccessfulRun) {
        console.log('[cron] No successful run found after the last scheduled time. Triggering missed scan...');
        await this.scan({ trigger: 'cron' });
      }
    } catch (error) {
      console.error('[cron] Failed during missed scan check:', error);
    }
  }


  async scan(input: ManualScanDto = {}): Promise<ScanSummary> {
    const startedAt = new Date();
    const trigger = input.trigger ?? 'manual';
    const log = (message: string) => {
      const timestamp = new Date().toLocaleString('ru-RU', { timeZone: config.TZ });
      console.log(`[${timestamp}] [scan:${trigger}] ${message}`);
    };

    let runId: number | undefined = undefined;
    try {
      const run = await this.prisma.run.create({
        data: {
          startedAt,
          trigger,
          status: 'warning',
          message: 'Run started',
          summaryJson: '{}'
        }
      });
      runId = run.id;

      log('Run started');
      const dbApartments = await this.accountantClientService.findApartments({
        externalId: input.apartmentExternalId,
        address: input.address,
        organization: input.organization
      });
      const hasExplicitApartmentFilter = Boolean(input.apartmentExternalId || input.address || input.organization);
      if (hasExplicitApartmentFilter) {
        log(`DB filter matched apartments: ${dbApartments.length}`);
      }

      let apartments: ApartmentSnapshot[] = [];
      let accounts: AccountSnapshot[] = [];
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
          accounts = scan.accounts;
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
        const summary = await this.finalize(runId, {
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
        printSwaggerUrl(log);
        return summary;
      }

      apartments = dedupe(apartments, (item) => item.externalId);
      accounts = dedupe(accounts, (item) => item.externalId);
      accruals = dedupe(accruals, (item) => `${item.accountExternalId}_${item.periodId}`);
      invoices = dedupe(invoices, (item) => `${item.accountExternalId}_${item.periodId}`);

      // Count new entities BEFORE we start upserting them.
      // This is crucial because upserting is done asynchronously or fast enough
      // to cause a race condition, where the DB would already contain the new items
      // by the time we query it for calculation.
      const { newApartments, newAccruals, newInvoices } = await this.calculateNewEntitiesCount(
        apartments,
        accounts,
        accruals,
        invoices,
        log
      );

      // 1. Process Apartments (Wait for completion)
      for (const apartment of apartments) {
        await lastValueFrom(this.accountantClient.send('upsert_apartment', apartment));
      }
      log(`Apartments discovery sent to accountant: total=${apartments.length}`);

      // 2. Process Accounts (MUST follow apartments, wait for completion)
      for (const account of accounts) {
        await lastValueFrom(this.accountantClient.send('upsert_account', account));
      }
      log(`Accounts discovery sent to accountant: total=${accounts.length}`);

      // 3. Process Accruals
      for (const accrual of accruals) {
        this.accountantClient.emit('upsert_accrual', accrual);
      }
      log(`Accruals discovery sent to accountant: total=${accruals.length}`);

      let uploadedInvoicesCount = 0;
      let skippedInvoices = 0;
      const uploadErrors: string[] = [];

      // 4. Process Invoices (Involves S3 upload which takes time, ensuring accounts are likely processed by now)
      // Optimized: Fetch all already uploaded invoices for these accounts to avoid N+1 requests
      const accountIds = accounts.map(a => a.externalId);
      const existingUploadedInvoices = await this.accountantClientService.findInvoices({
        accountExternalId: accountIds,
        uploadedToS3: true
      });
      const uploadedMap = new Set(existingUploadedInvoices.map((inv: any) => `${inv.accountExternalId}_${inv.periodId}`));

      for (const invoice of invoices) {
        let shouldUpsert = true;
        if (invoice.available && invoice.invoiceUrl) {
          try {
            if (uploadedMap.has(`${invoice.accountExternalId}_${invoice.periodId}`)) {
              log(`Invoice already in S3 (skipped): ${invoice.periodLabel} (${invoice.accountExternalId})`);
              skippedInvoices++;
            } else {
              const { url, key } = await this.accountantClientService.getUploadUrl(invoice.accountExternalId, invoice.periodLabel);

              log(`Downloading invoice: ${invoice.periodLabel} (${invoice.accountExternalId})`);
              const pdfBuffer = await this.adapter.downloadInvoice(invoice.invoiceUrl);

              try {
                const uploadResponse = await fetch(url, {
                  method: 'PUT',
                  body: new Uint8Array(pdfBuffer),
                  headers: { 'Content-Type': 'application/pdf' }
                });

                if (!uploadResponse.ok) {
                  throw new Error(`S3 upload failed with status ${uploadResponse.status}: ${uploadResponse.statusText}`);
                }
                log(`Successfully uploaded to S3: ${invoice.periodLabel} (${key})`);
              } catch (fetchError: any) {
                const detailedMsg = [
                  fetchError.message,
                  fetchError.cause?.code ? `[Code: ${fetchError.cause.code}]` : null,
                  fetchError.cause?.message ? `(Cause: ${fetchError.cause.message})` : null
                ].filter(Boolean).join(' ');
                throw new Error(`Network error during S3 upload to ${url}: ${detailedMsg}`, { cause: fetchError });
              }

              // 4. Enrich metadata
              const raw = JSON.parse(invoice.rawJson || '{}');
              raw.s3Key = key;
              invoice.rawJson = JSON.stringify(raw);
              invoice.uploadedToS3 = true;
              invoice.localFilePath = key;
              uploadedInvoicesCount++;
            }
          } catch (err: any) {
            const red = '\x1b[31m';
            const reset = '\x1b[0m';
            const errorMsg = `Invoice ${invoice.periodLabel} (${invoice.accountExternalId}): ${err.message.trim()}`;
            log(`${red}Failed to process S3 upload for ${errorMsg}${reset}`);
            uploadErrors.push(errorMsg);
            invoice.available = false;
            invoice.uploadedToS3 = false;
          }
        }

        if (shouldUpsert) {
          this.accountantClient.emit('upsert_invoice', invoice);
        }
      }

      const blue = '\x1b[34m';
      const green = '\x1b[32m';
      const yellow = '\x1b[33m';
      const red = '\x1b[31m';
      const reset = '\x1b[0m';

      log(`${blue}--- Scan Results Overview ---${reset}`);
      log(`Apartments/Accounts discovered: ${apartments.length} / ${accounts.length}`);
      log(`Accruals observed: ${accruals.length}`);
      log(`Invoices discovered: ${invoices.length}`);
      log(`${green}Successfully processed/uploaded: ${uploadedInvoicesCount}${reset}`);
      log(`${yellow}Skipped (already in S3): ${skippedInvoices}${reset}`);

      if (uploadErrors.length > 0) {
        log(`${red}Errors encountered: ${uploadErrors.length}${reset}`);
        for (const error of uploadErrors) {
          log(`${red}  - ${error}${reset}`);
        }
      }
      log(`${blue}-----------------------------${reset}`);

      const summary = await this.finalize(runId, {
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        trigger,
        status: (degraded || uploadErrors.length > 0) ? 'warning' : 'success',
        message,
        apartmentsScanned: apartments.length,
        accrualsObserved: accruals.length,
        invoicesObserved: invoices.length,
        newApartments,
        newAccruals,
        newInvoices,
        needsLogin
      });

      log(`Run finished with status=${summary.status}`);
      printSwaggerUrl(log);
      return summary;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Run failed: ${message}`);

      try {
        if (runId !== undefined) {
          const finalSummary = await this.finalize(runId, {
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
          printSwaggerUrl(log);
          return finalSummary;
        }
      } catch (finalizeError) {
        log(`Final fatal error (could not even finalize run): ${finalizeError instanceof Error ? finalizeError.message : String(finalizeError)}`);
      }
      printSwaggerUrl(log);
      throw error;
    }
  }

  async getStatus() {
    return this.prisma.run.findMany({
      orderBy: { id: 'desc' },
      take: 20,
    });
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

    this.notificationsClient.emit('scan_completed', summary);

    return summary;
  }

  /**
   * Calculates the number of new apartments, accruals, and invoices by comparing the scraped snapshots
   * against the database state BEFORE any upserts occur.
   * This prevents race conditions where asynchronous DB updates make new items appear already processed.
   */
  private async calculateNewEntitiesCount(
    apartments: ApartmentSnapshot[],
    accounts: AccountSnapshot[],
    accruals: AccrualSnapshot[],
    invoices: InvoiceSnapshot[],
    log: (message: string) => void
  ): Promise<{ newApartments: number; newAccruals: number; newInvoices: number }> {
    let newApartments = 0;
    let newAccruals = 0;
    let newInvoices = 0;

    try {
      const existingApartments = await this.accountantClientService.findApartments({});
      const apartmentMap = new Set((existingApartments || []).map((apt: any) => apt.externalId));
      for (const apartment of apartments) {
        if (!apartmentMap.has(apartment.externalId)) {
          newApartments++;
        }
      }

      const accountIds = accounts.map(a => a.externalId);
      if (accountIds.length > 0) {
        const existingAccruals = await this.accountantClientService.findAccruals({
          accountExternalId: accountIds
        });
        const accrualMap = new Set((existingAccruals || []).map((acc: any) => `${acc.accountExternalId}_${acc.periodId}`));
        for (const accrual of accruals) {
          if (!accrualMap.has(`${accrual.accountExternalId}_${accrual.periodId}`)) {
            newAccruals++;
          }
        }

        const existingInvoices = await this.accountantClientService.findInvoices({
          accountExternalId: accountIds
        });
        const invoiceMap = new Set((existingInvoices || []).map((inv: any) => `${inv.accountExternalId}_${inv.periodId}`));
        for (const invoice of invoices) {
          if (!invoiceMap.has(`${invoice.accountExternalId}_${invoice.periodId}`)) {
            newInvoices++;
          }
        }
      }
    } catch (err: any) {
      log(`Failed to calculate new items counts: ${err.message}`);
    }

    return { newApartments, newAccruals, newInvoices };
  }
}

function dedupe<T>(items: T[], getKey: (item: T) => string): T[] {
  const map = new Map<string, T>();
  for (const item of items) map.set(getKey(item), item);
  return [...map.values()];
}
