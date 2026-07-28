import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class LoginDto {
  @ValidateIf(
    (dto: LoginDto) =>
      dto.tenant_code !== undefined || dto.tenant_id === undefined,
  )
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  @Matches(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$/)
  tenant_code?: string;

  @ValidateIf((dto: LoginDto) => dto.tenant_id !== undefined)
  @IsUUID()
  tenant_id?: string;

  @ValidateIf(
    (dto: LoginDto) =>
      dto.identifier !== undefined || dto.email === undefined,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  identifier?: string;

  @ValidateIf(
    (dto: LoginDto) => dto.email !== undefined || dto.identifier === undefined,
  )
  @IsEmail({ allow_utf8_local_part: false })
  @MaxLength(254)
  email?: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}
