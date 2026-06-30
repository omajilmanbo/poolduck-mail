import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthenticatedUserResponse } from '../auth/auth.types';
import { LicenseService } from './license.service';

@Controller('api/license')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('root_admin', 'manager')
export class LicenseController {
  constructor(private readonly licenseService: LicenseService) {}

  @Get('check')
  async check(@CurrentUser() user: AuthenticatedUserResponse) {
    return this.licenseService.checkTenantLicense(user.tenant_id);
  }
}
