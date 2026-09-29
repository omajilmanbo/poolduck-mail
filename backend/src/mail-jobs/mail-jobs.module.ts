import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LicenseModule } from '../license/license.module';
import { PrismaModule } from '../prisma.module';
import { MailJobsController } from './mail-jobs.controller';
import { MailJobsService } from './mail-jobs.service';
import { SandboxMailProvider } from './sandbox-mail.provider';
import { MailJobProcessorService } from './mail-job-processor.service';
import { MailProvider } from './mail-provider.types';
import {
  MAIL_PROVIDER_CONFIG_TOKEN,
  MAIL_PROVIDER_TOKEN,
  MailProviderConfig,
  parseMailProviderConfig,
  selectMailProvider,
} from './mail-provider.config';

@Module({
  imports: [AuthModule, LicenseModule, PrismaModule],
  controllers: [MailJobsController],
  providers: [
    MailJobsService,
    MailJobProcessorService,
    SandboxMailProvider,
    {
      provide: MAIL_PROVIDER_CONFIG_TOKEN,
      useFactory: (): MailProviderConfig => parseMailProviderConfig(process.env),
    },
    {
      provide: MAIL_PROVIDER_TOKEN,
      inject: [MAIL_PROVIDER_CONFIG_TOKEN, SandboxMailProvider],
      useFactory: (config: MailProviderConfig, sandbox: SandboxMailProvider): MailProvider =>
        selectMailProvider(config, sandbox),
    },
  ],
  exports: [MailJobsService],
})
export class MailJobsModule {}
