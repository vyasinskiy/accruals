import { Controller, Get, Query, Param, ParseIntPipe, NotFoundException, Res, Logger, Post, Body, Delete, Put } from '@nestjs/common';
import { EventPattern, Payload, MessagePattern } from '@nestjs/microservices';
import { EventsService } from './events.service';

@Controller('accountant/events')
export class EventsController {
  private readonly logger = new Logger(EventsController.name);

  constructor(
    private readonly eventsService: EventsService,
  ) {}

  @Get()
  async getScheduledEvents() {
    return this.eventsService.findScheduledEvents();
  }

  @Get('pending-count')
  async getPendingTriggersCount() {
    return this.eventsService.getPendingTriggersCount();
  }

  @Get(':id')
  async getScheduledEventById(@Param('id', ParseIntPipe) id: number) {
    return this.eventsService.findScheduledEventById(id);
  }

  @Post()
  async createScheduledEvent(@Body() body: any) {
    return this.eventsService.createScheduledEvent(body);
  }

  @Put(':id')
  async updateScheduledEvent(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.eventsService.updateScheduledEvent(id, body);
  }

  @Delete(':id')
  async deleteScheduledEvent(@Param('id', ParseIntPipe) id: number) {
    return this.eventsService.deleteScheduledEvent(id);
  }

  @Put('triggers/:triggerId')
  async updateEventTrigger(@Param('triggerId', ParseIntPipe) triggerId: number, @Body() body: { status?: string; comment?: string }) {
    return this.eventsService.updateEventTrigger(triggerId, body);
  }

  @Get(':id/attachments')
  async getEventAttachments(@Param('id', ParseIntPipe) id: number) {
    return this.eventsService.getEventAttachments(id);
  }

  @Post(':id/attachments')
  async attachEventDocumentHttp(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { fileName: string; fileBufferBase64: string; mimeType?: string; uploadedBy?: string }
  ) {
    const fileBuffer = Buffer.from(body.fileBufferBase64, 'base64');
    return this.eventsService.attachEventDocument({
      scheduledEventId: id,
      fileName: body.fileName,
      fileBuffer,
      mimeType: body.mimeType,
      uploadedBy: body.uploadedBy || 'admin-ui'
    });
  }

  @Delete('attachments/:attachmentId')
  async deleteEventAttachmentHttp(@Param('attachmentId', ParseIntPipe) attachmentId: number) {
    return this.eventsService.deleteEventAttachment(attachmentId);
  }

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
    return this.eventsService.attachEventDocument({
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
    return this.eventsService.findScheduledEventsFiltered(filters);
  }
}
