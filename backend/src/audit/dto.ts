import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class ListAuditLogsDto {
  @IsOptional()
  @IsDateString()
  created_from?: string;

  @IsOptional()
  @IsDateString()
  created_to?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsIn(['success', 'failure', 'denied'])
  result?: 'success' | 'failure' | 'denied';

  @IsOptional()
  @IsString()
  resource_type?: string;

  @IsOptional()
  @IsUUID()
  actor_user_id?: string;

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

export class ExportAuditLogsDto {
  @IsDateString()
  created_from!: string;

  @IsDateString()
  created_to!: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsIn(['success', 'failure', 'denied'])
  result?: 'success' | 'failure' | 'denied';

  @IsOptional()
  @IsString()
  resource_type?: string;
}
