import crypto from 'node:crypto';
import type { BrowserContext, Page } from 'playwright';
import { s3Storage } from '../../common/services/s3-storage.service';
import { config } from '../../config';
import type { AccrualSnapshot, ApartmentSnapshot, InvoiceSnapshot, ScanResult } from '../../types';

export class KvartplataAdapter {
  async bootstrap(): Promise<void> {
    const { chromium } = await import('playwright');
    const browser = config.BROWSER_WS_ENDPOINT
      ? await chromium.connectOverCDP(config.BROWSER_WS_ENDPOINT)
      : await chromium.launch({ headless: false });
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();

    if (config.BROWSER_WS_ENDPOINT) {
      console.log('--- REMOTE BROWSER DETECTED ---');
      console.log('1. Open your browser and go to: http://localhost:3001');
      console.log('2. You will see the remote browser screen there.');
    }

    await page.goto(config.LOGIN_URL, { waitUntil: 'domcontentloaded' });
    console.log(`Open page: ${config.LOGIN_URL}`);
    console.log('Log in manually, solve captcha manually if it appears, then press Enter here to save the session.');

    await waitForEnter();
    await page.waitForTimeout(config.WAIT_AFTER_LOGIN_MS);

    if (await this.isLoginRequired(page)) {
      await browser.close();
      throw new Error('Login still appears required. Session state was not saved.');
    }

    await context.storageState({ path: config.storageStatePath });
    await browser.close();
  }

