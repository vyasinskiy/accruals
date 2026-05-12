import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { BotNotificationService } from './bot-notification.service';

@Controller()
export class BotController {
  constructor(private readonly botService: BotNotificationService) {}

  @EventPattern('notify_accrual')
  async handleAccrual(@Payload() data: { message: string }) {
    await this.botService.sendNotification(data.message);
  }

  @EventPattern('notify_admin')
  async handleAdminNotification(@Payload() data: { message: string; targetChatId?: string; tenantId?: number; paymentId?: number; receiptPhotoId?: string }) {
    if (!data.targetChatId) {
        console.error('No targetChatId provided for notify_admin event');
        return;
    }
    await this.botService.sendAdminNotification(data.message, data.targetChatId);
  }
}
