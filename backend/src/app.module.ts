import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_PIPE } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { LicenseModule } from './license/license.module';
import { LocationsModule } from './locations/locations.module';
import { MailJobsModule } from './mail-jobs/mail-jobs.module';
import { ScanEventsModule } from './scan-events/scan-events.module';
import { AuditModule } from './audit/audit.module';
import { AuditApiModule } from './audit/audit-api.module';
import { UnmappedScansModule } from './unmapped-scans/unmapped-scans.module';
import { UsersModule } from './users/users.module';
import { LocationAccessModule } from './location-access/location-access.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    AuditModule,
    LocationAccessModule,
    AuthModule,
    AuditApiModule,
    LicenseModule,
    LocationsModule,
    MailJobsModule,
    ScanEventsModule,
    UnmappedScansModule,
    UsersModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
  ],
})
export class AppModule {}
