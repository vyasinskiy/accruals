import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import { config } from '../../config';
import type { AccrualSnapshot, ApartmentSnapshot, InvoiceSnapshot, ScanResult } from '../../types';

export class KvartplataAdapter {
  async bootstrap(): Promise<void> {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();

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

  async scan(filters: { apartmentExternalIds?: string[] } = {}): Promise<ScanResult> {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: config.HEADLESS });
    const context = await browser.newContext({
      storageState: config.storageStatePath,
      acceptDownloads: config.DOWNLOAD_RECEIPTS
    });
    const page = await context.newPage();

    try {
      await page.goto(config.ACCOUNT_PAGE_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(config.WAIT_AFTER_NAV_MS);

      if (await this.isLoginRequired(page)) {
        return {
          apartments: [],
          accruals: [],
          invoices: [],
          needsLogin: true,
          message: 'Saved session is missing or expired; manual bootstrap is required.'
        };
      }

      const apartmentPayload = await this.fetchJson(page, config.endpoints.apartments);
      const apartments = extractApartments(apartmentPayload);
      const selectedApartments = filters.apartmentExternalIds?.length
        ? apartments.filter((item) => filters.apartmentExternalIds?.includes(item.externalId))
        : apartments;

      const accruals: AccrualSnapshot[] = [];
      const invoices: InvoiceSnapshot[] = [];

      for (const apartment of selectedApartments) {
        const accrualPayload = await this.fetchJson(page, config.endpoints.accruals, { apartmentId: apartment.externalId });
        const utilityPayload = await this.fetchJson(page, config.endpoints.utilities, { apartmentId: apartment.externalId }).catch(() => null);
        const apartmentAccruals = extractAccruals(apartment.externalId, accrualPayload);
        const apartmentInvoices = await this.extractInvoices(page, apartment.externalId, apartmentAccruals, utilityPayload);
        accruals.push(...apartmentAccruals);
        invoices.push(...apartmentInvoices);
      }

      return {
        apartments: selectedApartments,
        accruals,
        invoices,
        needsLogin: false,
        message: `Scanned ${selectedApartments.length} apartment(s), ${accruals.length} accrual row(s), ${invoices.length} invoice row(s).`
      };
    } finally {
      await browser.close();
    }
  }

  private async extractInvoices(
    page: Page,
    apartmentExternalId: string,
    accruals: AccrualSnapshot[],
    utilityPayload: unknown
  ): Promise<InvoiceSnapshot[]> {
    const utilityMap = buildUtilityMap(utilityPayload);
    const results: InvoiceSnapshot[] = [];

    for (const accrual of accruals) {
      const invoicePayload = await this.fetchJson(page, config.endpoints.invoice, {
        apartmentId: apartmentExternalId,
        period: accrual.periodLabel
      }).catch(() => null);

      const invoiceUrl = findFirstUrl(invoicePayload) ?? utilityMap.get(accrual.periodLabel);
      const downloaded = config.DOWNLOAD_RECEIPTS && invoiceUrl
        ? await this.tryDownloadInvoice(page.context(), invoiceUrl, apartmentExternalId, accrual.periodLabel)
        : false;

      results.push({
        apartmentExternalId,
        periodLabel: accrual.periodLabel,
        invoiceUrl: invoiceUrl ?? undefined,
        utilitiesUrl: utilityMap.get(accrual.periodLabel) ?? undefined,
        available: Boolean(invoiceUrl || utilityMap.get(accrual.periodLabel)),
        downloaded,
        fingerprint: buildFingerprint('invoice', apartmentExternalId, accrual.periodLabel, invoiceUrl ?? '', utilityMap.get(accrual.periodLabel) ?? ''),
        rawJson: JSON.stringify({ invoicePayload, utilityPayload })
      });
    }

    return dedupe(results, (item) => item.fingerprint);
  }

  private async fetchJson(page: Page, endpoint: string, params: Record<string, string> = {}): Promise<unknown> {
    const url = new URL(endpoint, config.API_BASE_URL);
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

  private async tryDownloadInvoice(context: BrowserContext, invoiceUrl: string, apartmentId: string, periodLabel: string): Promise<boolean> {
    try {
      const page = await context.newPage();
      const response = await page.goto(invoiceUrl, { waitUntil: 'domcontentloaded' });
      if (!response?.ok()) return false;
      const buffer = await response.body();
      const safeName = `${slug(apartmentId)}-${slug(periodLabel)}.pdf`;
      await fs.mkdir(config.receiptDownloadDir, { recursive: true });
      await fs.writeFile(path.join(config.receiptDownloadDir, safeName), buffer);
      await page.close();
      return true;
    } catch {
      return false;
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
    externalId: pickString(row, ['id', 'Id', 'accountId', 'account_id', 'ls', 'personalAccount']) ?? crypto.createHash('md5').update(JSON.stringify(row)).digest('hex'),
    address: pickString(row, ['address', 'Address', 'fullAddress', 'houseAddress']),
    organization: pickString(row, ['organization', 'Organization', 'company', 'managementCompany']),
    accountNumber: pickString(row, ['accountNumber', 'AccountNumber', 'ls', 'personalAccount']),
    rawJson: JSON.stringify(row)
  })), (item) => item.externalId);
}

function extractAccruals(apartmentExternalId: string, payload: unknown): AccrualSnapshot[] {
  return dedupe(collectObjects(payload)
    .map((row) => {
      const periodLabel = pickString(row, ['period', 'Period', 'month', 'Month', 'name']) ?? 'unknown';
      const amountText = pickString(row, ['amount', 'Amount', 'sum', 'Sum', 'value']);
      const statusText = pickString(row, ['status', 'Status', 'state']);
      const sourceUrl = findFirstUrl(row) ?? undefined;
      return {
        apartmentExternalId,
        periodLabel,
        amountText,
        statusText,
        sourceUrl,
        fingerprint: buildFingerprint('accrual', apartmentExternalId, periodLabel, amountText ?? '', statusText ?? '', sourceUrl ?? ''),
        rawJson: JSON.stringify(row)
      };
    })
    .filter((item) => item.periodLabel !== 'unknown' || item.amountText || item.statusText), (item) => item.fingerprint);
}

function buildUtilityMap(payload: unknown): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of collectObjects(payload)) {
    const periodLabel = pickString(row, ['period', 'Period', 'month', 'Month', 'name']);
    const url = findFirstUrl(row);
    if (periodLabel && url) map.set(periodLabel, url);
  }
  return map;
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

function findFirstUrl(payload: unknown): string | undefined {
  if (typeof payload === 'string') {
    return /^https?:\/\//.test(payload) ? payload : undefined;
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const url = findFirstUrl(item);
      if (url) return url;
    }
    return undefined;
  }

  if (payload && typeof payload === 'object') {
    for (const [key, value] of Object.entries(payload)) {
      if (typeof value === 'string' && key.toLowerCase().includes('url') && /^https?:\/\//.test(value)) {
        return value;
      }
      const nested = findFirstUrl(value);
      if (nested) return nested;
    }
  }

  return undefined;
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
