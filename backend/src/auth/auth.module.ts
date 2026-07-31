import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma.module';
import { AuthController } from './auth.controller';
import { DEFAULT_ACCESS_TOKEN_TTL_SECONDS } from './auth.constants';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LoginRateLimiterService } from './login-rate-limiter.service';
import { RolesGuard } from './roles.guard';

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') ?? 'local-development-jwt-secret',
        signOptions: {
          expiresIn: Number(
            configService.get<string>('JWT_ACCESS_TOKEN_TTL_SECONDS') ??
              DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
          ),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, LoginRateLimiterService, RolesGuard],
  exports: [AuthService, JwtAuthGuard, RolesGuard, LoginRateLimiterService],
})
export class AuthModule {}