  async scan(
    filters: { apartmentExternalIds?: string[]; log?: (message: string) => void } = {}
  ): Promise<ScanResult> {
    const { chromium } = await import('playwright');
    const browser = config.BROWSER_WS_ENDPOINT
      ? await chromium.connectOverCDP(config.BROWSER_WS_ENDPOINT)
      : await chromium.launch({ headless: config.HEADLESS });
    const context = await browser.newContext({
      storageState: config.storageStatePath,
      acceptDownloads: config.DOWNLOAD_RECEIPTS
    });
    const page = await context.newPage();
    const log = filters.log ?? (() => undefined);

    try {
      await page.goto(config.ACCOUNT_PAGE_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(config.WAIT_AFTER_NAV_MS);

      if (await this.isLoginRequired(page)) {
        return {
          apartments: [],
          accruals: [],
          invoices: [],
          needsLogin: true,
          degraded: false,
          message: 'Saved session is missing or expired; manual bootstrap is required.'
        };
      }

      const warnings: string[] = [];
      const apartmentPayload = await this.fetchJson(page, config.endpoints.apartments).catch((error) => {
        warnings.push(error instanceof Error ? error.message : String(error));
        return null;
      });
      const apartments = apartmentPayload ? extractApartments(apartmentPayload) : [];
      if (!apartmentPayload) {
        return {
          apartments: [],
          accruals: [],
          invoices: [],
          needsLogin: false,
          degraded: true,
          message: warnings.join(' ')
        };
      }
      log(`Apartments discovered from /new-web/apartments: ${apartments.length}`);

      const selectedApartmentRefs = filters.apartmentExternalIds?.length
        ? apartments.filter((item) => filters.apartmentExternalIds?.includes(item.externalId))
        : apartments;
      log(`Apartments selected for scan: ${selectedApartmentRefs.length}`);

      const apartmentSnapshots: ApartmentSnapshot[] = [];
      const accruals: AccrualSnapshot[] = [];
      const invoices: InvoiceSnapshot[] = [];
      let accountsFound = 0;
      let invoicesDownloaded = 0;
      let invoicesSkipped = 0;
      const existingS3Keys = new Set<string>();

      if (config.S3_ENABLED && s3Storage.isEnabled()) {
        try {
          const prefetchedKeys = await s3Storage.listKeys();
          for (const key of prefetchedKeys) existingS3Keys.add(key);
          log(`Prefetched ${existingS3Keys.size} existing invoice file(s) from S3`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          warnings.push(`S3 prefetch failed: ${errorMessage}`);
          log(`S3 prefetch failed: ${errorMessage}`);
        }
      }

      for (const apartment of selectedApartmentRefs) {
        try {
          log(`Apartment found: ${formatApartment(apartment)}`);
          const infoPayload = await this.fetchJson(page, config.endpoints.apartmentInfo, {}, { apartmentId: apartment.externalId });
          const accounts = extractAccounts(apartment, infoPayload);
          accountsFound += accounts.length;
          log(`Accounts found for apartment ${apartment.externalId}: ${accounts.length}`);

          for (const account of accounts) {
            apartmentSnapshots.push(account);
            log(`Scanning account ${account.externalId} for apartment ${apartment.externalId}`);

            const accrualPayload = await this.fetchJson(page, config.endpoints.accruals, { accountId: account.externalId });
            const accountAccruals = extractAccruals(account, accrualPayload);
            accruals.push(...accountAccruals);
            log(`Accrual periods found for account ${account.externalId}: ${accountAccruals.length}`);

            const accountInvoices = await this.extractInvoices(page, account, accountAccruals, existingS3Keys, log);
            invoices.push(...accountInvoices.rows);
            invoicesDownloaded += accountInvoices.downloaded;
            invoicesSkipped += accountInvoices.skipped;
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          warnings.push(`Apartment ${apartment.externalId}: ${errorMessage}`);
          log(`Apartment ${apartment.externalId} failed: ${errorMessage}`);
        }
      }

      const selectedAccounts = dedupe(apartmentSnapshots, (item) => item.externalId);
      log(
        `Scan summary: apartments=${selectedApartmentRefs.length}, accounts=${selectedAccounts.length}, accruals=${accruals.length}, invoices=${invoices.length}, downloaded=${invoicesDownloaded}, skipped=${invoicesSkipped}`
      );

      return {
        apartments: selectedAccounts,
        accruals,
        invoices,
        needsLogin: false,
        degraded: warnings.length > 0,
        message: warnings.length
          ? `Scanned ${selectedApartmentRefs.length} apartment(s), ${accountsFound} account(s), ${accruals.length} accrual row(s), ${invoices.length} invoice row(s). Warnings: ${warnings.join(' ')}`
          : `Scanned ${selectedApartmentRefs.length} apartment(s), ${accountsFound} account(s), ${accruals.length} accrual row(s), ${invoices.length} invoice row(s).`
      };
    } finally {
      await browser.close();
    }
  }

  private async extractInvoices(
    page: Page,
    account: ApartmentSnapshot,
    accruals: AccrualSnapshot[],
    existingS3Keys: Set<string>,
    log: (message: string) => void
  ): Promise<{ rows: InvoiceSnapshot[]; downloaded: number; skipped: number }> {
    const results: InvoiceSnapshot[] = [];
    let downloaded = 0;
    let skipped = 0;

    for (const accrual of accruals) {
      const invoiceAttempt = await this.tryFetchInvoice(
        page.context(),
        account.externalId,
        accrual.periodId ?? accrual.periodLabel,
        existingS3Keys
      );

      if (invoiceAttempt.downloaded) downloaded += 1;
      else skipped += 1;

      log(
        invoiceAttempt.available
          ? `Invoice ${invoiceAttempt.downloaded ? 'downloaded' : 'available but skipped'} for account ${account.externalId}, period ${accrual.periodLabel}`
          : `Invoice missing for account ${account.externalId}, period ${accrual.periodLabel}`
      );

      results.push({
        apartmentExternalId: account.externalId,
        parentApartmentId: account.parentApartmentId,
        periodLabel: accrual.periodLabel,
        periodId: accrual.periodId,
        invoiceUrl: invoiceAttempt.invoiceUrl,
        utilitiesUrl: undefined,
        available: invoiceAttempt.available,
        downloaded: invoiceAttempt.downloaded,
        fingerprint: buildFingerprint('invoice', account.externalId, accrual.periodId ?? accrual.periodLabel, invoiceAttempt.invoiceUrl ?? '', invoiceAttempt.storageKey ?? ''),
        rawJson: JSON.stringify({
          accountId: account.externalId,
          parentApartmentId: account.parentApartmentId,
          periodId: accrual.periodId ?? accrual.periodLabel,
          invoiceUrl: invoiceAttempt.invoiceUrl,
          localFilePath: invoiceAttempt.storageKey,
          s3Key: invoiceAttempt.storageKey,
          storageProvider: invoiceAttempt.storageKey ? 's3' : undefined
        })
      });
    }

    return { rows: dedupe(results, (item) => item.fingerprint), downloaded, skipped };
  }

  private async fetchJson(
    page: Page,
    endpoint: string,
    params: Record<string, string> = {},
    pathParams: Record<string, string> = {}
  ): Promise<unknown> {
    const url = new URL(applyPathParams(endpoint, pathParams), config.API_BASE_URL);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await page.request.get(url.toString(), {
      headers: { accept: 'application/json, text/plain, */*' }
    });

    if (!response.ok()) {
      throw new Error(`Kvartplata API ${endpoint} failed with ${response.status()}`);
    }

    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private async isLoginRequired(page: Page): Promise<boolean> {
    const bodyText = (await page.textContent('body'))?.toLowerCase() ?? '';
    const hasReadySignal = config.accountReadyTextList.some((keyword) => bodyText.includes(keyword.toLowerCase()));
    if (hasReadySignal) return false;
    return config.sessionRequiredKeywords.some((keyword) => bodyText.includes(keyword));
  }

  private async tryFetchInvoice(
    context: BrowserContext,
    accountId: string,
    periodId: string,
    existingS3Keys: Set<string>
  ): Promise<{ available: boolean; downloaded: boolean; invoiceUrl: string; storageKey?: string }> {
    const shouldStoreReceipt = config.DOWNLOAD_RECEIPTS || s3Storage.isEnabled();
    const invoiceUrl = new URL(config.endpoints.invoice, config.API_BASE_URL);
    invoiceUrl.searchParams.set('AccountId', accountId);
    invoiceUrl.searchParams.set('PeriodId', periodId);
    const storageKey = s3Storage.buildInvoiceKey(accountId, periodId);

    try {
      if (shouldStoreReceipt && s3Storage.isEnabled() && existingS3Keys.has(storageKey)) {
        return { available: true, downloaded: false, invoiceUrl: invoiceUrl.toString(), storageKey };
      }

      const page = await context.newPage();
      const response = await page.request.get(invoiceUrl.toString(), {
        headers: { accept: 'application/pdf, application/octet-stream, */*' }
      });
      if (!response.ok()) {
        await page.close();
        return { available: false, downloaded: false, invoiceUrl: invoiceUrl.toString() };
      }
      const buffer = await response.body();
      await page.close();

      if (!shouldStoreReceipt) {
        return { available: true, downloaded: false, invoiceUrl: invoiceUrl.toString() };
      }

      if (!s3Storage.isEnabled()) {
        throw new Error('S3 storage is required when DOWNLOAD_RECEIPTS=true');
      }

      await s3Storage.uploadPdf(storageKey, buffer);
      existingS3Keys.add(storageKey);
      return { available: true, downloaded: true, invoiceUrl: invoiceUrl.toString(), storageKey };
    } catch {
      return { available: false, downloaded: false, invoiceUrl: invoiceUrl.toString() };
    }
  }
}

async function waitForEnter(): Promise<void> {
  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', () => resolve());
  });
}

function extractApartments(payload: unknown): ApartmentSnapshot[] {
  const rows = collectObjects(payload);
  return dedupe(rows.map((row) => ({
    externalId: pickString(row, ['id', 'Id', 'apartmentId', 'apartment_id']) ?? crypto.createHash('md5').update(JSON.stringify(row)).digest('hex'),
    address: pickString(row, ['address', 'Address', 'fullAddress', 'houseAddress']),
    organization: pickString(row, ['organization', 'Organization', 'company', 'managementCompany']),
    rawJson: JSON.stringify(row)
  })), (item) => item.externalId);
}

function extractAccounts(apartment: ApartmentSnapshot, payload: unknown): ApartmentSnapshot[] {
  const accounts = findObjectsAtKeys(payload, ['accounts', 'Accounts']);
  const rows = accounts.length ? accounts : collectObjects(payload);
  const extracted: ApartmentSnapshot[] = [];

  for (const row of rows) {
    const accountId = pickString(row, ['id', 'Id', 'accountId', 'account_id', 'ls', 'personalAccount']);
    if (!accountId) continue;
    extracted.push({
      externalId: accountId,
      parentApartmentId: apartment.externalId,
      address: apartment.address ?? pickString(row, ['address', 'Address', 'fullAddress', 'houseAddress']),
      organization: apartment.organization ?? pickString(row, ['organization', 'Organization', 'company', 'managementCompany']),
      accountNumber: pickString(row, ['number', 'Number', 'accountNumber', 'AccountNumber', 'ls', 'personalAccount']) ?? accountId,
      accountLabel: pickString(row, ['name', 'Name', 'caption', 'Caption', 'title', 'Title']),
      rawJson: JSON.stringify({ apartment, account: row })
    });
  }

  return dedupe(extracted, (item) => item.externalId);
}

function extractAccruals(account: ApartmentSnapshot, payload: unknown): AccrualSnapshot[] {
  const rows = findObjectsAtKeys(payload, ['accruals', 'Accruals']);
  const sourceRows = rows.length ? rows : collectObjects(payload);

  return dedupe(sourceRows
    .map((row) => {
      const periodId = pickString(row, ['periodId', 'PeriodId', 'period', 'Period', 'month', 'Month']);
      const periodLabel = periodId ?? pickString(row, ['name', 'Name', 'caption', 'Caption']) ?? 'unknown';

      const initialBalance = pickString(row, ['initialBalance', 'InitialBalance']);
      const accruedAmount = pickString(row, ['accruedAmount', 'AccruedAmount', 'amount', 'Amount', 'sum', 'Sum', 'value']);
      const fine = pickString(row, ['fine', 'Fine']);
      const amountToPay = pickString(row, ['amountToPay', 'AmountToPay']);
      const paidAmount = pickString(row, ['paidAmount', 'PaidAmount']);
      const hasInvoice = pickString(row, ['hasInvoice', 'HasInvoice']);
      const buttonInvoice = pickString((row.button && typeof row.button === 'object' ? row.button : {}) as Record<string, unknown>, ['invoice']);
      const buttonPay = pickString((row.button && typeof row.button === 'object' ? row.button : {}) as Record<string, unknown>, ['pay']);
      const buttonToPay = pickString((row.button && typeof row.button === 'object' ? row.button : {}) as Record<string, unknown>, ['toPay']);
      const buttonMessage = pickString((row.button && typeof row.button === 'object' ? row.button : {}) as Record<string, unknown>, ['message', 'Message']);

      const amountText = [
        initialBalance ? `initialBalance=${initialBalance}` : null,
        accruedAmount ? `accruedAmount=${accruedAmount}` : null,
        fine ? `fine=${fine}` : null,
        amountToPay ? `amountToPay=${amountToPay}` : null,
        paidAmount ? `paidAmount=${paidAmount}` : null
      ].filter(Boolean).join(', ');

      const statusText = [
        hasInvoice ? `hasInvoice=${hasInvoice}` : null,
        buttonInvoice ? `button.invoice=${buttonInvoice}` : null,
        buttonPay ? `button.pay=${buttonPay}` : null,
        buttonToPay ? `button.toPay=${buttonToPay}` : null,
        buttonMessage ? `button.message=${buttonMessage}` : null
      ].filter(Boolean).join(', ');

      return {
        apartmentExternalId: account.externalId,
        parentApartmentId: account.parentApartmentId,
        periodLabel,
        periodId,
        amountText: amountText || undefined,
        statusText: statusText || undefined,
        sourceUrl: undefined,
        fingerprint: buildFingerprint('accrual', account.externalId, periodId ?? periodLabel, amountText, statusText),
        rawJson: JSON.stringify({ account, accrual: row })
      };
    })
    .filter((item) => item.periodLabel !== 'unknown' || item.amountText || item.statusText), (item) => item.fingerprint);
}

function collectObjects(payload: unknown): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  visit(payload);
  return results;

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (Object.values(record).some((entry) => ['string', 'number', 'boolean'].includes(typeof entry))) {
        results.push(record);
      }
      for (const nested of Object.values(record)) visit(nested);
    }
  }
}

function pickString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

function findObjectsAtKeys(payload: unknown, keys: string[]): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  visit(payload);
  return results;

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    if (!value || typeof value !== 'object') return;

    const record = value as Record<string, unknown>;
    for (const key of keys) {
      const nested = record[key];
      if (Array.isArray(nested)) {
        for (const item of nested) {
          if (item && typeof item === 'object') results.push(item as Record<string, unknown>);
        }
      }
    }

    for (const nested of Object.values(record)) visit(nested);
  }
}

function applyPathParams(endpoint: string, params: Record<string, string>): string {
  let value = endpoint;
  for (const [key, paramValue] of Object.entries(params)) {
    value = value.replaceAll(`{${key}}`, encodeURIComponent(paramValue));
  }
  return value;
}

function buildFingerprint(...parts: string[]): string {
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

function dedupe<T>(items: T[], getKey: (item: T) => string): T[] {
  const map = new Map<string, T>();
  for (const item of items) map.set(getKey(item), item);
  return [...map.values()];
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-+|-+$/g, '');
}

function formatApartment(apartment: ApartmentSnapshot): string {
  return [apartment.externalId, apartment.address, apartment.organization].filter(Boolean).join(' | ');
}
