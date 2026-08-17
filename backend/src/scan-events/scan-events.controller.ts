import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthenticatedUserResponse } from '../auth/auth.types';
import { CreateScanEventDto, ExportScanEventsDto, ListScanEventsDto } from './dto';
import { ScanEventsService } from './scan-events.service';

type ExportResponse = { type(value: string): void; attachment(filename: string): void };

@Controller('api/scan-events')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('tenant_manager', 'operator')
export class ScanEventsController {
  constructor(private readonly scanEventsService: ScanEventsService) {}

  @Get('export')
  @Roles('tenant_manager')
  async export(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Query() query: ExportScanEventsDto,
    @Res({ passthrough: true }) response: ExportResponse,
  ) {
    const csv = await this.scanEventsService.exportScanEvents(user, query);
    response.type('text/csv; charset=utf-8');
    response.attachment('scan-events.csv');
    return csv;
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Query() query: ListScanEventsDto,
  ) {
    return this.scanEventsService.listScanEvents(user, query);
  }

  @Get(':scan_event_id')
  getOne(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Param('scan_event_id') scanEventId: string,
  ) {
    return this.scanEventsService.getScanEvent(user, scanEventId);
  }

  @Post(':scan_event_id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Param('scan_event_id') scanEventId: string,
  ) {
    return this.scanEventsService.cancelScanEvent(user, scanEventId);
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Body() dto: CreateScanEventDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.scanEventsService.createScanEvent(user, dto, idempotencyKey);
  }
}
