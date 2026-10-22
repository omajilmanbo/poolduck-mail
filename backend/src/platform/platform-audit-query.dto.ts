import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class ListPlatformAuditsDto {
  @IsOptional() @IsDateString() created_from?: string;
  @IsOptional() @IsDateString() created_to?: string;
  @IsOptional() @IsUUID() platform_admin_id?: string;
  @IsOptional() @IsString() @MaxLength(128) action?: string;
  @IsOptional() @IsIn(['success', 'failure', 'denied']) result?: 'success' | 'failure' | 'denied';
  @IsOptional() @IsUUID() target_tenant_id?: string;
  @IsOptional() @IsString() @MaxLength(512) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
}
