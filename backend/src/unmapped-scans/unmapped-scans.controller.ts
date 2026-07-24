import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { AuthenticatedUserResponse } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ListUnmappedScansDto, UpdateUnmappedScanDto } from './dto';
import { UnmappedScansService } from './unmapped-scans.service';

@Controller('api/unmapped-scans')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('tenant_manager', 'operator')
export class UnmappedScansController {
  constructor(private readonly service: UnmappedScansService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Query() query: ListUnmappedScansDto,
  ) {
    return this.service.list(user, query);
  }

  @Get(':case_id')
  getOne(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Param('case_id') caseId: string,
  ) {
    return this.service.getOne(user, caseId);
  }

  @Patch(':case_id')
  update(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Param('case_id') caseId: string,
    @Body() dto: UpdateUnmappedScanDto,
  ) {
    return this.service.update(user, caseId, dto);
  }
}
