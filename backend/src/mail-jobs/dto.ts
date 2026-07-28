import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class ListMailJobsDto {
  @IsOptional()
  @IsString()
  @Matches(/^(?:[0-9A-HJKMNP-TV-Z]{8}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i)
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
  @IsString()
  @Matches(/^(?:[0-9A-HJKMNP-TV-Z]{8}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i)
  location_id?: string;

  @IsOptional()
  @IsIn(['queued', 'processing', 'sent', 'failed'])
  status?: 'queued' | 'processing' | 'sent' | 'failed';
}
