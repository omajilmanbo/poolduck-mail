import { IsIn, IsOptional, IsUUID } from 'class-validator';

export class ListUnmappedScansDto {
  @IsOptional()
  @IsUUID()
  location_id?: string;

  @IsOptional()
  @IsIn(['open', 'resolved', 'ignored'])
  status?: 'open' | 'resolved' | 'ignored';
}

export class UpdateUnmappedScanDto {
  @IsIn(['resolved', 'ignored'])
  status!: 'resolved' | 'ignored';
}
