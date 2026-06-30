import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthenticatedUserResponse } from '../auth/auth.types';
import { LicenseService } from '../license/license.service';
import { PrismaService } from '../prisma.service';
import { SandboxMailProvider } from './sandbox-mail.provider';
import { SendMailJobResponse } from './mail-jobs.types';

@Injectable()
export class MailJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly licenseService: LicenseService,
    private readonly mailProvider: SandboxMailProvider,
  ) {}

  async sendMailJob(
    user: AuthenticatedUserResponse,
    mailJobId: string,
  ): Promise<SendMailJobResponse> {
    const mailJob = await this.prisma.mailJob.findFirst({
      where: {
        id: mailJobId,
        tenantId: user.tenant_id,
      },
      select: {
        id: true,
        status: true,
        toEmail: true,
        subject: true,
        body: true,
      },
    });

    if (!mailJob) {
      throw new NotFoundException({
        code: 'MAIL_JOB_NOT_FOUND',
        message: 'mail_job不存在或不属于当前租户',
      });
    }

    const license = await this.licenseService.checkTenantLicense(user.tenant_id);
    this.licenseService.assertCanSend(license.status);

    if (mailJob.status === 'sent') {
      throw new ConflictException({
        code: 'MAIL_JOB_ALREADY_SENT',
        message: 'mail_job已发送，不能重复发送',
      });
    }

    if (mailJob.status !== 'queued' && mailJob.status !== 'failed') {
      throw new ConflictException({
        code: 'MAIL_JOB_STATUS_NOT_SENDABLE',
        message: 'mail_job状态不允许发送',
      });
    }

    const providerResult = await this.mailProvider.send({
      mailJobId: mailJob.id,
      toEmail: mailJob.toEmail,
      subject: mailJob.subject,
      body: mailJob.body,
    });

    if (providerResult.success) {
      await this.prisma.mailJob.update({
        where: { id: mailJob.id },
        data: {
          status: 'sent',
          providerMessageId: providerResult.providerMessageId,
          errorMessage: null,
          sentAt: new Date(),
        },
      });

      return {
        mail_job_id: mailJob.id,
        status: 'sent',
        provider_result: {
          provider: providerResult.provider,
          success: true,
          provider_message_id: providerResult.providerMessageId,
        },
      };
    }

    await this.prisma.mailJob.update({
      where: { id: mailJob.id },
      data: {
        status: 'failed',
        errorMessage: providerResult.errorMessage,
        providerMessageId: providerResult.providerMessageId,
      },
    });

    return {
      mail_job_id: mailJob.id,
      status: 'failed',
      provider_result: {
        provider: providerResult.provider,
        success: false,
        provider_message_id: providerResult.providerMessageId,
        error_message: providerResult.errorMessage,
      },
    };
  }
}
