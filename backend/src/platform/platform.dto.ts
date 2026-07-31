import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class PlatformLoginDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({ allow_utf8_local_part: false })
  @MaxLength(254)
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class CreatePlatformTenantDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({ allow_utf8_local_part: false })
  @MaxLength(254)
  manager_email!: string;

  @IsIn(['trial', 'active'])
  subscription_status!: 'trial' | 'active';

  @IsISO8601({ strict: true })
  start_at!: string;

  @IsISO8601({ strict: true })
  end_at!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  location_limit!: number;
}

export class UpdateSubscriptionDto {
  @IsIn(['trial', 'active', 'expired', 'suspended'])
  status!: 'trial' | 'active' | 'expired' | 'suspended';

  @IsISO8601({ strict: true })
  start_at!: string;

  @IsISO8601({ strict: true })
  end_at!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class UpdateLocationLimitDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  location_limit!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}
