import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

export class ListUnmappedScansDto {
  @IsOptional()
  @IsString()
  @Matches(/^(?:[0-9A-HJKMNP-TV-Z]{8}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i)
  location_id?: string;

  @IsOptional()
  @IsIn(['open', 'resolved', 'ignored'])
  status?: 'open' | 'resolved' | 'ignored';
}

export class UpdateUnmappedScanDto {
  @IsIn(['resolved', 'ignored'])
  status!: 'resolved' | 'ignored';
}
