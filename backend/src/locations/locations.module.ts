import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma.module';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';
import { PersonCodeGenerator } from './person-code.generator';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [LocationsController],
  providers: [LocationsService, PersonCodeGenerator],
  exports: [LocationsService],
})
export class LocationsModule {}
