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
    const platform = data.platform || 'telegram';
    const externalId = data.telegramId.toString();

    let identity = await this.prisma.userIdentity.findUnique({
      where: { platform_externalId: { platform, externalId } },
      include: { user: true }
    });

    let user;
    if (!identity) {
      user = await this.prisma.user.create({
        data: {
          name: data.name,
          role: 'tenant',
          identities: {
            create: {
              platform,
              externalId
            }
          }
        }
      });
    } else {
      user = identity.user;
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
      include: { user: { include: { identities: true } } }
    });
    
    // Optionally notify the tenant that they are approved
    const tgIdentity = tenant.user.identities.find(i => i.platform === 'telegram');
    if (tgIdentity) {
      this.notificationsClient.emit('tenant_activated', {
          chatId: tgIdentity.externalId
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

  async linkTenantApartment(tenantId: number, apartmentId: number) {
    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { 
        apartmentId,
        status: 'active'
      },
      include: { user: { include: { identities: true } }, apartment: true }
    });

    // Notify the tenant that they are approved
    const tgIdentity = tenant.user.identities.find(i => i.platform === 'telegram');
    if (tgIdentity) {
      this.notificationsClient.emit('tenant_activated', {
          chatId: tgIdentity.externalId,
          apartmentAddress: tenant.apartment?.address || 'Неизвестно'
      });
    }

    return this.serialize(tenant);
  }

  async getTenantByTelegramId(telegramId: string | number) {
    const identity = await this.prisma.userIdentity.findUnique({
      where: { platform_externalId: { platform: 'telegram', externalId: telegramId.toString() } },
      include: { user: { include: { tenantProfile: { include: { apartment: { include: { accounts: true } } } } } } }
    });
    return identity ? this.serialize(identity.user) : null;
  }
}
