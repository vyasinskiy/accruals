import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ApartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  getById(id: number) {
    return this.prisma.apartment.findUnique({ where: { id } });
  }

  getByExternalId(externalId: string) {
    return this.prisma.apartment.findUnique({ where: { externalId } });
  }

  findMany(filters: { address?: string; organization?: string; accountNumber?: string; externalId?: string }) {
    const where: Prisma.ApartmentWhereInput = {
      ...(filters.externalId ? { externalId: { contains: filters.externalId, mode: 'insensitive' } } : {}),
      ...(filters.address ? { address: { contains: filters.address, mode: 'insensitive' } } : {}),
      ...(filters.organization ? { organization: { contains: filters.organization, mode: 'insensitive' } } : {}),
      ...(filters.accountNumber ? { accountNumber: { contains: filters.accountNumber, mode: 'insensitive' } } : {})
    };

    return this.prisma.apartment.findMany({
      where,
      orderBy: [{ organization: 'asc' }, { address: 'asc' }, { externalId: 'asc' }]
    });
  }
}
