import { Body, Controller, Get, Post } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ScrapingService } from './scraping.service';
import { ManualScanDto } from './dto/manual-scan.dto';

@ApiTags('scraping')
@Controller('scraping')
export class ScrapingController {
  constructor(private readonly scrapingService: ScrapingService) {
    this.scan = this.scan.bind(this);
    this.getRuns = this.getRuns.bind(this);
  }

  @Post('scan')
  @MessagePattern('run_scan')
  @ApiOperation({ summary: 'Manually trigger a session-based scan' })
  @ApiBody({ type: ManualScanDto, required: false })
  @ApiOkResponse({ description: 'Scan summary' })
  scan(@Body() @Payload() body: ManualScanDto) {
    return this.scrapingService.scan(body ?? {});
  }

  @Get('runs')
  @ApiOperation({ summary: 'Recent scraping runs' })
  getRuns() {
    return this.scrapingService.getStatus();
  }
}
