import { Injectable, Logger, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientProxy } from '@nestjs/microservices';

@Injectable()
export class TenantRegistrationService {
  private readonly logger = new Logger(TenantRegistrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject('NOTIFICATIONS_SERVICE') private readonly notificationsClient: ClientProxy
  ) {}

  private serialize(data: any): any {
    if (!data) return data;
    return JSON.parse(JSON.stringify(data, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    ));
  }

  async registerTenant(data: { name: string; telegramId: string | number; platform?: string; apartmentId?: number; rentPaymentDay?: number; phone?: string }) {
    const tgId = BigInt(data.telegramId);

    let user = await this.prisma.user.findUnique({
      where: { telegramId: tgId }
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          name: data.name,
          role: 'tenant',
          telegramId: tgId
        }
      });
    }

    const existingProfile = await this.prisma.tenant.findUnique({
      where: { userId: user.id }
    });

    if (existingProfile) {
      return this.serialize({ ...user, tenantProfile: existingProfile });
    }

    const tenant = await this.prisma.tenant.create({
      data: {
        userId: user.id,
        apartmentId: data.apartmentId || null,
        rentPaymentDay: data.rentPaymentDay || null,
        status: 'pending',
      },
      include: { apartment: true }
    });

    // Notify about new registration
    this.notificationsClient.emit('tenant_registered', {
      tenantId: tenant.id,
      name: data.name,
      phone: data.phone || 'Не указан'
    });

    return this.serialize({ ...user, tenantProfile: tenant });
  }

  async approveTenant(tenantId: number) {
    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { status: 'active' },
      include: { user: true }
    });
    
    // Optionally notify the tenant that they are approved
    if (tenant.user.telegramId) {
      this.notificationsClient.emit('tenant_activated', {
          chatId: tenant.user.telegramId.toString()
      });
    }

    return this.serialize(tenant);
  }

  async rejectTenant(tenantId: number) {
    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { status: 'rejected' }
    });
    return this.serialize(tenant);
  }

  async getPendingTenants() {
    const tenants = await this.prisma.tenant.findMany({
      where: { status: 'pending' },
      include: { user: true }
    });
    return this.serialize(tenants);
  }

  async linkTenantApartment(tenantId: number, apartmentId: number, rentPaymentDay?: number, rentAmount?: number) {
    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { 
        apartmentId,
        rentPaymentDay,
        rentAmount,
        status: 'active'
      },
      include: { user: true, apartment: true }
    });

    // Notify the tenant that they are approved
    if (tenant.user.telegramId) {
      this.notificationsClient.emit('tenant_activated', {
          chatId: tenant.user.telegramId.toString(),
          apartmentAddress: tenant.apartment?.address || 'Неизвестно',
          rentPaymentDay,
          rentAmount: rentAmount ? rentAmount.toString() : undefined
      });
    }

    return this.serialize(tenant);
  }

  async getTenantByTelegramId(telegramId: string | number) {
    const user = await this.prisma.user.findUnique({
      where: { telegramId: BigInt(telegramId) },
      include: { tenantProfile: { include: { apartment: { include: { accounts: true } } } } }
    });
    return user ? this.serialize(user) : null;
  }
}
