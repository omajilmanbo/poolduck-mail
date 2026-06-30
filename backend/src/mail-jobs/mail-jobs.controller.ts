import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthenticatedUserResponse } from '../auth/auth.types';
import { MailJobsService } from './mail-jobs.service';

@Controller('api/mail-jobs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('root_admin', 'manager')
export class MailJobsController {
  constructor(private readonly mailJobsService: MailJobsService) {}

  @Post(':mail_job_id/send')
  async send(
    @CurrentUser() user: AuthenticatedUserResponse,
    @Param('mail_job_id') mailJobId: string,
  ) {
    return this.mailJobsService.sendMailJob(user, mailJobId);
  }
}
