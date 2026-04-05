import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApartmentsService } from '../../common/services/apartments.service';
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

  getRuns() {
    return this.prisma.run.findMany({ orderBy: { id: 'desc' }, take: 20 });
  }
}
