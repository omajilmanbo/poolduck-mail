import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class ListMailJobsDto {
  @IsOptional()
  @IsUUID()
  location_id?: string;

  @IsOptional()
  @IsIn(['queued', 'processing', 'sent', 'failed'])
  status?: 'queued' | 'processing' | 'sent' | 'failed';

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

export class ExportMailJobsDto {
  @IsDateString()
  created_from!: string;

  @IsDateString()
  created_to!: string;

  @IsOptional()
  @IsUUID()
  location_id?: string;

  @IsOptional()
  @IsIn(['queued', 'processing', 'sent', 'failed'])
  status?: 'queued' | 'processing' | 'sent' | 'failed';
}
