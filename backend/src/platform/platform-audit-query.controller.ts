import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentPlatformAdmin } from './platform-current-admin.decorator';
import { PlatformAuthGuard } from './platform-auth.guard';
import { ListPlatformAuditsDto } from './platform-audit-query.dto';
import { PlatformAuditQueryService } from './platform-audit-query.service';
import { AuthenticatedPlatformAdmin } from './platform.types';

@Controller('api/platform/audit-logs')
@UseGuards(PlatformAuthGuard)
export class PlatformAuditQueryController {
  constructor(private readonly queryService: PlatformAuditQueryService) {}

  @Get()
  list(@CurrentPlatformAdmin() admin: AuthenticatedPlatformAdmin, @Query() query: ListPlatformAuditsDto) {
    return this.queryService.list(admin, query);
  }
}
