import fs from 'node:fs';
import { Controller, Get, NotFoundException, Param, ParseIntPipe, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiService } from './api.service';
import { QueryAccrualsDto } from './dto/query-accruals.dto';
import { QueryApartmentsDto } from './dto/query-apartments.dto';
import { QueryInvoicesDto } from './dto/query-invoices.dto';

@ApiTags('api')
@Controller('api')
export class ApiController {
  constructor(private readonly apiService: ApiService) {
    this.getApartments = this.getApartments.bind(this);
    this.getApartment = this.getApartment.bind(this);
    this.getAccruals = this.getAccruals.bind(this);
    this.getInvoices = this.getInvoices.bind(this);
    this.getInvoiceByPeriod = this.getInvoiceByPeriod.bind(this);
    this.downloadInvoiceByPeriod = this.downloadInvoiceByPeriod.bind(this);
    this.getRuns = this.getRuns.bind(this);
  }

  @Get('apartments')
  @ApiOperation({ summary: 'List apartments/objects from the local database' })
  @ApiOkResponse({ schema: { type: 'array', items: { type: 'object' } } })
  getApartments(@Query() query: QueryApartmentsDto) {
    return this.apiService.getApartments(query);
  }

  @Get('apartments/:id')
  @ApiOperation({ summary: 'Get one apartment with recent accruals and invoices' })
  @ApiOkResponse({ schema: { type: 'object' } })
  async getApartment(@Param('id', ParseIntPipe) id: number) {
    const apartment = await this.apiService.getApartment(id);
    if (!apartment) throw new NotFoundException(`Apartment ${id} not found`);
    return apartment;
  }

  @Get('accruals')
  @ApiOperation({ summary: 'Query DB-backed accrual records' })
  @ApiOkResponse({ schema: { type: 'array', items: { type: 'object' } } })
  getAccruals(@Query() query: QueryAccrualsDto) {
    return this.apiService.getAccruals(query);
  }

  @Get('invoices')
  @ApiOperation({ summary: 'Query DB-backed invoice/receipt metadata' })
  @ApiOkResponse({ schema: { type: 'array', items: { type: 'object' } } })
  getInvoices(@Query() query: QueryInvoicesDto) {
    return this.apiService.getInvoices(query);
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
  @ApiOperation({ summary: 'Download or stream invoice PDF for apartment/account + YYYYMM period when a local PDF exists' })
  @ApiQuery({ name: 'apartmentExternalId', type: String, required: true })
  @ApiQuery({ name: 'period', type: String, required: true })
  @ApiProduces('application/pdf')
  async downloadInvoiceByPeriod(
    @Query('apartmentExternalId') apartmentExternalId: string,
    @Query('period') period: string,
    @Res() res: any
  ) {
    const result = await this.apiService.getInvoiceByApartmentAndPeriod(apartmentExternalId, period);
    if (!result.filePath) {
      throw new NotFoundException(`No local PDF is available for ${apartmentExternalId} ${period}`);
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
