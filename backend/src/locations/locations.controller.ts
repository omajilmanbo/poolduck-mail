import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthenticatedUserResponse } from '../auth/auth.types';
import { LocationsService } from './locations.service';
import {
  CreateLocationDto,
  CreatePersonMappingDto,
  UpdateLocationDto,
  UpdatePersonMappingDto,
} from './dto';

@Controller('api/locations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('tenant_manager', 'operator')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Query('include_deleted') includeDeleted?: string,
  ) {
    return this.locationsService.listLocations(
      user,
      includeDeleted === 'true',
    );
  }

  @Post()
  @Roles('tenant_manager')
  createLocation(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Body() dto: CreateLocationDto,
  ) {
    return this.locationsService.createLocation(user, dto);
  }

  @Patch(':location_id')
  @Roles('tenant_manager')
  updateLocation(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Param('location_id') locationId: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.locationsService.updateLocation(user, locationId, dto);
  }

  @Delete(':location_id')
  @Roles('tenant_manager')
  deactivateLocation(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Param('location_id') locationId: string,
  ) {
    return this.locationsService.setLocationStatus(user, locationId, 'inactive');
  }

  @Post(':location_id/reactivate')
  @Roles('tenant_manager')
  reactivateLocation(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Param('location_id') locationId: string,
  ) {
    return this.locationsService.setLocationStatus(user, locationId, 'active');
  }

  @Post(':location_id/delete')
  @Roles('tenant_manager')
  scheduleLocationDeletion(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Param('location_id') locationId: string,
  ) {
    return this.locationsService.scheduleLocationDeletion(user, locationId);
  }

  @Post(':location_id/restore')
  @Roles('tenant_manager')
  restoreLocation(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Param('location_id') locationId: string,
  ) {
    return this.locationsService.restoreLocation(user, locationId);
  }

  @Get(':location_id/people')
  async people(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Param('location_id') locationId: string,
    @Query('include_deleted') includeDeleted?: string,
  ) {
    return this.locationsService.listPeople(
      user,
      locationId,
      includeDeleted === 'true',
    );
  }

  @Get(':location_id/people/:person_id')
  person(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Param('location_id') locationId: string,
    @Param('person_id') personId: string,
  ) {
    return this.locationsService.getPerson(user, locationId, personId);
  }

  @Post(':location_id/people')
  createPerson(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Param('location_id') locationId: string,
    @Body() dto: CreatePersonMappingDto,
  ) {
    return this.locationsService.createPerson(user, locationId, dto);
  }

  @Patch(':location_id/people/:person_id')
  updatePerson(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Param('location_id') locationId: string,
    @Param('person_id') personId: string,
    @Body() dto: UpdatePersonMappingDto,
  ) {
    return this.locationsService.updatePerson(user, locationId, personId, dto);
  }

  @Delete(':location_id/people/:person_id')
  deactivatePerson(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Param('location_id') locationId: string,
    @Param('person_id') personId: string,
  ) {
    return this.locationsService.setPersonStatus(user, locationId, personId, 'inactive');
  }

  @Post(':location_id/people/:person_id/reactivate')
  reactivatePerson(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Param('location_id') locationId: string,
    @Param('person_id') personId: string,
  ) {
    return this.locationsService.setPersonStatus(user, locationId, personId, 'active');
  }

  @Post(':location_id/people/:person_id/delete')
  schedulePersonDeletion(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Param('location_id') locationId: string,
    @Param('person_id') personId: string,
  ) {
    return this.locationsService.schedulePersonDeletion(
      user,
      locationId,
      personId,
    );
  }

  @Post(':location_id/people/:person_id/restore')
  restorePerson(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Param('location_id') locationId: string,
    @Param('person_id') personId: string,
  ) {
    return this.locationsService.restorePerson(user, locationId, personId);
  }
}
