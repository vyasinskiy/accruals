import { Controller, Get, Query, Param, ParseIntPipe, NotFoundException, Res, Logger, Post, Body, Delete, Put } from '@nestjs/common';
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

  @MessagePattern('get_accruals_paginated')
  async getAccrualsPaginated(@Payload() query: any = {}) {
    return this.accountantService.findAccrualsPaginated(query);
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

  @MessagePattern('get_all_users')
  async getAllUsers() {
    return this.accountantService.findAllUsers();
  }

  @MessagePattern('update_tenant_payment_settings')
  async updateTenantPaymentSettings(@Payload() data: { tenantId: number; rentPaymentDay?: number; rentAmount?: number }) {
    return this.accountantService.updateTenantPaymentSettings(data.tenantId, data.rentPaymentDay, data.rentAmount);
  }

  @MessagePattern('update_account_custom_label')
  async updateAccountCustomLabel(@Payload() data: { accountId: number; customLabel: string | null }) {
    return this.accountantService.updateAccountCustomLabel(data.accountId, data.customLabel);
  }

  @MessagePattern('create_active_tenant_manual')
  async createActiveTenantManual(@Payload() data: { name: string; apartmentId: number; rentPaymentDay: number; rentAmount: number }) {
    return this.accountantService.createActiveTenantManual(data);
  }

  @Get('apartments/:id')
  async findApartment(@Param('id', ParseIntPipe) id: number) {
    return this.accountantService.findApartmentById(id);
  }

  @Get('invoices/:id')
  async findInvoice(@Param('id', ParseIntPipe) id: number) {
    return this.accountantService.findInvoiceById(id);
  }

  @Post('invoices')
  async createManualInvoice(@Body() body: { accountId: number; period: string; amount: number; comment: string }) {
    return this.accountantService.createManualInvoice(body);
  }

  @Get('invoices/upload-url')
  async getUploadUrl(@Query('accountExternalId') accountExternalId: string, @Query('periodLabel') periodLabel: string) {
    const key = this.s3Storage.buildInvoiceKey(accountExternalId, periodLabel);
    const url = this.s3Storage.getSignedUploadUrl(key);
    return { url, key };
  }

  @Get('payments')
  async findPayments(@Query() query: { userId?: string; status?: string; userName?: string }) {
    const userId = query.userId ? parseInt(query.userId, 10) : undefined;
    return this.accountantService.findPayments({
      userId: isNaN(Number(userId)) ? undefined : userId,
      status: query.status,
      userName: query.userName,
    });
  }

  @Post('payments/confirm')
  async confirmPaymentHttp(@Body() body: { paymentId: number; confirmedBy: number }) {
    return this.accountantService.confirmPayment(body.paymentId, body.confirmedBy);
  }

  @Post('payments/reject')
  async rejectPaymentHttp(@Body() body: { paymentId: number; confirmedBy: number; comment?: string }) {
    return this.accountantService.rejectPayment(body.paymentId, body.confirmedBy, body.comment);
  }

  @Get('notifications')
  async findNotifications(@Query() query: { accountId?: string; status?: string }) {
    const accountId = query.accountId ? parseInt(query.accountId, 10) : undefined;
    const meterEvents = await this.accountantService.findMeterSubmissionEvents({
      accountId: isNaN(Number(accountId)) ? undefined : accountId,
      status: query.status,
    });
    const systemEvents = await this.accountantService.findSystemEvents({
      status: query.status,
    });
    return {
      meterEvents,
      systemEvents,
    };
  }

  @Get('stats')
  async getStatsHttp() {
    return this.accountantService.getStats();
  }

  @Delete('apartments/:id')
  async deleteApartment(@Param('id', ParseIntPipe) id: number) {
    return this.accountantService.deleteApartment(id);
  }

  @Delete('accounts/:id')
  async deleteAccount(@Param('id', ParseIntPipe) id: number) {
    return this.accountantService.deleteAccount(id);
  }

  @Delete('invoices/:id')
  async deleteInvoice(@Param('id', ParseIntPipe) id: number) {
    return this.accountantService.deleteInvoice(id);
  }

  @Delete('payments/:id')
  async deletePayment(@Param('id', ParseIntPipe) id: number) {
    return this.accountantService.deletePayment(id);
  }

  @Delete('notifications/:id')
  async deleteNotification(@Param('id', ParseIntPipe) id: number) {
    return this.accountantService.deleteMeterSubmissionEvent(id);
  }

  @Get('tenants')
  async getTenants() {
    return this.accountantService.findTenants();
  }

  @Post('tenants')
  async createTenant(@Body() body: { name: string; apartmentId?: number; rentPaymentDay?: number; rentAmount?: number }) {
    return this.accountantService.createTenant(body);
  }

  @Put('tenants/:id')
  async updateTenant(@Param('id', ParseIntPipe) id: number, @Body() body: { name?: string; apartmentId?: number | null; rentPaymentDay?: number | null; rentAmount?: number | null; status?: string }) {
    return this.accountantService.updateTenant(id, body);
  }

  @Delete('tenants/:id')
  async deleteTenant(@Param('id', ParseIntPipe) id: number) {
    return this.accountantService.deleteTenant(id);
  }

  @Get('tenants/:id')
  async getTenantById(@Param('id', ParseIntPipe) id: number) {
    return this.accountantService.findTenantById(id);
  }

  // --- SCHEDULED EVENTS ENDPOINTS ---

  @Get('events')
  async getScheduledEvents() {
    return this.accountantService.findScheduledEvents();
  }

  @Get('events/pending-count')
  async getPendingTriggersCount() {
    return this.accountantService.getPendingTriggersCount();
  }

  @Get('events/:id')
  async getScheduledEventById(@Param('id', ParseIntPipe) id: number) {
    return this.accountantService.findScheduledEventById(id);
  }

  @Post('events')
  async createScheduledEvent(@Body() body: any) {
    return this.accountantService.createScheduledEvent(body);
  }

  @Put('events/:id')
  async updateScheduledEvent(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.accountantService.updateScheduledEvent(id, body);
  }

  @Delete('events/:id')
  async deleteScheduledEvent(@Param('id', ParseIntPipe) id: number) {
    return this.accountantService.deleteScheduledEvent(id);
  }

  @Put('events/triggers/:triggerId')
  async updateEventTrigger(@Param('triggerId', ParseIntPipe) triggerId: number, @Body() body: { status?: string; comment?: string }) {
    return this.accountantService.updateEventTrigger(triggerId, body);
  }

  // --- ATTACHMENTS & FILTERED EVENTS ---

  @MessagePattern('attach_event_document')
  async attachEventDocumentMsg(@Payload() data: {
    scheduledEventId?: number;
    eventTriggerId?: number;
    fileName: string;
    fileBufferBase64: string;
    mimeType?: string;
    telegramFileId?: string;
    uploadedBy?: string;
  }) {
    const fileBuffer = Buffer.from(data.fileBufferBase64, 'base64');
    return this.accountantService.attachEventDocument({
      scheduledEventId: data.scheduledEventId,
      eventTriggerId: data.eventTriggerId,
      fileName: data.fileName,
      fileBuffer,
      mimeType: data.mimeType,
      telegramFileId: data.telegramFileId,
      uploadedBy: data.uploadedBy
    });
  }

  @MessagePattern('get_scheduled_events_filtered')
  async getScheduledEventsFilteredMsg(@Payload() filters: { tenantId?: number; apartmentId?: number; accountId?: number; activeOnly?: boolean }) {
    return this.accountantService.findScheduledEventsFiltered(filters);
  }

  @MessagePattern('get_all_tenants')
  async getAllTenantsMsg() {
    return this.accountantService.findTenants();
  }

  @Get('events/:id/attachments')
  async getEventAttachments(@Param('id', ParseIntPipe) id: number) {
    return this.accountantService.getEventAttachments(id);
  }

  @Post('events/:id/attachments')
  async attachEventDocumentHttp(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { fileName: string; fileBufferBase64: string; mimeType?: string; uploadedBy?: string }
  ) {
    const fileBuffer = Buffer.from(body.fileBufferBase64, 'base64');
    return this.accountantService.attachEventDocument({
      scheduledEventId: id,
      fileName: body.fileName,
      fileBuffer,
      mimeType: body.mimeType,
      uploadedBy: body.uploadedBy || 'admin-ui'
    });
  }

  @Delete('events/attachments/:attachmentId')
  async deleteEventAttachmentHttp(@Param('attachmentId', ParseIntPipe) attachmentId: number) {
    return this.accountantService.deleteEventAttachment(attachmentId);
  }
}

