import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma.module';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';
import { LocationCodeGenerator } from './location-code.generator';
import { PersonCodeGenerator } from './person-code.generator';
import { DeletionPurgeService } from './deletion-purge.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [LocationsController],
  providers: [
    LocationsService,
    LocationCodeGenerator,
    PersonCodeGenerator,
    DeletionPurgeService,
  ],
  exports: [LocationsService, DeletionPurgeService],
})
export class LocationsModule {}
