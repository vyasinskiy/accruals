import fs from 'node:fs';
import type { BrowserContext, Page } from 'playwright';
import { config } from '../../config';
import type { AccrualSnapshot, ApartmentSnapshot, AccountSnapshot, InvoiceSnapshot, ScanResult } from '../../types';

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
    
    let browser: any;
    let context: BrowserContext;
    
    if (config.BROWSER_PROFILE_PATH && !config.BROWSER_WS_ENDPOINT) {
      context = await chromium.launchPersistentContext(config.BROWSER_PROFILE_PATH, {
        headless: config.HEADLESS,
        acceptDownloads: true
      });
      browser = null;
    } else {
      browser = config.BROWSER_WS_ENDPOINT
        ? await chromium.connectOverCDP(config.BROWSER_WS_ENDPOINT)
        : await chromium.launch({ headless: config.HEADLESS });
      
      context = await browser.newContext({
        storageState: fs.existsSync(config.storageStatePath) ? config.storageStatePath : undefined,
        acceptDownloads: true
      });
    }

    const page = await context.newPage();
    const log = filters.log ?? (() => undefined);

    try {
      await page.goto(config.ACCOUNT_PAGE_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(config.WAIT_AFTER_NAV_MS);

      if (await this.isLoginRequired(page)) {
        return {
          apartments: [],
          accounts: [],
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
      const rawApartments = apartmentPayload ? extractApartments(apartmentPayload) : [];
      if (!apartmentPayload) {
        return {
          apartments: [],
          accounts: [],
          accruals: [],
          invoices: [],
          needsLogin: false,
          degraded: true,
          message: warnings.join(' ')
        };
      }
      log(`Apartments discovered from /new-web/apartments: ${rawApartments.length}`);

      const selectedApartments = filters.apartmentExternalIds?.length
        ? rawApartments.filter((item) => filters.apartmentExternalIds?.includes(item.externalId))
        : rawApartments;
      log(`Apartments selected for scan: ${selectedApartments.length}`);

      const apartments: ApartmentSnapshot[] = [];
      const accountSnapshots: AccountSnapshot[] = [];
      const accruals: AccrualSnapshot[] = [];
      const invoices: InvoiceSnapshot[] = [];

      for (const apartment of selectedApartments) {
        try {
          apartments.push(apartment);
          log(`Apartment found: ${formatApartment(apartment)}`);
          
          const infoPayload = await this.fetchJson(page, config.endpoints.apartmentInfo, {}, { apartmentId: apartment.externalId });
          const accounts = extractAccounts(apartment, infoPayload);
          log(`Accounts found for apartment ${apartment.externalId}: ${accounts.length}`);

          for (const account of accounts) {
            accountSnapshots.push(account);
            log(`Scanning account ${account.externalId} for apartment ${apartment.externalId}`);

            const accrualPayload = await this.fetchJson(page, config.endpoints.accruals, { accountId: account.externalId });
            const accountAccruals = extractAccruals(account, accrualPayload);
            accruals.push(...accountAccruals);
            log(`Accrual periods found for account ${account.externalId}: ${accountAccruals.length}`);

            for (const accrual of accountAccruals) {
                const invoiceUrl = new URL(config.endpoints.invoice, config.API_BASE_URL);
                invoiceUrl.searchParams.set('AccountId', account.externalId);
                invoiceUrl.searchParams.set('PeriodId', accrual.periodId);
                
                invoices.push({
                    accountExternalId: account.externalId,
                    periodLabel: accrual.periodLabel,
                    periodId: accrual.periodId,
                    invoiceUrl: invoiceUrl.toString(),
                    utilitiesUrl: undefined,
                    available: true,
                    uploadedToS3: false,
                    rawJson: JSON.stringify({
                        accountId: account.externalId,
                        apartmentExternalId: apartment.externalId,
                        periodId: accrual.periodId,
                        invoiceUrl: invoiceUrl.toString()
                    })
                });
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          warnings.push(`Apartment ${apartment.externalId}: ${errorMessage}`);
          log(`Apartment ${apartment.externalId} failed: ${errorMessage}`);
        }
      }

      return {
        apartments: dedupe(apartments, (item) => item.externalId),
        accounts: dedupe(accountSnapshots, (item) => item.externalId),
        accruals: dedupe(accruals, (item) => `${item.accountExternalId}_${item.periodId}`),
        invoices: dedupe(invoices, (item) => `${item.accountExternalId}_${item.periodId}`),
        needsLogin: false,
        degraded: warnings.length > 0,
        message: warnings.length
          ? `Scanned ${selectedApartments.length} apartment(s), ${accountSnapshots.length} account(s). Warnings: ${warnings.join(' ')}`
          : `Scanned ${selectedApartments.length} apartment(s), ${accountSnapshots.length} account(s).`
      };
    } finally {
      if (browser) {
        await browser.close();
      } else if (context) {
        await context.close();
      }
    }
  }

  async downloadInvoice(url: string): Promise<Buffer> {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: config.HEADLESS });
    const context = await browser.newContext({
      storageState: fs.existsSync(config.storageStatePath) ? config.storageStatePath : undefined
    });
    const page = await context.newPage();
    try {
      const response = await page.request.get(url, {
        headers: { accept: 'application/pdf, application/octet-stream, */*' }
      });
      if (!response.ok()) {
        throw new Error(`Failed to download invoice: ${response.status()}`);
      }
      return await response.body();
    } finally {
      await browser.close();
    }
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
}

async function waitForEnter(): Promise<void> {
  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', () => resolve());
  });
}

