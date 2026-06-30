import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class CreateScanEventDto {
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  location_id!: string;

  @IsString()
  @IsNotEmpty()
  scan_code!: string;
}
