import { Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthenticatedUserResponse } from '../auth/auth.types';
import { MailJobsService } from './mail-jobs.service';
import { ExportMailJobsDto, ListMailJobsDto } from './dto';

type ExportResponse = { type(value: string): void; attachment(filename: string): void };

@Controller('api/mail-jobs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('tenant_manager', 'operator')
export class MailJobsController {
  constructor(private readonly mailJobsService: MailJobsService) {}

  @Get('export')
  @Roles('tenant_manager')
  async export(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Query() query: ExportMailJobsDto,
    @Res({ passthrough: true }) response: ExportResponse,
  ) {
    const csv = await this.mailJobsService.exportMailJobs(user, query);
    response.type('text/csv; charset=utf-8');
    response.attachment('mail-jobs.csv');
    return csv;
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Query() query: ListMailJobsDto,
  ) {
    return this.mailJobsService.listMailJobs(user, query);
  }

  @Get(':mail_job_id')
  getOne(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Param('mail_job_id') mailJobId: string,
  ) {
    return this.mailJobsService.getMailJob(user, mailJobId);
  }

  @Post(':mail_job_id/send')
  async send(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Param('mail_job_id') mailJobId: string,
  ) {
    return this.mailJobsService.sendMailJob(user, mailJobId);
  }
}
