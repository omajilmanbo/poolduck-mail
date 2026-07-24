import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditController } from './audit.controller';
import { AuditModule } from './audit.module';

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [AuditController],
})
export class AuditApiModule {}
