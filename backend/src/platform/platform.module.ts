import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma.module';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformAuthGuard } from './platform-auth.guard';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformTenantsController } from './platform-tenants.controller';
import { PlatformTenantsService } from './platform-tenants.service';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
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
  ],
  exports: [PlatformAuthGuard, PlatformAuthService],
})
export class PlatformModule {}
