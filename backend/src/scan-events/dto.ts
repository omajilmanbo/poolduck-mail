import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateScanEventDto {
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  location_id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  scan_code!: string;
}

export class ListScanEventsDto {
  @IsOptional()
  @IsUUID()
  location_id?: string;

  @IsOptional()
  @IsIn(['unmapped', 'queued', 'processing', 'sent', 'failed'])
  status?: 'unmapped' | 'queued' | 'processing' | 'sent' | 'failed';

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
  @IsUUID()
  location_id?: string;

  @IsOptional()
  @IsIn(['unmapped', 'queued', 'processing', 'sent', 'failed'])
  status?: 'unmapped' | 'queued' | 'processing' | 'sent' | 'failed';
}
