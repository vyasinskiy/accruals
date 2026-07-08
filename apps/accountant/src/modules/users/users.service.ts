import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { config } from '../../common/config/config';

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    if (config.SUPER_ADMIN_TELEGRAM_ID) {
      const tgId = BigInt(config.SUPER_ADMIN_TELEGRAM_ID);

      const user = await this.prisma.user.findUnique({
        where: { telegramId: tgId }
      });

      if (!user) {
        await this.prisma.user.create({
          data: {
            name: 'Super Admin',
            role: 'admin',
            telegramId: tgId
          },
        });
        this.logger.log(`Super Admin user created with Telegram ID: ${tgId}`);
      } else if (user.role !== 'admin') {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { role: 'admin' },
        });
        this.logger.log(`Updated user ${tgId} role to admin`);
      }
    }
  }

  async getAdmins() {
    return this.prisma.user.findMany({
      where: { role: 'admin' },
    });
  }

  private serialize(data: any): any {
    if (!data) return data;
    return JSON.parse(JSON.stringify(data, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    ));
  }

  async getAllUsers() {
    const users = await this.prisma.user.findMany({
      include: { 
        tenantProfile: { include: { apartment: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    return this.serialize(users);
  }

  async deleteUser(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId }
    });

    if (user?.telegramId && user.telegramId.toString() === config.SUPER_ADMIN_TELEGRAM_ID) {
      throw new Error('Cannot delete Super Admin user');
    }

    const deletedUser = await this.prisma.user.delete({
      where: { id: userId }
    });
    return this.serialize(deletedUser);
  }

  async deleteUserByTelegramId(telegramId: string) {
    if (telegramId === config.SUPER_ADMIN_TELEGRAM_ID) {
      throw new Error('Cannot delete Super Admin user');
    }

    const user = await this.prisma.user.findUnique({
      where: { telegramId: BigInt(telegramId) }
    });

    if (!user) return null;

    const deletedUser = await this.prisma.user.delete({
      where: { id: user.id }
    });
    return this.serialize(deletedUser);
  }

  async findByTelegramId(telegramId: string | number | bigint) {
    const user = await this.prisma.user.findUnique({
      where: { telegramId: BigInt(telegramId) },
      include: { tenantProfile: true }
    });
    return user ? this.serialize(user) : null;
  }
}
