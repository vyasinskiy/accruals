import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { config } from '../../common/config/config';

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    const admin = await this.prisma.user.findFirst({
      where: { role: 'admin' }
    });

    if (!admin) {
      await this.prisma.user.create({
        data: {
          name: 'Super Admin',
          role: 'admin'
        },
      });
      this.logger.log('Super Admin user created in DB');
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

    if (user?.role === 'admin') {
      throw new Error('Cannot delete Admin user');
    }

    const deletedUser = await this.prisma.user.delete({
      where: { id: userId }
    });
    return this.serialize(deletedUser);
  }

  async deleteTenantById(tenantId: number) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId }
    });

    if (!tenant) return null;

    const deletedUser = await this.prisma.user.delete({
      where: { id: tenant.userId }
    });
    return this.serialize(deletedUser);
  }
}
