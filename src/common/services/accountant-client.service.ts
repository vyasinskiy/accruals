import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { config } from '../../config';

@Injectable()
export class AccountantClientService {
  constructor(
    @Inject('ACCOUNTANT_SERVICE') private readonly accountantClient: ClientProxy
  ) {}

  async findApartments(filters: { address?: string; organization?: string; accountNumber?: string; externalId?: string }) {
    const url = new URL('/accountant/apartments', config.ACCOUNTANT_API_URL);
    Object.entries(filters).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value);
    });
    
    const response = await fetch(url.toString());
    if (!response.ok) throw new Error(`Accountant API error: ${response.statusText}`);
    return response.json();
  }

  async findApartmentById(id: number) {
    const url = new URL(`/accountant/apartments/${id}`, config.ACCOUNTANT_API_URL);
    const response = await fetch(url.toString());
    if (!response.ok) throw new Error(`Accountant API error: ${response.statusText}`);
    return response.json();
  }

  async findAccruals(filters: { apartmentId?: number; apartmentExternalId?: string; periodLabel?: string }) {
    const url = new URL('/accountant/accruals', config.ACCOUNTANT_API_URL);
    Object.entries(filters).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, String(value));
    });

    const response = await fetch(url.toString());
    if (!response.ok) throw new Error(`Accountant API error: ${response.statusText}`);
    return response.json();
  }

  async findInvoices(filters: { apartmentId?: number; apartmentExternalId?: string; periodLabel?: string; available?: boolean }) {
    const url = new URL('/accountant/invoices', config.ACCOUNTANT_API_URL);
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined) url.searchParams.set(key, String(value));
    });

    const response = await fetch(url.toString());
    if (!response.ok) throw new Error(`Accountant API error: ${response.statusText}`);
    return response.json();
  }

  async getApartmentByExternalId(externalId: string) {
    const results = await this.findApartments({ externalId });
    return results[0] || null;
  }

  async getUploadUrl(apartmentExternalId: string, periodLabel: string): Promise<{ url: string; key: string }> {
    const url = new URL('/accountant/invoices/upload-url', config.ACCOUNTANT_API_URL);
    url.searchParams.set('apartmentExternalId', apartmentExternalId);
    url.searchParams.set('periodLabel', periodLabel);

    const response = await fetch(url.toString());
    if (!response.ok) throw new Error(`Accountant API error: ${response.statusText}`);
    return response.json();
  }
}
