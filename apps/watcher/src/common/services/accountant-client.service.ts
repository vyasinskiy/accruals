import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { config } from '../../config';

@Injectable()
export class AccountantClientService {
  constructor(
    @Inject('ACCOUNTANT_SERVICE') private readonly accountantClient: ClientProxy
  ) {}

  async findApartments(filters: { address?: string; organization?: string; externalId?: string }) {
    const url = new URL('/accountant/apartments', config.ACCOUNTANT_API_URL);
    Object.entries(filters).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value);
    });
    
    try {
      const response = await fetch(url.toString());
      if (!response.ok) throw new Error(`Status: ${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error: any) {
      throw new Error(`Failed to fetch apartments from ${url}: ${this.formatError(error)}`);
    }
  }

  async findAccounts(filters: { apartmentExternalId?: string; accountNumber?: string; externalId?: string }) {
    const url = new URL('/accountant/accounts', config.ACCOUNTANT_API_URL);
    Object.entries(filters).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value);
    });
    
    try {
      const response = await fetch(url.toString());
      if (!response.ok) throw new Error(`Status: ${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error: any) {
      throw new Error(`Failed to fetch accounts from ${url}: ${this.formatError(error)}`);
    }
  }

  async findAccruals(filters: { accountExternalId?: string; periodLabel?: string }) {
    const url = new URL('/accountant/accruals', config.ACCOUNTANT_API_URL);
    Object.entries(filters).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, String(value));
    });

    try {
      const response = await fetch(url.toString());
      if (!response.ok) throw new Error(`Status: ${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error: any) {
      throw new Error(`Failed to fetch accruals from ${url}: ${this.formatError(error)}`);
    }
  }

  async findInvoices(filters: { accountExternalId?: string | string[]; periodId?: string; periodLabel?: string; available?: boolean; uploadedToS3?: boolean }) {
    const url = new URL('/accountant/invoices', config.ACCOUNTANT_API_URL);
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined) {
        if (Array.isArray(value)) {
          value.forEach(v => url.searchParams.append(key, String(v)));
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    });

    try {
      const response = await fetch(url.toString());
      if (!response.ok) throw new Error(`Status: ${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error: any) {
      throw new Error(`Failed to fetch invoices from ${url}: ${this.formatError(error)}`);
    }
  }

  async getAccountByExternalId(externalId: string) {
    const results = await this.findAccounts({ externalId });
    return results[0] || null;
  }

  async getUploadUrl(accountExternalId: string, periodLabel: string): Promise<{ url: string; key: string }> {
    const url = new URL('/accountant/invoices/upload-url', config.ACCOUNTANT_API_URL);
    url.searchParams.set('accountExternalId', accountExternalId);
    url.searchParams.set('periodLabel', periodLabel);

    try {
      const response = await fetch(url.toString());
      if (!response.ok) throw new Error(`Status: ${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error: any) {
      throw new Error(`Failed to get upload URL from ${url}: ${this.formatError(error)}`);
    }
  }

  private formatError(error: any): string {
    const parts: string[] = [];
    if (error.message) parts.push(error.message);
    if (error.cause) {
      const cause = error.cause;
      if (cause.code) parts.push(`[Code: ${cause.code}]`);
      if (cause.message && cause.message !== error.message) parts.push(`(Cause: ${cause.message})`);
    } else if (error.code) {
        parts.push(`[Code: ${error.code}]`);
    }
    return parts.length > 0 ? parts.join(' ') : 'Unknown error';
  }
}
