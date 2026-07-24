import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { LocationAccessService } from './location-access.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [LocationAccessService],
  exports: [LocationAccessService],
})
export class LocationAccessModule {}
