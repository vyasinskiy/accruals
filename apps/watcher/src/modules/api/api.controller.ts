import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiService } from './api.service';

@ApiTags('api')
@Controller('api')
export class ApiController {
  constructor(private readonly apiService: ApiService) {}

  @Get('runs')
  @ApiOperation({ summary: 'Recent scraping run history' })
  @ApiOkResponse({ schema: { type: 'array', items: { type: 'object' } } })
  getRuns() {
    return this.apiService.getRuns();
  }
}
