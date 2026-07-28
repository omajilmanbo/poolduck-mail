import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma.service';

const PURGE_INTERVAL_MS = 60_000;
const PURGE_BATCH_SIZE = 20;

@Injectable()
export class DeletionPurgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeletionPurgeService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    if (
      process.env.NODE_ENV === 'test' ||
      process.env.DELETION_PURGE_PROCESSOR_ENABLED === 'false'
    ) {
      return;
    }
    void this.processDueDeletions().catch((error: unknown) => {
      this.logger.error('Initial delayed-deletion purge failed', error);
    });
    this.timer = setInterval(
      () =>
        void this.processDueDeletions().catch((error: unknown) => {
          this.logger.error('Delayed-deletion purge failed', error);
        }),
      PURGE_INTERVAL_MS,
    );
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async processDueDeletions(requestedNow?: Date) {
    if (this.running) return { locations: 0, people: 0 };
    this.running = true;
    try {
      const now = requestedNow ?? (await this.databaseNow());
      const locations = await this.prisma.location.findMany({
        where: {
          status: 'pending_delete',
          purgeAfter: { lte: now },
        },
        orderBy: [{ purgeAfter: 'asc' }, { id: 'asc' }],
        take: PURGE_BATCH_SIZE,
        select: { id: true, tenantId: true, locationCode: true },
      });
      let purgedPeopleWithLocations = 0;
      let purgedLocations = 0;
      for (const location of locations) {
        const purgeResult = await this.prisma.$transaction(async (tx) => {
          const claimed = await tx.location.updateMany({
            where: {
              id: location.id,
              tenantId: location.tenantId,
              status: 'pending_delete',
              purgeAfter: { lte: now },
            },
            data: {
              name: `[deleted location ${location.locationCode}]`,
              status: 'purged',
              deletedFromStatus: null,
            },
          });
          if (claimed.count === 0) {
            return { claimed: false, people: 0 };
          }
          const people = await tx.personMapping.updateMany({
            where: {
              tenantId: location.tenantId,
              locationId: location.id,
              status: { not: 'purged' },
            },
            data: {
              personName: '[deleted person]',
              email: 'deleted@invalid.local',
              status: 'purged',
              deletedFromStatus: null,
            },
          });
          await tx.operatorLocationAssignment.deleteMany({
            where: {
              tenantId: location.tenantId,
              locationId: location.id,
            },
          });
          await tx.locationLegacyIdentifier.deleteMany({
            where: {
              tenantId: location.tenantId,
              locationId: location.id,
            },
          });
          return { claimed: true, people: people.count };
        });
        if (!purgeResult.claimed) continue;
        purgedLocations += 1;
        purgedPeopleWithLocations += purgeResult.people;
        await this.audit.record({
          tenantId: location.tenantId,
          action: 'location.purged',
          resourceType: 'location',
          resourceId: location.locationCode,
          result: 'success',
          metadata: { purged_person_count: purgeResult.people },
        });
      }

      const people = await this.prisma.personMapping.findMany({
        where: {
          status: 'pending_delete',
          purgeAfter: { lte: now },
          location: { status: { not: 'purged' } },
        },
        orderBy: [{ purgeAfter: 'asc' }, { id: 'asc' }],
        take: PURGE_BATCH_SIZE,
        select: { id: true, tenantId: true, personCode: true, locationId: true },
      });
      let purgedPeople = 0;
      for (const person of people) {
        const result = await this.prisma.personMapping.updateMany({
          where: {
            id: person.id,
            tenantId: person.tenantId,
            status: 'pending_delete',
            purgeAfter: { lte: now },
          },
          data: {
            personName: '[deleted person]',
            email: 'deleted@invalid.local',
            status: 'purged',
            deletedFromStatus: null,
          },
        });
        if (result.count === 0) continue;
        purgedPeople += 1;
        await this.audit.record({
          tenantId: person.tenantId,
          action: 'person_mapping.purged',
          resourceType: 'person_mapping',
          resourceId: person.personCode,
          result: 'success',
          metadata: { location_internal_id: person.locationId },
        });
      }
      return {
        locations: purgedLocations,
        people: purgedPeopleWithLocations + purgedPeople,
      };
    } finally {
      this.running = false;
    }
  }

  private async databaseNow(): Promise<Date> {
    const rows = await this.prisma.$queryRaw<Array<{ now: Date }>>(
      Prisma.sql`SELECT CURRENT_TIMESTAMP AS now`,
    );
    const now = rows[0]?.now;
    if (!now) throw new Error('Database time is unavailable');
    return now;
  }
}
