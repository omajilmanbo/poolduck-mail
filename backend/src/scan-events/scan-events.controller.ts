import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthenticatedUserResponse } from '../auth/auth.types';
import { CreateScanEventDto } from './dto';
import { ScanEventsService } from './scan-events.service';

@Controller('api/scan-events')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('root_admin', 'manager')
export class ScanEventsController {
  constructor(private readonly scanEventsService: ScanEventsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Body() dto: CreateScanEventDto,
  ) {
    return this.scanEventsService.createScanEvent(user, dto);
  }
}
