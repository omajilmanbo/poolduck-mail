import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedUserResponse } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  CreateOperatorDto,
  ResetOperatorPasswordDto,
  SetOperatorLocationAssignmentsDto,
  UpdateOperatorDto,
} from './dto';
import { UsersService } from './users.service';

@Controller('api/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('tenant_manager')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUserResponse) {
    return this.users.listOperators(user);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Body() dto: CreateOperatorDto,
  ) {
    return this.users.createOperator(user, dto);
  }

  @Patch(':user_id')
  update(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Param('user_id') userId: string,
    @Body() dto: UpdateOperatorDto,
  ) {
    return this.users.updateOperator(user, userId, dto);
  }

  @Post(':user_id/password')
  resetPassword(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Param('user_id') userId: string,
    @Body() dto: ResetOperatorPasswordDto,
  ) {
    return this.users.resetOperatorPassword(user, userId, dto);
  }

  @Get(':user_id/location-assignments')
  listLocationAssignments(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Param('user_id') userId: string,
  ) {
    return this.users.listLocationAssignments(user, userId);
  }

  @Put(':user_id/location-assignments')
  setLocationAssignments(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Param('user_id') userId: string,
    @Body() dto: SetOperatorLocationAssignmentsDto,
  ) {
    return this.users.setLocationAssignments(user, userId, dto);
  }

  @Delete(':user_id/location-assignments/:location_id')
  revokeLocationAssignment(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Param('user_id') userId: string,
    @Param('location_id') locationId: string,
  ) {
    return this.users.revokeLocationAssignment(user, userId, locationId);
  }
}
