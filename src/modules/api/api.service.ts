import fs from 'node:fs';
import path from 'node:path';
import { Injectable, NotFoundException } from '@nestjs/common';
import { AccountantClientService } from '../../common/services/accountant-client.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { s3Storage } from '../../common/services/s3-storage.service';
import { config } from '../../config';

@Injectable()
export class ApiService {
  constructor(
    private readonly accountantClient: AccountantClientService,
    private readonly prisma: PrismaService
  ) {}

  async getInvoiceByApartmentAndPeriod(apartmentExternalId: string, period: string) {
    const normalizedPeriod = normalizePeriod(period);
    const apartment = await this.accountantClient.getApartmentByExternalId(apartmentExternalId);
    if (!apartment) {
      throw new NotFoundException(`Apartment/account ${apartmentExternalId} not found`);
    }

    const invoices = await this.accountantClient.findInvoices({
      apartmentExternalId,
    });

    const invoice = invoices.find((inv: any) => 
      inv.periodLabel === normalizedPeriod || inv.periodLabel === period
    );

    if (!invoice) {
      throw new NotFoundException(`Invoice for ${apartmentExternalId} and period ${period} not found`);
    }

    const parsedRaw = safeJsonParse<Record<string, unknown>>(invoice.rawJson);
    const storageKey = typeof parsedRaw?.s3Key === 'string'
      ? parsedRaw.s3Key
      : isS3Key(invoice.localFilePath)
        ? invoice.localFilePath
        : null;
    const filePath = storageKey ? null : resolveExistingFile(invoice.localFilePath);
    const downloadUrl = storageKey ? s3Storage.getSignedDownloadUrl(storageKey) : null;

    return {
      apartment,
      invoice,
      periodRequested: period,
      periodNormalized: normalizedPeriod,
      fileExists: Boolean(filePath || downloadUrl),
      filePath,
      storageKey,
      downloadUrl,
      filename: filePath ? path.basename(filePath) : storageKey ? path.basename(storageKey) : null
    };
  }

  getRuns() {
    return this.prisma.run.findMany({
      orderBy: { startedAt: 'desc' },
      take: 20
    });
  }
}

function normalizePeriod(period: string): string {
  const trimmed = period.trim();
  if (/^\d{6}$/.test(trimmed)) return trimmed;
  if (/^\d{4}-\d{2}$/.test(trimmed)) return trimmed.replace('-', '');
  return trimmed;
}

function resolveExistingFile(filePath?: string | null): string | null {
  if (!filePath) return null;
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(config.rootDir, filePath);
  return fs.existsSync(absolute) ? absolute : null;
}

function isS3Key(value?: string | null): value is string {
  return Boolean(value && !path.isAbsolute(value) && !value.startsWith('.') && value.toLowerCase().endsWith('.pdf'));
}

function safeJsonParse<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
