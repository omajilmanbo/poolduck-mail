import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LicenseModule } from '../license/license.module';
import { PrismaModule } from '../prisma.module';
import { ScanEventsController } from './scan-events.controller';
import { ScanEventsService } from './scan-events.service';

@Module({
  imports: [AuthModule, LicenseModule, PrismaModule],
  controllers: [ScanEventsController],
  providers: [ScanEventsService],
})
export class ScanEventsModule {}
