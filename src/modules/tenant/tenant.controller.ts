import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TenantRegistrationService } from './tenant-registration.service';
import { TenantPaymentService } from './tenant-payment.service';
import { TenantInvoiceService } from './tenant-invoice.service';

@Controller('tenant')
export class TenantController {
  constructor(
    private readonly tenantRegistrationService: TenantRegistrationService,
    private readonly tenantPaymentService: TenantPaymentService,
    private readonly tenantInvoiceService: TenantInvoiceService,
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

  @MessagePattern('add_tenant_payment')
  async addTenantPayment(@Payload() data: any) {
    return this.tenantPaymentService.addPayment(data);
  }

  @MessagePattern('get_tenant_invoices')
  async getTenantInvoices(@Payload() data: { telegramId: string | number }) {
    return this.tenantInvoiceService.getInvoices(data.telegramId);
  }

  @MessagePattern('get_tenant_debt')
  async getTenantDebt(@Payload() data: { telegramId: string | number }) {
    return this.tenantInvoiceService.getCurrentDebt(data.telegramId);
  }
}
