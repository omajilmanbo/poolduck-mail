import {
  ArrayUnique,
  IsEmail,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { USERNAME_PATTERN } from '../auth/identity';

const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
const PASSWORD_MESSAGE = '密码至少 8 位，且必须同时包含英文字母和数字';

export class CreateOperatorDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  @Matches(USERNAME_PATTERN, {
    message: '用户名必须为 3–32 位小写字母、数字、点、下划线或连字符，且首尾必须为字母或数字',
  })
  username!: string;

  @Transform(({ value }) =>
    typeof value === 'string' && value.trim() === ''
      ? null
      : typeof value === 'string'
        ? value.trim().toLowerCase()
        : value,
  )
  @IsOptional()
  @IsEmail({ allow_utf8_local_part: false })
  @MaxLength(254)
  email?: string | null;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_MESSAGE })
  password!: string;

  @IsOptional()
  @IsIn(['operator'])
  role?: 'operator';
}

export class UpdateOperatorDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  @Matches(USERNAME_PATTERN, {
    message: '用户名必须为 3–32 位小写字母、数字、点、下划线或连字符，且首尾必须为字母或数字',
  })
  username?: string;

  @Transform(({ value }) =>
    typeof value === 'string' && value.trim() === ''
      ? null
      : typeof value === 'string'
        ? value.trim().toLowerCase()
        : value,
  )
  @IsOptional()
  @IsEmail({ allow_utf8_local_part: false })
  @MaxLength(254)
  email?: string | null;

  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';

  @IsOptional()
  @IsIn(['operator'])
  role?: 'operator';
}

export class ResetOperatorPasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_MESSAGE })
  new_password!: string;
}

export class SetOperatorLocationAssignmentsDto {
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  location_ids!: string[];
}
