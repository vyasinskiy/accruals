import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { MeterEventService } from './meter-event.service';

@Controller()
export class MeterEventController {
  private readonly logger = new Logger(MeterEventController.name);

  constructor(private readonly meterEventService: MeterEventService) {}

  @MessagePattern('submit_meter_readings')
  async handleSubmitMeterReadings(@Payload() data: { eventId: number }) {
    this.logger.log(`Received submit_meter_readings request for event ${data.eventId}`);
    return this.meterEventService.submitReadings(Number(data.eventId));
  }

  @MessagePattern('mark_readings_received')
  async handleMarkReadingsReceived(@Payload() data: { eventId: number }) {
    this.logger.log(`Received mark_readings_received request for event ${data.eventId}`);
    return this.meterEventService.markReceived(Number(data.eventId));
  }

  @MessagePattern('submit_meter_readings_value')
  async handleSubmitMeterReadingsValue(@Payload() data: { eventId: number; value: string }) {
    this.logger.log(`Received submit_meter_readings_value request for event ${data.eventId} value ${data.value}`);
    return this.meterEventService.submitValue(Number(data.eventId), data.value);
  }

  @MessagePattern('complete_without_submission')
  async handleCompleteWithoutSubmission(@Payload() data: { eventId: number }) {
    this.logger.log(`Received complete_without_submission request for event ${data.eventId}`);
    return this.meterEventService.completeWithoutSubmission(Number(data.eventId));
  }
}
