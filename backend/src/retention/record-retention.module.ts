import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { PlatformAuditService } from '../platform/platform-audit.service';
import { RecordRetentionService } from './record-retention.service';
import { RecordRetentionSchedulerService } from './record-retention-scheduler.service';

@Module({
  imports: [PrismaModule],
  providers: [PlatformAuditService, RecordRetentionService, RecordRetentionSchedulerService],
  exports: [RecordRetentionService],
})
export class RecordRetentionModule {}
