import fs from 'node:fs';
import path from 'node:path';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApartmentsService } from '../../common/services/apartments.service';
import { config } from '../../config';
import { QueryAccrualsDto } from './dto/query-accruals.dto';
import { QueryApartmentsDto } from './dto/query-apartments.dto';
import { QueryInvoicesDto } from './dto/query-invoices.dto';

@Injectable()
export class ApiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly apartmentsService: ApartmentsService
  ) {}

  getApartments(query: QueryApartmentsDto) {
    return this.apartmentsService.findMany(query);
  }

  getApartment(id: number) {
    return this.prisma.apartment.findUnique({
      where: { id },
      include: {
        accruals: { orderBy: [{ periodLabel: 'desc' }, { id: 'desc' }], take: 20 },
        invoices: { orderBy: [{ periodLabel: 'desc' }, { id: 'desc' }], take: 20 }
      }
    });
  }

  getAccruals(query: QueryAccrualsDto) {
    const where: Prisma.AccrualWhereInput = {
      ...(query.apartmentId ? { apartmentId: query.apartmentId } : {}),
      ...(query.apartmentExternalId ? { apartmentExternalId: query.apartmentExternalId } : {}),
      ...(query.periodLabel ? { periodLabel: { contains: query.periodLabel, mode: 'insensitive' } } : {})
    };

    return this.prisma.accrual.findMany({
      where,
      include: { apartment: true },
      orderBy: [{ periodLabel: 'desc' }, { id: 'desc' }]
    });
  }

  getInvoices(query: QueryInvoicesDto) {
    const where: Prisma.InvoiceWhereInput = {
      ...(query.apartmentId ? { apartmentId: query.apartmentId } : {}),
      ...(query.apartmentExternalId ? { apartmentExternalId: query.apartmentExternalId } : {}),
      ...(query.periodLabel ? { periodLabel: { contains: query.periodLabel, mode: 'insensitive' } } : {}),
      ...(typeof query.available === 'boolean' ? { available: query.available } : {})
    };

    return this.prisma.invoice.findMany({
      where,
      include: { apartment: true },
      orderBy: [{ periodLabel: 'desc' }, { id: 'desc' }]
    });
  }

  async getInvoiceByApartmentAndPeriod(apartmentExternalId: string, period: string) {
    const normalizedPeriod = normalizePeriod(period);
    const apartment = await this.prisma.apartment.findFirst({ where: { externalId: apartmentExternalId } });
    if (!apartment) {
      throw new NotFoundException(`Apartment/account ${apartmentExternalId} not found`);
    }

    const invoice = await this.prisma.invoice.findFirst({
      where: {
        apartmentExternalId,
        OR: [{ periodLabel: normalizedPeriod }, { periodLabel: period }]
      },
      include: { apartment: true }
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice for ${apartmentExternalId} and period ${period} not found`);
    }

    const filePath = resolveExistingFile(invoice.localFilePath);

    return {
      apartment,
      invoice,
      periodRequested: period,
      periodNormalized: normalizedPeriod,
      fileExists: Boolean(filePath),
      filePath,
      filename: filePath ? path.basename(filePath) : null
    };
  }

  getRuns() {
    return this.prisma.run.findMany({ orderBy: { id: 'desc' }, take: 20 });
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
