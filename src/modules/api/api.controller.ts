import fs from 'node:fs';
import { Controller, Get, NotFoundException, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiService } from './api.service';

@ApiTags('api')
@Controller('api')
export class ApiController {
  constructor(private readonly apiService: ApiService) {
    this.getInvoiceByPeriod = this.getInvoiceByPeriod.bind(this);
    this.downloadInvoiceByPeriod = this.downloadInvoiceByPeriod.bind(this);
    this.getRuns = this.getRuns.bind(this);
  }

  @Get('invoices/by-period')
  @ApiOperation({ summary: 'Get invoice metadata for apartment/account + YYYYMM period' })
  @ApiQuery({ name: 'apartmentExternalId', type: String, required: true })
  @ApiQuery({ name: 'period', type: String, required: true, description: 'Usually YYYYMM, for example 202603' })
  @ApiOkResponse({ schema: { type: 'object' } })
  getInvoiceByPeriod(@Query('apartmentExternalId') apartmentExternalId: string, @Query('period') period: string) {
    return this.apiService.getInvoiceByApartmentAndPeriod(apartmentExternalId, period);
  }

  @Get('invoices/by-period/download')
  @ApiOperation({ summary: 'Download invoice PDF for apartment/account + YYYYMM period from configured storage' })
  @ApiQuery({ name: 'apartmentExternalId', type: String, required: true })
  @ApiQuery({ name: 'period', type: String, required: true })
  @ApiProduces('application/pdf')
  async downloadInvoiceByPeriod(
    @Query('apartmentExternalId') apartmentExternalId: string,
    @Query('period') period: string,
    @Res() res: any
  ) {
    const result = await this.apiService.getInvoiceByApartmentAndPeriod(apartmentExternalId, period);
    if (result.downloadUrl) {
      return res.redirect(result.downloadUrl);
    }
    if (!result.filePath) {
      throw new NotFoundException(`No PDF is available for ${apartmentExternalId} ${period}`);
    }

    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `inline; filename="${result.filename}"`);
    fs.createReadStream(result.filePath).pipe(res);
  }

  @Get('runs')
  @ApiOperation({ summary: 'Recent scraping run history' })
  @ApiOkResponse({ schema: { type: 'array', items: { type: 'object' } } })
  getRuns() {
    return this.apiService.getRuns();
  }
}
