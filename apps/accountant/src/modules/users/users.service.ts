import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { config } from '../../common/config/config';

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    if (config.SUPER_ADMIN_TELEGRAM_ID) {
      const telegramId = BigInt(config.SUPER_ADMIN_TELEGRAM_ID);
      
      const admin = await this.prisma.user.findUnique({
        where: { telegramId },
      });

      if (!admin) {
        await this.prisma.user.create({
          data: {
            telegramId,
            name: 'Super Admin',
            role: 'admin',
          },
        });
        this.logger.log(`Super Admin user created with Telegram ID: ${config.SUPER_ADMIN_TELEGRAM_ID}`);
      } else if (admin.role !== 'admin') {
        await this.prisma.user.update({
          where: { telegramId },
          data: { role: 'admin' },
        });
        this.logger.log(`Updated user ${config.SUPER_ADMIN_TELEGRAM_ID} role to admin`);
      }
    }
  }

  async getAdmins() {
    return this.prisma.user.findMany({
      where: { role: 'admin' },
    });
  }

  async findByTelegramId(telegramId: string | number | bigint) {
    return this.prisma.user.findUnique({
      where: { telegramId: BigInt(telegramId) },
      include: { tenantProfile: true }
    });
  }
}
