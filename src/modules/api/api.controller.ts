import { Controller, Get, NotFoundException, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiService } from './api.service';
import { QueryAccrualsDto } from './dto/query-accruals.dto';
import { QueryApartmentsDto } from './dto/query-apartments.dto';
import { QueryInvoicesDto } from './dto/query-invoices.dto';

@ApiTags('api')
@Controller('api')
export class ApiController {
  constructor(private readonly apiService: ApiService) {}

  @Get('apartments')
  @ApiOperation({ summary: 'List apartments/objects from the local database' })
  @ApiOkResponse({ description: 'Apartment list filtered by id/address/organization/account number' })
  getApartments(@Query() query: QueryApartmentsDto) {
    return this.apiService.getApartments(query);
  }

  @Get('apartments/:id')
  @ApiOperation({ summary: 'Get one apartment with recent accruals and invoices' })
  async getApartment(@Param('id', ParseIntPipe) id: number) {
    const apartment = await this.apiService.getApartment(id);
    if (!apartment) throw new NotFoundException(`Apartment ${id} not found`);
    return apartment;
  }

  @Get('accruals')
  @ApiOperation({ summary: 'Query DB-backed accrual records' })
  getAccruals(@Query() query: QueryAccrualsDto) {
    return this.apiService.getAccruals(query);
  }

  @Get('invoices')
  @ApiOperation({ summary: 'Query DB-backed invoice/receipt metadata' })
  getInvoices(@Query() query: QueryInvoicesDto) {
    return this.apiService.getInvoices(query);
  }

  @Get('runs')
  @ApiOperation({ summary: 'Recent scraping run history' })
  getRuns() {
    return this.apiService.getRuns();
  }
}
