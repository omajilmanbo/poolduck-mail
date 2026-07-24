import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma.module';
import { UnmappedScansController } from './unmapped-scans.controller';
import { UnmappedScansService } from './unmapped-scans.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [UnmappedScansController],
  providers: [UnmappedScansService],
})
export class UnmappedScansModule {}
