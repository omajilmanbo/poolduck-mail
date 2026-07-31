import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUserResponse } from '../auth/auth.types';
import { LocationAccessService } from '../location-access/location-access.service';
import { PrismaService } from '../prisma.service';
import {
  CreateLocationDto,
  CreatePersonMappingDto,
  UpdateLocationDto,
  UpdatePersonMappingDto,
} from './dto';
import {
  LocationResponse,
  PersonMappingDetailResponse,
  PersonMappingResponse,
} from './locations.types';
import { LocationCodeGenerator } from './location-code.generator';
import { PersonCodeGenerator } from './person-code.generator';

const LOCATION_CODE_CREATE_ATTEMPTS = 5;
const PERSON_CODE_CREATE_ATTEMPTS = 5;
const DELETION_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly locationCodeGenerator: LocationCodeGenerator,
    private readonly personCodeGenerator: PersonCodeGenerator,
    private readonly locationAccess: LocationAccessService,
  ) {}

  async listLocations(
    user: AuthenticatedUserResponse,
    includeDeleted = false,
  ): Promise<LocationResponse[]> {
    const locations = await this.prisma.location.findMany({
      where:
        user.role === 'tenant_manager'
          ? {
              tenantId: user.tenant_id,
              status: includeDeleted
                ? { not: 'purged' }
                : { notIn: ['pending_delete', 'purged'] },
            }
          : this.locationAccess.locationWhere(user, {
              status: { notIn: ['pending_delete', 'purged'] },
            }),
      orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        locationCode: true,
        name: true,
        type: true,
        status: true,
        deletedAt: true,
        purgeAfter: true,
      },
    });

    return locations.map((location) => this.toLocationResponse(location));
  }

  async listPeople(
    user: AuthenticatedUserResponse,
    locationId: string,
    includeDeleted = false,
  ): Promise<PersonMappingResponse[]> {
    const location = await this.assertLocation(user, locationId);

    const people = await this.prisma.personMapping.findMany({
      where: {
        tenantId: user.tenant_id,
        locationId: location.id,
        status: includeDeleted
          ? { not: 'purged' }
          : { notIn: ['pending_delete', 'purged'] },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        personCode: true,
        personName: true,
        email: true,
        status: true,
        deletedAt: true,
        purgeAfter: true,
      },
    });

    return people.map((person) => this.toPersonResponse(person));
  }

  async getPerson(
    user: AuthenticatedUserResponse,
    locationId: string,
    personId: string,
  ): Promise<PersonMappingDetailResponse> {
    const location = await this.assertLocation(user, locationId);
    const person = await this.prisma.personMapping.findFirst({
      where: this.personLookupWhere(user.tenant_id, location.id, personId),
      select: {
        personCode: true,
        locationId: true,
        personName: true,
        email: true,
        status: true,
      },
    });
    if (!person) {
      throw new NotFoundException({
        code: 'PERSON_MAPPING_NOT_FOUND',
        message: '人员映射不存在或不属于当前租户/location',
      });
    }
    return this.toPersonDetail(person, location.locationCode);
  }

  async createPerson(
    user: AuthenticatedUserResponse,
    locationId: string,
    dto: CreatePersonMappingDto,
  ): Promise<PersonMappingDetailResponse> {
    const location = await this.assertLocation(user, locationId, true);
    for (let attempt = 1; attempt <= PERSON_CODE_CREATE_ATTEMPTS; attempt += 1) {
      const personCode = this.personCodeGenerator.generate();
      try {
        const person = await this.prisma.personMapping.create({
          data: {
            tenantId: user.tenant_id,
            locationId: location.id,
            personCode,
            scanCode: personCode,
            personName: dto.person_name.trim(),
            email: dto.email.trim().toLowerCase(),
            status: 'active',
          },
          select: {
            personCode: true,
            locationId: true,
            personName: true,
            email: true,
            status: true,
          },
        });
        await this.auditMutation(
          user,
          'person_mapping.created',
          person.personCode,
          location.locationCode,
        );
        return this.toPersonDetail(person, location.locationCode);
      } catch (error) {
        if (!this.isUniqueConflict(error)) {
          throw error;
        }
      }
    }

    await this.audit.record({
      tenantId: user.tenant_id,
      actorUserId: user.user_id,
      action: 'person_mapping.code_generation_failed',
      resourceType: 'person_mapping',
      resourceId: location.locationCode,
      result: 'failure',
      metadata: {
        location_id: location.locationCode,
        collision_retries: PERSON_CODE_CREATE_ATTEMPTS,
      },
    });
    throw new ServiceUnavailableException({
      code: 'PERSON_CODE_GENERATION_EXHAUSTED',
      message: '人员 ID 生成失败，请稍后重试',
    });
  }

  async updatePerson(
    user: AuthenticatedUserResponse,
    locationId: string,
    personId: string,
    dto: UpdatePersonMappingDto,
  ): Promise<PersonMappingDetailResponse> {
    const location = await this.assertLocation(user, locationId, true);
    const existing = await this.prisma.personMapping.findFirst({
      where: this.personLookupWhere(user.tenant_id, location.id, personId),
      select: { id: true, personCode: true },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'PERSON_MAPPING_NOT_FOUND',
        message: '人员映射不存在或不属于当前租户/location',
      });
    }
    const person = await this.prisma.personMapping.update({
      where: { id: existing.id },
      data: {
        ...(dto.person_name !== undefined ? { personName: dto.person_name.trim() } : {}),
        ...(dto.email !== undefined ? { email: dto.email.trim().toLowerCase() } : {}),
      },
      select: {
        personCode: true,
        locationId: true,
        personName: true,
        email: true,
        status: true,
      },
    });
    await this.auditMutation(
      user,
      'person_mapping.updated',
      person.personCode,
      location.locationCode,
    );
    return this.toPersonDetail(person, location.locationCode);
  }

  async setPersonStatus(
    user: AuthenticatedUserResponse,
    locationIdentifier: string,
    personId: string,
    status: 'active' | 'inactive',
  ): Promise<PersonMappingDetailResponse> {
    const location = await this.assertLocation(
      user,
      locationIdentifier,
      status === 'active',
    );
    const existing = await this.prisma.personMapping.findFirst({
      where: this.personLookupWhere(user.tenant_id, location.id, personId),
      select: { id: true, personCode: true, status: true },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'PERSON_MAPPING_NOT_FOUND',
        message: '人员映射不存在或不属于当前租户/location',
      });
    }
    if (existing.status === status) {
      throw new ConflictException({
        code:
          status === 'active'
            ? 'PERSON_ALREADY_ACTIVE'
            : 'PERSON_ALREADY_INACTIVE',
        message: status === 'active' ? '人员已经启用' : '人员已经停用',
      });
    }
    const person = await this.prisma.personMapping.update({
      where: { id: existing.id },
      data: { status },
      select: {
        personCode: true,
        locationId: true,
        personName: true,
        email: true,
        status: true,
      },
    });
    await this.auditMutation(
      user,
      status === 'active'
        ? 'person_mapping.reactivated'
        : 'person_mapping.deactivated',
      person.personCode,
      location.locationCode,
    );
    return this.toPersonDetail(person, location.locationCode);
  }

  async schedulePersonDeletion(
    user: AuthenticatedUserResponse,
    locationIdentifier: string,
    personId: string,
  ): Promise<PersonMappingDetailResponse> {
    const location = await this.assertLocation(user, locationIdentifier, true);
    const existing = await this.prisma.personMapping.findFirst({
      where: {
        tenantId: user.tenant_id,
        locationId: location.id,
        personCode: this.normalizePersonCode(personId),
        status: { not: 'purged' },
      },
      select: {
        id: true,
        personCode: true,
        status: true,
      },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'PERSON_MAPPING_NOT_FOUND',
        message: '人员映射不存在或不属于当前租户/location',
      });
    }
    if (existing.status === 'pending_delete') {
      throw new ConflictException({
        code: 'PERSON_DELETION_ALREADY_SCHEDULED',
        message: '人员已经进入待删除状态',
      });
    }
    const now = await this.databaseNow();
    const person = await this.prisma.personMapping.update({
      where: { id: existing.id },
      data: {
        status: 'pending_delete',
        deletedAt: now,
        purgeAfter: new Date(now.getTime() + DELETION_RETENTION_MS),
        deletedFromStatus: existing.status,
      },
      select: {
        personCode: true,
        locationId: true,
        personName: true,
        email: true,
        status: true,
        deletedAt: true,
        purgeAfter: true,
      },
    });
    await this.auditMutation(
      user,
      'person_mapping.deletion_scheduled',
      person.personCode,
      location.locationCode,
    );
    return this.toPersonDetail(person, location.locationCode);
  }

  async restorePerson(
    user: AuthenticatedUserResponse,
    locationIdentifier: string,
    personId: string,
  ): Promise<PersonMappingDetailResponse> {
    const location = await this.assertLocation(user, locationIdentifier, true);
    const now = await this.databaseNow();
    const existing = await this.prisma.personMapping.findFirst({
      where: {
        tenantId: user.tenant_id,
        locationId: location.id,
        personCode: this.normalizePersonCode(personId),
        status: 'pending_delete',
      },
      select: {
        id: true,
        personCode: true,
        locationId: true,
        personName: true,
        email: true,
        deletedFromStatus: true,
        purgeAfter: true,
      },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'PERSON_MAPPING_NOT_FOUND',
        message: '人员映射不存在或不属于当前租户/location',
      });
    }
    if (!existing.purgeAfter || existing.purgeAfter <= now) {
      await this.audit.record({
        tenantId: user.tenant_id,
        actorUserId: user.user_id,
        action: 'person_mapping.restore_expired',
        resourceType: 'person_mapping',
        resourceId: existing.personCode,
        result: 'denied',
        metadata: { location_id: location.locationCode },
      });
      throw new ConflictException({
        code: 'DELETION_RESTORE_EXPIRED',
        message: '14 天恢复期限已结束，无法恢复',
      });
    }
    const restoredStatus =
      existing.deletedFromStatus === 'inactive' ? 'inactive' : 'active';
    const claimed = await this.prisma.personMapping.updateMany({
      where: {
        id: existing.id,
        tenantId: user.tenant_id,
        status: 'pending_delete',
        purgeAfter: { gt: now },
      },
      data: {
        status: restoredStatus,
        deletedAt: null,
        purgeAfter: null,
        deletedFromStatus: null,
      },
    });
    if (claimed.count !== 1) {
      throw new ConflictException({
        code: 'DELETION_RESTORE_EXPIRED',
        message: '14 天恢复期限已结束，无法恢复',
      });
    }
    const restored = {
      ...existing,
      status: restoredStatus,
      deletedAt: null,
      purgeAfter: null,
    };
    await this.auditMutation(
      user,
      'person_mapping.restored',
      restored.personCode,
      location.locationCode,
    );
    return this.toPersonDetail(restored, location.locationCode);
  }

  async createLocation(
    user: AuthenticatedUserResponse,
    dto: CreateLocationDto,
  ): Promise<LocationResponse> {
    const name = dto.location_name.trim();
    for (
      let attempt = 1;
      attempt <= LOCATION_CODE_CREATE_ATTEMPTS;
      attempt += 1
    ) {
      const locationCode = this.locationCodeGenerator.generate();
      try {
        const location = await this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${user.tenant_id}, 0))`,
          );
          const [tenant, usage, duplicate, legacyCollision, codeCollision] =
            await Promise.all([
              tx.tenant.findUnique({
                where: { id: user.tenant_id },
                select: { locationLimit: true },
              }),
              tx.location.count({
                where: {
                  tenantId: user.tenant_id,
                  status: { not: 'purged' },
                },
              }),
              tx.location.findFirst({
                where: {
                  tenantId: user.tenant_id,
                  name: { equals: name, mode: 'insensitive' },
                },
                select: { id: true },
              }),
              tx.locationLegacyIdentifier.findFirst({
                where: {
                  tenantId: user.tenant_id,
                  legacyCode: locationCode,
                },
                select: { id: true },
              }),
              tx.location.findFirst({
                where: {
                  tenantId: user.tenant_id,
                  locationCode,
                },
                select: { id: true },
              }),
            ]);
          if (!tenant) {
            throw new NotFoundException({
              code: 'TENANT_NOT_FOUND',
              message: 'tenant 不存在',
            });
          }
          if (usage >= tenant.locationLimit) {
            throw new ConflictException({
              code: 'LOCATION_LIMIT_REACHED',
              message: '地点数量已达到当前额度',
            });
          }
          if (duplicate) {
            throw new ConflictException({
              code: 'LOCATION_NAME_CONFLICT',
              message: '当前租户已存在同名地点',
            });
          }
          if (legacyCollision || codeCollision) return null;
          return tx.location.create({
            data: {
              tenantId: user.tenant_id,
              locationCode,
              name,
              type: 'location',
              status: 'active',
            },
            select: {
              id: true,
              locationCode: true,
              name: true,
              type: true,
              status: true,
            },
          });
        });
        if (!location) continue;
        await this.auditMutation(
          user,
          'location.created',
          location.locationCode,
          location.locationCode,
        );
        return this.toLocationResponse(location);
      } catch (error) {
        if (
          error instanceof ConflictException &&
          (error.getResponse() as { code?: string }).code ===
            'LOCATION_LIMIT_REACHED'
        ) {
          await this.audit.record({
            tenantId: user.tenant_id,
            actorUserId: user.user_id,
            action: 'location.create',
            resourceType: 'location',
            resourceId: user.tenant_id,
            result: 'denied',
            metadata: { reason: 'LOCATION_LIMIT_REACHED' },
          });
        }
        if (!this.isUniqueConflict(error)) throw error;
      }
    }
    await this.audit.record({
      tenantId: user.tenant_id,
      actorUserId: user.user_id,
      action: 'location.code_generation_failed',
      resourceType: 'location',
      resourceId: user.tenant_id,
      result: 'failure',
      metadata: { collision_retries: LOCATION_CODE_CREATE_ATTEMPTS },
    });
    throw new ServiceUnavailableException({
      code: 'LOCATION_CODE_GENERATION_EXHAUSTED',
      message: '地点 ID 生成失败，请稍后重试',
    });
  }

  async updateLocation(
    user: AuthenticatedUserResponse,
    locationId: string,
    dto: UpdateLocationDto,
  ): Promise<LocationResponse> {
    if (dto.location_name === undefined) {
      throw new BadRequestException({
        code: 'EMPTY_LOCATION_UPDATE',
        message: '至少提供地点名称',
      });
    }
    const existing = await this.assertLocation(user, locationId);
    const name = dto.location_name.trim();
    await this.assertLocationNameAvailable(user.tenant_id, name, existing.id);
    const location = await this.prisma.location.update({
      where: { id: existing.id },
      data: { name },
      select: {
        id: true,
        locationCode: true,
        name: true,
        type: true,
        status: true,
      },
    });
    await this.auditMutation(
      user,
      'location.updated',
      location.locationCode,
      location.locationCode,
    );
    return this.toLocationResponse(location);
  }

  async setLocationStatus(
    user: AuthenticatedUserResponse,
    locationIdentifier: string,
    status: 'active' | 'inactive',
  ): Promise<LocationResponse> {
    const existing = await this.assertLocation(user, locationIdentifier);
    if (existing.status === status) {
      throw new ConflictException({
        code:
          status === 'active'
            ? 'LOCATION_ALREADY_ACTIVE'
            : 'LOCATION_ALREADY_INACTIVE',
        message: status === 'active' ? '地点已经启用' : '地点已经停用',
      });
    }
    const location = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.location.update({
        where: { id: existing.id },
        data: { status },
        select: {
          id: true,
          locationCode: true,
          name: true,
          type: true,
          status: true,
        },
      });
      if (status === 'inactive') {
        await tx.mailJob.updateMany({
          where: {
            tenantId: user.tenant_id,
            status: 'queued',
            scanEvent: { is: { locationId: existing.id } },
          },
          data: {
            status: 'failed',
            errorMessage: 'LOCATION_INACTIVE',
          },
        });
      }
      return updated;
    });
    await this.auditMutation(
      user,
      status === 'active' ? 'location.reactivated' : 'location.deactivated',
      location.locationCode,
      location.locationCode,
    );
    return this.toLocationResponse(location);
  }

  async scheduleLocationDeletion(
    user: AuthenticatedUserResponse,
    locationIdentifier: string,
  ): Promise<LocationResponse> {
    const normalized = locationIdentifier.trim().toUpperCase();
    const existing = await this.prisma.location.findFirst({
      where: {
        tenantId: user.tenant_id,
        locationCode: normalized,
        status: { not: 'purged' },
      },
      select: {
        id: true,
        locationCode: true,
        status: true,
      },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'LOCATION_NOT_FOUND',
        message: 'location不存在或不属于当前租户',
      });
    }
    if (existing.status === 'pending_delete') {
      throw new ConflictException({
        code: 'LOCATION_DELETION_ALREADY_SCHEDULED',
        message: '地点已经进入待删除状态',
      });
    }
    const now = await this.databaseNow();
    const location = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.location.update({
        where: { id: existing.id },
        data: {
          status: 'pending_delete',
          deletedAt: now,
          purgeAfter: new Date(now.getTime() + DELETION_RETENTION_MS),
          deletedFromStatus: existing.status,
        },
        select: {
          id: true,
          locationCode: true,
          name: true,
          type: true,
          status: true,
          deletedAt: true,
          purgeAfter: true,
        },
      });
      await tx.mailJob.updateMany({
        where: {
          tenantId: user.tenant_id,
          status: 'queued',
          scanEvent: { is: { locationId: existing.id } },
        },
        data: {
          status: 'failed',
          errorMessage: 'LOCATION_PENDING_DELETION',
        },
      });
      return updated;
    });
    await this.auditMutation(
      user,
      'location.deletion_scheduled',
      location.locationCode,
      location.locationCode,
    );
    return this.toLocationResponse(location);
  }

  async restoreLocation(
    user: AuthenticatedUserResponse,
    locationIdentifier: string,
  ): Promise<LocationResponse> {
    const normalized = locationIdentifier.trim().toUpperCase();
    const now = await this.databaseNow();
    const existing = await this.prisma.location.findFirst({
      where: {
        tenantId: user.tenant_id,
        locationCode: normalized,
        status: 'pending_delete',
      },
      select: {
        id: true,
        locationCode: true,
        name: true,
        type: true,
        deletedFromStatus: true,
        purgeAfter: true,
      },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'LOCATION_NOT_FOUND',
        message: 'location不存在或不属于当前租户',
      });
    }
    if (!existing.purgeAfter || existing.purgeAfter <= now) {
      await this.audit.record({
        tenantId: user.tenant_id,
        actorUserId: user.user_id,
        action: 'location.restore_expired',
        resourceType: 'location',
        resourceId: existing.locationCode,
        result: 'denied',
      });
      throw new ConflictException({
        code: 'DELETION_RESTORE_EXPIRED',
        message: '14 天恢复期限已结束，无法恢复',
      });
    }
    const restoredStatus =
      existing.deletedFromStatus === 'inactive' ? 'inactive' : 'active';
    const claimed = await this.prisma.location.updateMany({
      where: {
        id: existing.id,
        tenantId: user.tenant_id,
        status: 'pending_delete',
        purgeAfter: { gt: now },
      },
      data: {
        status: restoredStatus,
        deletedAt: null,
        purgeAfter: null,
        deletedFromStatus: null,
      },
    });
    if (claimed.count !== 1) {
      throw new ConflictException({
        code: 'DELETION_RESTORE_EXPIRED',
        message: '14 天恢复期限已结束，无法恢复',
      });
    }
    const location = {
      ...existing,
      status: restoredStatus,
      deletedAt: null,
      purgeAfter: null,
    };
    await this.auditMutation(
      user,
      'location.restored',
      location.locationCode,
      location.locationCode,
    );
    return this.toLocationResponse(location);
  }

  private maskEmail(email: string): string {
    const [localPart, domain] = email.split('@');

    if (!localPart || !domain) {
      return '***';
    }

    if (localPart.length === 1) {
      return `*@${domain}`;
    }

    return `${localPart[0]}***${localPart[localPart.length - 1]}@${domain}`;
  }

  private async assertLocation(
    user: AuthenticatedUserResponse,
    locationId: string,
    requireActive = false,
  ) {
    const location = await this.locationAccess.assertLocation(user, locationId);
    if (requireActive && location.status !== 'active') {
      throw new ConflictException({
        code: 'LOCATION_INACTIVE',
        message: 'location已停用，不能写入人员映射',
      });
    }
    return location;
  }

  private toPersonDetail(person: {
    personCode: string;
    locationId: string;
    personName: string;
    email: string;
    status: string;
    deletedAt?: Date | null;
    purgeAfter?: Date | null;
  }, publicLocationId = person.locationId): PersonMappingDetailResponse {
    return {
      ...this.toPersonResponse(person),
      location_id: publicLocationId,
      email: person.email,
    };
  }

  private toPersonResponse(person: {
    personCode: string;
    personName: string;
    email: string;
    status: string;
    deletedAt?: Date | null;
    purgeAfter?: Date | null;
  }): PersonMappingResponse {
    return {
      person_id: person.personCode,
      person_code: person.personCode,
      person_name: person.personName,
      scan_code: person.personCode,
      email_masked: this.maskEmail(person.email),
      is_active: person.status === 'active',
      deletion_status:
        person.status === 'pending_delete' ? 'scheduled' : null,
      deleted_at: person.deletedAt?.toISOString() ?? null,
      purge_after: person.purgeAfter?.toISOString() ?? null,
    };
  }

  private toLocationResponse(location: {
    id: string;
    locationCode: string;
    name: string;
    type: string;
    status: string;
    deletedAt?: Date | null;
    purgeAfter?: Date | null;
  }): LocationResponse {
    return {
      location_id: location.locationCode,
      location_code: location.locationCode,
      location_name: location.name,
      type: location.type,
      is_active: location.status === 'active',
      deletion_status:
        location.status === 'pending_delete' ? 'scheduled' : null,
      deleted_at: location.deletedAt?.toISOString() ?? null,
      purge_after: location.purgeAfter?.toISOString() ?? null,
    };
  }

  private isUniqueConflict(error: unknown): boolean {
    return (
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002') ||
      (typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002')
    );
  }

  private normalizePersonCode(value: string): string {
    return value.trim().toUpperCase();
  }

  private async assertLocationNameAvailable(
    tenantId: string,
    name: string,
    excludeId?: string,
  ) {
    const duplicate = await this.prisma.location.findFirst({
      where: {
        tenantId,
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException({
        code: 'LOCATION_NAME_CONFLICT',
        message: '当前租户已存在同名地点',
      });
    }
  }

  private personLookupWhere(
    tenantId: string,
    locationId: string,
    identifier: string,
  ): Prisma.PersonMappingWhereInput {
    const personCode = this.normalizePersonCode(identifier);
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        identifier,
      );
    return {
      tenantId,
      locationId,
      status: { notIn: ['pending_delete', 'purged'] },
      ...(isUuid
        ? { OR: [{ personCode }, { id: identifier }] }
        : { personCode }),
    };
  }

  private async databaseNow(): Promise<Date> {
    const rows = await this.prisma.$queryRaw<Array<{ now: Date }>>(
      Prisma.sql`SELECT CURRENT_TIMESTAMP AS now`,
    );
    const now = rows[0]?.now;
    if (!now) {
      throw new ServiceUnavailableException({
        code: 'DATABASE_TIME_UNAVAILABLE',
        message: '无法读取数据库时间，请稍后重试',
      });
    }
    return now;
  }

  private async auditMutation(
    user: AuthenticatedUserResponse,
    action: string,
    resourceId: string,
    locationId: string,
  ) {
    await this.audit.record({
      tenantId: user.tenant_id,
      actorUserId: user.user_id,
      action,
      resourceType: action.startsWith('location.') ? 'location' : 'person_mapping',
      resourceId,
      result: 'success',
      metadata: { location_id: locationId },
    });
  }
}
