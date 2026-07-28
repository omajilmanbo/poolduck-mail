import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthenticatedUserResponse } from '../auth/auth.types';
import { AuditService } from './audit.service';
import { ExportAuditLogsDto, ListAuditLogsDto } from './dto';

type ExportResponse = { type(value: string): void; attachment(filename: string): void };

@Controller('api/audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('tenant_manager')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('export')
  async export(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Query() query: ExportAuditLogsDto,
    @Res({ passthrough: true }) response: ExportResponse,
  ) {
    const csv = await this.audit.exportLogs(user, query);
    response.type('text/csv; charset=utf-8');
    response.attachment('audit-logs.csv');
    return csv;
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Query() query: ListAuditLogsDto,
  ) {
    return this.audit.listLogs(user, query);
  }
}
