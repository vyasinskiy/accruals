import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { config } from '../../common/config/config';

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    if (config.SUPER_ADMIN_TELEGRAM_ID) {
      const externalId = config.SUPER_ADMIN_TELEGRAM_ID.toString();

      const identity = await this.prisma.userIdentity.findUnique({
        where: { platform_externalId: { platform: 'telegram', externalId } },
        include: { user: true }
      });

      if (!identity) {
        await this.prisma.user.create({
          data: {
            name: 'Super Admin',
            role: 'admin',
            identities: {
              create: {
                platform: 'telegram',
                externalId
              }
            }
          },
        });
        this.logger.log(`Super Admin user created with Telegram ID: ${externalId}`);
      } else if (identity.user.role !== 'admin') {
        await this.prisma.user.update({
          where: { id: identity.userId },
          data: { role: 'admin' },
        });
        this.logger.log(`Updated user ${externalId} role to admin`);
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
        tenantProfile: { include: { apartment: true } },
        identities: true
      },
      orderBy: { createdAt: 'desc' }
    });
    return this.serialize(users);
  }

  async deleteUser(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { identities: true }
    });

    if (user?.identities.some(i => i.platform === 'telegram' && i.externalId === config.SUPER_ADMIN_TELEGRAM_ID)) {
      throw new Error('Cannot delete Super Admin user');
    }

    const deletedUser = await this.prisma.user.delete({
      where: { id: userId }
    });
    return this.serialize(deletedUser);
  }

  async deleteUserByPlatformIdentity(platform: string, externalId: string) {
    if (platform === 'telegram' && externalId === config.SUPER_ADMIN_TELEGRAM_ID) {
      throw new Error('Cannot delete Super Admin user');
    }

    const identity = await this.prisma.userIdentity.findUnique({
      where: { platform_externalId: { platform, externalId } }
    });

    if (!identity) return null;

    const user = await this.prisma.user.delete({
      where: { id: identity.userId }
    });
    return this.serialize(user);
  }

  async findByTelegramId(telegramId: string | number | bigint) {
    const identity = await this.prisma.userIdentity.findUnique({
      where: { platform_externalId: { platform: 'telegram', externalId: telegramId.toString() } },
      include: { user: { include: { tenantProfile: true } } }
    });
    return identity ? this.serialize(identity.user) : null;
  }
}
