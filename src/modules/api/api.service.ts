import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class ApiService {
  constructor(
    private readonly prisma: PrismaService
  ) {}

  getRuns() {
    return this.prisma.run.findMany({
      orderBy: { startedAt: 'desc' },
      take: 20
    });
  }
}
