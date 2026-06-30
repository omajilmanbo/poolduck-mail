import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthenticatedUserResponse } from '../auth/auth.types';
import { LocationsService } from './locations.service';

@Controller('api/locations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('root_admin', 'manager')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUserResponse) {
    return this.locationsService.listLocations(user.tenant_id);
  }

  @Get(':location_id/people')
  async people(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Param('location_id') locationId: string,
  ) {
    return this.locationsService.listPeople(user.tenant_id, locationId);
  }
}
