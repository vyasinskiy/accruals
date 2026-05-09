import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { BotNotificationService } from './bot-notification.service';

@Controller()
export class BotController {
  constructor(private readonly botService: BotNotificationService) {}

  @MessagePattern('notify_accrual')
  async handleAccrual(@Payload() data: { message: string }) {
    await this.botService.sendNotification(data.message);
  }
}
