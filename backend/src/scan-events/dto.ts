import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateScanEventDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^(?:[0-9A-HJKMNP-TV-Z]{8}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i)
  location_id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  scan_code!: string;
}

export class ListScanEventsDto {
  @IsOptional()
  @IsString()
  @Matches(/^(?:[0-9A-HJKMNP-TV-Z]{8}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i)
  location_id?: string;

  @IsOptional()
  @IsIn(['waiting', 'queued', 'processing', 'sent', 'failed', 'canceled', 'delivery_unknown'])
  status?: 'waiting' | 'queued' | 'processing' | 'sent' | 'failed' | 'canceled' | 'delivery_unknown';

  @IsOptional()
  @IsDateString()
  created_from?: string;

  @IsOptional()
  @IsDateString()
  created_to?: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;
}

export class ExportScanEventsDto {
  @IsDateString()
  created_from!: string;

  @IsDateString()
  created_to!: string;

  @IsOptional()
  @IsString()
  @Matches(/^(?:[0-9A-HJKMNP-TV-Z]{8}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i)
  location_id?: string;

  @IsOptional()
  @IsIn(['waiting', 'queued', 'processing', 'sent', 'failed', 'canceled', 'delivery_unknown'])
  status?: 'waiting' | 'queued' | 'processing' | 'sent' | 'failed' | 'canceled' | 'delivery_unknown';
}
