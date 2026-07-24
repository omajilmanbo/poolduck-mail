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
  ): Prisma.LocationWhereInput {
    return {
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

  resourceLocationWhere(user: AuthenticatedUserResponse) {
    return user.role === 'tenant_manager'
      ? {}
      : {
          location: {
            is: this.locationWhere(user),
          },
        };
  }

  async assertLocation(
    user: AuthenticatedUserResponse,
    locationId: string,
  ): Promise<{ id: string; status: string }> {
    const location = await this.prisma.location.findFirst({
      where: this.locationWhere(user, { id: locationId }),
      select: { id: true, status: true },
    });
    if (location) {
      return location;
    }

    await this.recordDenied(user, locationId);
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
