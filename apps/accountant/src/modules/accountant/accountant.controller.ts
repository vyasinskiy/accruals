import { Controller, Get, Query, Param, ParseIntPipe, NotFoundException, Res, Logger, Post, Body } from '@nestjs/common';
import { EventPattern, Payload, MessagePattern } from '@nestjs/microservices';
import { AccountantService } from './accountant.service';
import { S3StorageService } from '../s3/s3-storage.service';

@Controller('accountant')
export class AccountantController {
  private readonly logger = new Logger(AccountantController.name);

  constructor(
    private readonly accountantService: AccountantService,
    private readonly s3Storage: S3StorageService
  ) {}

  @MessagePattern('upsert_apartment')
  async upsertApartment(@Payload() data: any) {
    this.logger.log(`Incoming request: upsert_apartment (${data.externalId})`);
    return this.accountantService.upsertApartment(data);
  }

  @MessagePattern('upsert_account')
  async upsertAccount(@Payload() data: any) {
    this.logger.log(`Incoming request: upsert_account (${data.externalId}) for apartment ${data.apartmentExternalId}`);
    return this.accountantService.upsertAccount(data);
  }

  @EventPattern('upsert_accrual')
  async upsertAccrual(@Payload() data: any) {
    this.logger.log(`Incoming event: upsert_accrual for account ${data.accountExternalId}, period ${data.periodId}`);
    return this.accountantService.upsertAccrual(data);
  }

  @EventPattern('upsert_invoice')
  async upsertInvoice(@Payload() data: any) {
    this.logger.log(`Incoming event: upsert_invoice for account ${data.accountExternalId}, period ${data.periodId}`);
    return this.accountantService.upsertInvoice(data);
  }

  @MessagePattern('create_payment')
  async createPayment(@Payload() data: any) {
    return this.accountantService.createPayment(data);
  }

  @MessagePattern('confirm_payment')
  async confirmPayment(@Payload() data: any) {
    return this.accountantService.confirmPayment(data.paymentId, data.confirmedBy);
  }

  @MessagePattern('reject_payment')
  async rejectPayment(@Payload() data: any) {
    return this.accountantService.rejectPayment(data.paymentId, data.confirmedBy, data.comment);
  }

  @MessagePattern('get_apartments')
  async getApartments(@Payload() query: any = {}) {
    return this.accountantService.findApartments(query);
  }

  @Get('apartments')
  async findApartments(@Query() query: any) {
    return this.accountantService.findApartments(query);
  }

  @Get('accounts')
  async findAccounts(@Query() query: any) {
    return this.accountantService.findAccounts(query);
  }

  @Get('accruals')
  async findAccruals(@Query() query: any) {
    return this.accountantService.findAccruals(query);
  }

  @Get('invoices')
  async findInvoices(@Query() query: any) {
    return this.accountantService.findInvoices(query);
  }

  @MessagePattern('get_invoices')
  async getInvoices(@Payload() query: any = {}) {
    return this.accountantService.findInvoices(query);
  }

  @MessagePattern('get_invoice')
  async getInvoice(@Payload() id: number) {
    return this.accountantService.findInvoiceById(id);
  }

  @Get('invoices/by-period')
  async getInvoiceByPeriod(@Query('accountExternalId') accountExternalId: string, @Query('period') period: string) {
    return this.accountantService.findInvoiceByPeriod(accountExternalId, period);
  }

  @Get('invoices/by-period/download')
  async downloadInvoiceByPeriod(
    @Query('accountExternalId') accountExternalId: string,
    @Query('period') period: string,
    @Res() res: any
  ) {
    const result = await this.accountantService.findInvoiceByPeriod(accountExternalId, period);
    if (result.downloadUrl) {
      return res.redirect(result.downloadUrl);
    }
    throw new NotFoundException(`Invoice PDF not available for download`);
  }

  @MessagePattern('get_apartment')
  async getApartment(@Payload() id: number) {
    return this.accountantService.findApartmentById(id);
  }

  @MessagePattern('get_tenant_by_apartment')
  async getTenantByApartment(@Payload() apartmentId: number) {
    return this.accountantService.findTenantByApartment(apartmentId);
  }

  @MessagePattern('update_tenant_payment_settings')
  async updateTenantPaymentSettings(@Payload() data: { tenantId: number; rentPaymentDay?: number; rentAmount?: number }) {
    return this.accountantService.updateTenantPaymentSettings(data.tenantId, data.rentPaymentDay, data.rentAmount);
  }

  @MessagePattern('update_account_custom_label')
  async updateAccountCustomLabel(@Payload() data: { accountId: number; customLabel: string | null }) {
    return this.accountantService.updateAccountCustomLabel(data.accountId, data.customLabel);
  }

  @Get('apartments/:id')
  async findApartment(@Param('id', ParseIntPipe) id: number) {
    return this.accountantService.findApartmentById(id);
  }

  @Get('invoices/upload-url')
  async getUploadUrl(@Query('accountExternalId') accountExternalId: string, @Query('periodLabel') periodLabel: string) {
    const key = this.s3Storage.buildInvoiceKey(accountExternalId, periodLabel);
    const url = this.s3Storage.getSignedUploadUrl(key);
    return { url, key };
  }
}