function extractApartments(payload: unknown): ApartmentSnapshot[] {
  const rows = collectObjects(payload);
  const results: ApartmentSnapshot[] = [];

  for (const row of rows) {
    const externalId = pickString(row, ['id', 'Id', 'apartmentId', 'apartment_id']);
    if (!externalId) continue;

    results.push({
      externalId,
      address: pickString(row, ['address', 'Address', 'fullAddress', 'houseAddress']),
      organization: pickString(row, ['organization', 'Organization', 'company', 'managementCompany']),
      rawJson: JSON.stringify(row)
    });
  }

  return dedupe(results, (item) => item.externalId);
}

function extractAccounts(apartment: ApartmentSnapshot, payload: unknown): AccountSnapshot[] {
  const accounts = findObjectsAtKeys(payload, ['accounts', 'Accounts']);
  const rows = accounts.length ? accounts : collectObjects(payload);
  const extracted: AccountSnapshot[] = [];

  for (const row of rows) {
    const accountId = pickString(row, ['id', 'Id', 'accountId', 'account_id', 'ls', 'personalAccount']);
    if (!accountId) continue;
    extracted.push({
      externalId: accountId,
      apartmentExternalId: apartment.externalId,
      accountNumber: pickString(row, ['number', 'Number', 'accountNumber', 'AccountNumber', 'ls', 'personalAccount']) ?? accountId,
      accountLabel: pickString(row, ['name', 'Name', 'caption', 'Caption', 'title', 'Title']),
      rawJson: JSON.stringify({ apartment, account: row })
    });
  }

  return dedupe(extracted, (item) => item.externalId);
}

function extractAccruals(account: AccountSnapshot, payload: unknown): AccrualSnapshot[] {
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

      const finalPeriodId = periodId ?? periodLabel;

      return {
        accountExternalId: account.externalId,
        periodLabel,
        periodId: finalPeriodId,
        amountText: amountText || undefined,
        statusText: statusText || undefined,
        sourceUrl: undefined,
        rawJson: JSON.stringify({ account, accrual: row })
      };
    })
    .filter((item) => item.periodLabel !== 'unknown' || item.amountText || item.statusText), (item) => `${item.accountExternalId}_${item.periodId}`);
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

function dedupe<T>(items: T[], getKey: (item: T) => string): T[] {
  const map = new Map<string, T>();
  for (const item of items) map.set(getKey(item), item);
  return [...map.values()];
}

function formatApartment(apartment: ApartmentSnapshot): string {
  return [apartment.externalId, apartment.address, apartment.organization].filter(Boolean).join(' | ');
}
