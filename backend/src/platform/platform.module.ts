import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma.module';
import { MailJobsModule } from '../mail-jobs/mail-jobs.module';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformAuthGuard } from './platform-auth.guard';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformTenantsController } from './platform-tenants.controller';
import { PlatformTenantsService } from './platform-tenants.service';
import { PlatformTenantPurgeService } from './platform-tenant-purge.service';
import { PlatformTenantPurgeSchedulerService } from './platform-tenant-purge-scheduler.service';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    MailJobsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret:
          config.get<string>('JWT_SECRET') ?? 'local-development-jwt-secret',
      }),
    }),
  ],
  controllers: [PlatformAuthController, PlatformTenantsController],
  providers: [
    PlatformAuditService,
    PlatformAuthService,
    PlatformAuthGuard,
    PlatformTenantsService,
    PlatformTenantPurgeService,
    PlatformTenantPurgeSchedulerService,
  ],
  exports: [PlatformAuthGuard, PlatformAuthService, PlatformTenantPurgeService],
})
export class PlatformModule {}
