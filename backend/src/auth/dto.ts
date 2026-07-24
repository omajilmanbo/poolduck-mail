import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  tenant_id!: string;

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
