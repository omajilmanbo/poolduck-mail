import {
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
}
