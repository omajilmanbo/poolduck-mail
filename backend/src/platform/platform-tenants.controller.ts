import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PlatformAuthGuard } from './platform-auth.guard';
import { CurrentPlatformAdmin } from './platform-current-admin.decorator';
import {
  CreatePlatformTenantDto,
  DeletePlatformTenantDto,
  UpdateLocationLimitDto,
  UpdateSubscriptionDto,
} from './platform.dto';
import { PlatformTenantsService } from './platform-tenants.service';
import { AuthenticatedPlatformAdmin } from './platform.types';

@Controller('api/platform/tenants')
@UseGuards(PlatformAuthGuard)
export class PlatformTenantsController {
  constructor(private readonly tenants: PlatformTenantsService) {}

  @Get()
  list() {
    return this.tenants.listTenants();
  }

  @Get(':tenantCode')
  get(@Param('tenantCode') tenantCode: string) {
    return this.tenants.getTenant(tenantCode);
  }

  @Post()
  create(
    @CurrentPlatformAdmin() admin: AuthenticatedPlatformAdmin,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-request-id') requestId: string | undefined,
    @Body() dto: CreatePlatformTenantDto,
  ) {
    return this.tenants.createTenant(
      admin,
      idempotencyKey,
      dto,
      requestId,
    );
  }

  @Patch(':tenantCode/subscription')
  updateSubscription(
    @CurrentPlatformAdmin() admin: AuthenticatedPlatformAdmin,
    @Param('tenantCode') tenantCode: string,
    @Headers('x-request-id') requestId: string | undefined,
    @Body() dto: UpdateSubscriptionDto,
  ) {
    return this.tenants.updateSubscription(admin, tenantCode, dto, requestId);
  }

  @Patch(':tenantCode/location-limit')
  updateLocationLimit(
    @CurrentPlatformAdmin() admin: AuthenticatedPlatformAdmin,
    @Param('tenantCode') tenantCode: string,
    @Headers('x-request-id') requestId: string | undefined,
    @Body() dto: UpdateLocationLimitDto,
  ) {
    return this.tenants.updateLocationLimit(admin, tenantCode, dto, requestId);
  }

  @Post(':tenantCode/delete')
  deleteTenant(
    @CurrentPlatformAdmin() admin: AuthenticatedPlatformAdmin,
    @Param('tenantCode') tenantCode: string,
    @Headers('x-request-id') requestId: string | undefined,
    @Body() dto: DeletePlatformTenantDto,
  ) {
    return this.tenants.deleteTenant(admin, tenantCode, dto, requestId);
  }

  @Post(':tenantCode/restore')
  restoreTenant(
    @CurrentPlatformAdmin() admin: AuthenticatedPlatformAdmin,
    @Param('tenantCode') tenantCode: string,
    @Headers('x-request-id') requestId: string | undefined,
    @Body() body: unknown,
  ) {
    if (body !== undefined && body !== null &&
      (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 0)) {
      throw new BadRequestException({
        code: 'PLATFORM_RESTORE_BODY_NOT_ALLOWED',
        message: '恢复请求不接受请求体字段',
      });
    }
    return this.tenants.restoreTenant(admin, tenantCode, requestId);
  }
}
