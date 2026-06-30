import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LicenseModule } from '../license/license.module';
import { PrismaModule } from '../prisma.module';
import { MailJobsController } from './mail-jobs.controller';
import { MailJobsService } from './mail-jobs.service';
import { SandboxMailProvider } from './sandbox-mail.provider';

@Module({
  imports: [AuthModule, LicenseModule, PrismaModule],
  controllers: [MailJobsController],
  providers: [MailJobsService, SandboxMailProvider],
})
export class MailJobsModule {}
