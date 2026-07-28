import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUserResponse } from '../auth/auth.types';
import { PrismaService } from '../prisma.service';

@Injectable()
export class LocationAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  locationWhere(
    user: AuthenticatedUserResponse,
    extra: Prisma.LocationWhereInput = {},
    includeDeleted = false,
  ): Prisma.LocationWhereInput {
    return {
      ...(includeDeleted
        ? {}
        : { status: { notIn: ['pending_delete', 'purged'] } }),
      ...extra,
      tenantId: user.tenant_id,
      ...(user.role === 'tenant_manager'
        ? {}
        : {
            operatorLocationAssignments: {
              some: {
                tenantId: user.tenant_id,
                operatorId: user.user_id,
              },
            },
          }),
    };
  }

  resourceLocationWhere(
    user: AuthenticatedUserResponse,
    includeDeleted = false,
  ) {
    return user.role === 'tenant_manager'
      ? {}
      : {
          location: {
            is: this.locationWhere(user, {}, includeDeleted),
          },
        };
  }

  async assertLocation(
    user: AuthenticatedUserResponse,
    locationIdentifier: string,
    includeDeleted = false,
  ): Promise<{ id: string; locationCode: string; status: string }> {
    const normalized = locationIdentifier.trim().toUpperCase();
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        locationIdentifier,
      );
    const location = await this.prisma.location.findFirst({
      where: this.locationWhere(
        user,
        {
          OR: [
            { locationCode: normalized },
            ...(isUuid ? [{ id: locationIdentifier }] : []),
            {
              legacyIdentifiers: {
                some: {
                  tenantId: user.tenant_id,
                  legacyCode: normalized,
                },
              },
            },
          ],
        },
        includeDeleted,
      ),
      select: { id: true, locationCode: true, status: true },
    });
    if (location) {
      return location;
    }

    await this.recordDenied(user, normalized);
    throw new NotFoundException({
      code: 'LOCATION_NOT_FOUND',
      message: 'location不存在或不属于当前租户',
    });
  }

  async recordDenied(
    user: AuthenticatedUserResponse,
    locationId: string,
  ): Promise<void> {
    await this.audit.record({
      tenantId: user.tenant_id,
      actorUserId: user.user_id,
      action: 'authorization.location.denied',
      resourceType: 'location',
      resourceId: locationId,
      result: 'denied',
    });
  }
}
