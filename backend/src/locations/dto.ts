import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreatePersonMappingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  person_name!: string;

  @IsEmail()
  @MaxLength(255)
  email!: string;
}

export class UpdatePersonMappingDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  person_name?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';
}

export class CreateLocationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  location_code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  location_name!: string;

  @IsIn(['office', 'school'])
  type!: 'office' | 'school';
}

export class UpdateLocationDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  location_code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  location_name?: string;

  @IsOptional()
  @IsIn(['office', 'school'])
  type?: 'office' | 'school';

  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';
}
