import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { BrowserContext, Page } from 'playwright';
import { config } from './config';
import type { AccountSnapshot, ReceiptSnapshot } from './types';

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

    const loginNeeded = await this.isLoginRequired(page);
    if (loginNeeded) {
      await browser.close();
      throw new Error('Login still appears required. Session state was not saved.');
    }

    await context.storageState({ path: config.storageStatePath });
    await browser.close();
  }

  async scan(): Promise<{ accounts: AccountSnapshot[]; receipts: ReceiptSnapshot[]; needsLogin: boolean; message: string }> {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: config.HEADLESS });
    const context = await browser.newContext({
      storageState: config.storageStatePath,
      acceptDownloads: config.DOWNLOAD_RECEIPTS
    });
    const page = await context.newPage();

    try {
      await page.goto(config.ACCOUNT_PAGE_URL || config.APP_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(config.WAIT_AFTER_NAV_MS);

      if (await this.isLoginRequired(page)) {
        return { accounts: [], receipts: [], needsLogin: true, message: 'Saved session is missing or expired; manual bootstrap is required.' };
      }

      const accounts = await this.collectAccounts(page);
      const receipts: ReceiptSnapshot[] = [];

      for (const account of accounts) {
        const accountReceipts = await this.collectReceiptsForAccount(context, account);
        receipts.push(...accountReceipts);
      }

      return {
        accounts,
        receipts,
        needsLogin: false,
        message: `Scanned ${accounts.length} account(s) and observed ${receipts.length} receipt row(s).`
      };
    } finally {
      await browser.close();
    }
  }

  private async isLoginRequired(page: Page): Promise<boolean> {
    const bodyText = (await page.textContent('body'))?.toLowerCase() ?? '';
    return config.sessionRequiredKeywords.some((keyword) => bodyText.includes(keyword));
  }

  private async collectAccounts(page: Page): Promise<AccountSnapshot[]> {
    const currentUrl = page.url();
    const cards = page.locator(config.ACCOUNT_CARD_SELECTOR);
    const count = await cards.count();

    if (count === 0) {
      return [{ externalId: 'default-account', name: 'Default account', url: config.CHARGES_PAGE_URL || currentUrl }];
    }

    const accounts: AccountSnapshot[] = [];
    for (let i = 0; i < count; i += 1) {
      const card = cards.nth(i);
      const name = clean(await firstText(card, config.ACCOUNT_NAME_SELECTOR)) || `Account ${i + 1}`;
      const externalId = clean(await firstText(card, config.ACCOUNT_ID_SELECTOR)) || slug(name) || `account-${i + 1}`;
      const href = await firstHref(card, config.ACCOUNT_LINK_SELECTOR);
      accounts.push({ externalId, name, url: href ? new URL(href, currentUrl).toString() : undefined });
    }

    return dedupeAccounts(accounts);
  }

  private async collectReceiptsForAccount(context: BrowserContext, account: AccountSnapshot): Promise<ReceiptSnapshot[]> {
    const page = await context.newPage();

    try {
      const targetUrl = account.url || config.CHARGES_PAGE_URL || config.APP_URL;
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(config.WAIT_AFTER_NAV_MS);

      const chargesTab = page.locator(config.CHARGES_TAB_SELECTOR).first();
      if (await chargesTab.count()) {
        await chargesTab.click({ timeout: 3000 }).catch(() => undefined);
        await page.waitForTimeout(config.WAIT_AFTER_NAV_MS);
      }

      const rows = page.locator(config.ROW_SELECTOR);
      const rowCount = await rows.count();
      const results: ReceiptSnapshot[] = [];

      for (let i = 0; i < rowCount; i += 1) {
        const row = rows.nth(i);
        const monthLabel = clean(await firstText(row, config.MONTH_SELECTOR));
        const amountText = clean(await firstText(row, config.AMOUNT_SELECTOR));
        const statusText = clean(await firstText(row, config.STATUS_SELECTOR));
        const receiptButton = row.locator(config.RECEIPT_BUTTON_SELECTOR).first();
        const receiptAvailable = (await receiptButton.count()) > 0;
        const receiptUrl = receiptAvailable ? await receiptButton.getAttribute('href').catch(() => null) : null;
        const observedAt = new Date().toISOString();

        if (!monthLabel && !amountText) {
          continue;
        }

        let receiptDownloaded = false;
        if (config.DOWNLOAD_RECEIPTS && receiptAvailable) {
          receiptDownloaded = await this.tryDownloadReceipt(page, receiptButton, account.externalId, monthLabel || `row-${i + 1}`);
        }

        const raw = { account, monthLabel, amountText, statusText, receiptAvailable, receiptUrl };
        results.push({
          accountExternalId: account.externalId,
          monthLabel: monthLabel || `row-${i + 1}`,
          amountText: amountText || 'unknown',
          statusText: statusText || undefined,
          receiptAvailable,
          receiptUrl: receiptUrl ? new URL(receiptUrl, page.url()).toString() : undefined,
          receiptDownloaded,
          fingerprint: this.buildFingerprint(account.externalId, monthLabel, amountText, statusText, receiptUrl),
          observedAt,
          rawJson: JSON.stringify(raw)
        });
      }

      return results;
    } finally {
      await page.close();
    }
  }

  private buildFingerprint(accountId: string, monthLabel?: string, amountText?: string, statusText?: string, receiptUrl?: string | null): string {
    return crypto.createHash('sha256').update([accountId, monthLabel, amountText, statusText, receiptUrl ?? ''].join('|')).digest('hex');
  }

  private async tryDownloadReceipt(page: Page, button: ReturnType<Page['locator']>, accountId: string, monthLabel: string): Promise<boolean> {
    try {
      const downloadPromise = page.waitForEvent('download', { timeout: 5000 });
      await button.click();
      const download = await downloadPromise;
      const safeName = `${slug(accountId)}-${slug(monthLabel)}${path.extname(download.suggestedFilename()) || '.pdf'}`;
      const fullPath = path.join(config.receiptDownloadDir, safeName);
      await fs.mkdir(config.receiptDownloadDir, { recursive: true });
      await download.saveAs(fullPath);
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

async function firstText(scope: Page | ReturnType<Page['locator']>, selector: string): Promise<string | null> {
  const loc = scope.locator(selector).first();
  if (!(await loc.count())) return null;
  return await loc.textContent();
}

async function firstHref(scope: ReturnType<Page['locator']>, selector: string): Promise<string | null> {
  const link = scope.locator(selector).first();
  if (!(await link.count())) return null;
  return link.getAttribute('href');
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-+|-+$/g, '');
}

function clean(value: string | null | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

function dedupeAccounts(accounts: AccountSnapshot[]): AccountSnapshot[] {
  const map = new Map<string, AccountSnapshot>();
  for (const account of accounts) {
    map.set(account.externalId, account);
  }
  return [...map.values()];
}
