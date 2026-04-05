import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class ManualScanDto {
  @ApiPropertyOptional({ type: String, enum: ['manual', 'cron'], default: 'manual' })
  @IsOptional()
  @IsString()
  @IsIn(['manual', 'cron'])
  trigger?: 'manual' | 'cron';

  @ApiPropertyOptional({ type: String, description: 'Optional apartment external id filter. If omitted, scans apartments already known in DB or all source apartments on first run.' })
  @IsOptional()
  @IsString()
  apartmentExternalId?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  organization?: string;
}
