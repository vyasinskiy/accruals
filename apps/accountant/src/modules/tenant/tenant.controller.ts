import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TenantRegistrationService } from './tenant-registration.service';
import { TenantService } from './tenant.service';

@Controller('tenant')
export class TenantController {
  constructor(
    private readonly tenantRegistrationService: TenantRegistrationService,
    private readonly tenantService: TenantService,
  ) {}

  @MessagePattern('create_tenant')
  async createTenant(@Payload() data: any) {
    return this.tenantRegistrationService.registerTenant(data);
  }

  @MessagePattern('approve_tenant')
  async approveTenant(@Payload() data: { tenantId: number }) {
    return this.tenantRegistrationService.approveTenant(data.tenantId);
  }

  @MessagePattern('reject_tenant')
  async rejectTenant(@Payload() data: { tenantId: number }) {
    return this.tenantRegistrationService.rejectTenant(data.tenantId);
  }

  @MessagePattern('get_tenant')
  async getTenant(@Payload() data: { telegramId: string | number }) {
    return this.tenantRegistrationService.getTenantByTelegramId(data.telegramId);
  }

  @MessagePattern('get_pending_tenants')
  async getPendingTenants() {
    return this.tenantRegistrationService.getPendingTenants();
  }

  @MessagePattern('link_tenant_apartment')
  async linkTenantApartment(@Payload() data: { tenantId: number; apartmentId: number; rentPaymentDay?: number; rentAmount?: number }) {
    return this.tenantRegistrationService.linkTenantApartment(data.tenantId, data.apartmentId, data.rentPaymentDay, data.rentAmount);
  }

  @MessagePattern('add_tenant_payment')
  async addTenantPayment(@Payload() data: any) {
    return this.tenantService.addPayment(data);
  }

  @MessagePattern('get_tenant_invoices')
  async getTenantInvoices(@Payload() data: { telegramId: string | number }) {
    return this.tenantService.getInvoices(data.telegramId);
  }

  @MessagePattern('get_tenant_debt')
  async getTenantDebt(@Payload() data: { telegramId: string | number }) {
    return this.tenantService.getCurrentDebt(data.telegramId);
  }
}
