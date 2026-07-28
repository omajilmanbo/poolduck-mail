import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUserResponse } from '../auth/auth.types';
import { LocationAccessService } from '../location-access/location-access.service';
import { PrismaService } from '../prisma.service';
import { ListUnmappedScansDto, UpdateUnmappedScanDto } from './dto';
import { UnmappedScanCaseResponse } from './unmapped-scans.types';

@Injectable()
export class UnmappedScansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly locationAccess: LocationAccessService,
  ) {}

  async list(user: AuthenticatedUserResponse, query: ListUnmappedScansDto) {
    const selectedLocation = query.location_id
      ? await this.locationAccess.assertLocation(user, query.location_id, true)
      : null;
    const rows = await this.prisma.unmappedScanCase.findMany({
      where: {
        tenantId: user.tenant_id,
        ...(selectedLocation ? { locationId: selectedLocation.id } : {}),
        ...(!query.location_id
          ? this.locationAccess.resourceLocationWhere(user, true)
          : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
      select: this.select(),
    });
    return rows.map((row) => this.toResponse(row));
  }

  async getOne(user: AuthenticatedUserResponse, caseId: string) {
    const row = await this.prisma.unmappedScanCase.findFirst({
      where: {
        id: caseId,
        tenantId: user.tenant_id,
        ...this.locationAccess.resourceLocationWhere(user, true),
      },
      select: this.select(),
    });
    if (!row) this.notFound();
    return this.toResponse(row!);
  }

  async update(
    user: AuthenticatedUserResponse,
    caseId: string,
    dto: UpdateUnmappedScanDto,
  ) {
    const existing = await this.prisma.unmappedScanCase.findFirst({
      where: {
        id: caseId,
        tenantId: user.tenant_id,
        ...this.locationAccess.resourceLocationWhere(user),
      },
      select: {
        id: true,
        locationId: true,
        location: { select: { status: true } },
        scanEvent: { select: { scanCode: true } },
      },
    });
    if (!existing) {
      await this.audit.record({
        tenantId: user.tenant_id,
        actorUserId: user.user_id,
        action: 'authorization.unmapped_scan.denied',
        resourceType: 'unmapped_scan_case',
        resourceId: caseId,
        result: 'denied',
      });
      this.notFound();
    }
    if (existing!.location && existing!.location.status !== 'active') {
      throw new ConflictException({
        code: 'LOCATION_INACTIVE',
        message: 'location已停用，不能处理未映射扫码记录',
      });
    }

    if (dto.status === 'resolved') {
      const mapping = existing!.locationId
        ? await this.prisma.personMapping.findFirst({
            where: {
              tenantId: user.tenant_id,
              locationId: existing!.locationId,
              OR: [
                { personCode: existing!.scanEvent.scanCode.trim().toUpperCase() },
                { scanCode: existing!.scanEvent.scanCode.trim().toUpperCase() },
              ],
              status: 'active',
            },
            select: { id: true },
          })
        : null;
      if (!mapping) {
        throw new ConflictException({
          code: 'UNMAPPED_SCAN_NOT_RESOLVED',
          message: '尚未找到与该扫码记录匹配的 active 人员映射',
        });
      }
    }

    const row = await this.prisma.unmappedScanCase.update({
      where: { id: caseId },
      data: {
        status: dto.status,
        handledByUserId: user.user_id,
        handledAt: new Date(),
      },
      select: this.select(),
    });
    await this.audit.record({
      tenantId: user.tenant_id,
      actorUserId: user.user_id,
      action: `unmapped_scan.${dto.status}`,
      resourceType: 'unmapped_scan_case',
      resourceId: caseId,
      result: 'success',
      metadata: { scan_event_id: row.scanEvent.id },
    });
    return this.toResponse(row);
  }

  private select() {
    return {
      id: true,
      status: true,
      handledByUserId: true,
      handledAt: true,
      locationId: true,
      location: { select: { locationCode: true, name: true, status: true } },
      scanEvent: {
        select: { id: true, scanCode: true, receivedAt: true },
      },
    } as const;
  }

  private toResponse(row: {
    id: string;
    status: string;
    handledByUserId: string | null;
    handledAt: Date | null;
    locationId: string | null;
    location: { locationCode: string; name: string; status: string } | null;
    scanEvent: { id: string; scanCode: string; receivedAt: Date };
  }): UnmappedScanCaseResponse {
    const locationActive = row.location?.status === 'active';
    return {
      case_id: row.id,
      scan_event_id: row.scanEvent.id,
      location_id: row.location?.locationCode ?? null,
      location_name: row.location?.name ?? null,
      location_active: locationActive,
      scan_code: row.scanEvent.scanCode,
      received_at: row.scanEvent.receivedAt.toISOString(),
      status: row.status,
      handled_by_user_id: row.handledByUserId,
      handled_at: row.handledAt?.toISOString() ?? null,
      mapping_prefill_allowed: Boolean(row.locationId && locationActive),
    };
  }

  private notFound(): never {
    throw new NotFoundException({
      code: 'UNMAPPED_SCAN_NOT_FOUND',
      message: '未映射扫码记录不存在或不属于当前租户',
    });
  }
}
