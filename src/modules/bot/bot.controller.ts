import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { BotService } from './bot.service';

@Controller()
export class BotController {
  constructor(private readonly botService: BotService) {}

  @MessagePattern('notify_accrual')
  async handleAccrual(@Payload() data: { message: string }) {
    await this.botService.sendNotification(data.message);
  }
}
