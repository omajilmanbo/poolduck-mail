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
  ): Promise<LocationResponse[]> {
    const locations = await this.prisma.location.findMany({
      where: this.locationAccess.locationWhere(user),
      orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        locationCode: true,
        name: true,
        type: true,
        status: true,
      },
    });

    return locations.map((location) => ({
      location_id: location.locationCode,
      location_code: location.locationCode,
      location_name: location.name,
      type: location.type,
      is_active: location.status === 'active',
    }));
  }

  async listPeople(
    user: AuthenticatedUserResponse,
    locationId: string,
  ): Promise<PersonMappingResponse[]> {
    const location = await this.assertLocation(user, locationId);

    const people = await this.prisma.personMapping.findMany({
      where: {
        tenantId: user.tenant_id,
        locationId: location.id,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        personCode: true,
        personName: true,
        email: true,
        status: true,
      },
    });

    return people.map((person) => ({
      person_id: person.personCode,
      person_code: person.personCode,
      person_name: person.personName,
      scan_code: person.personCode,
      email_masked: this.maskEmail(person.email),
      is_active: person.status === 'active',
    }));
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
    return {
      person_id: person.personCode,
      person_code: person.personCode,
      location_id: location.locationCode,
      person_name: person.personName,
      scan_code: person.personCode,
      email: person.email,
      email_masked: this.maskEmail(person.email),
      is_active: person.status === 'active',
    };
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

  async createLocation(
    user: AuthenticatedUserResponse,
    dto: CreateLocationDto,
  ): Promise<LocationResponse> {
    const name = dto.location_name.trim();
    await this.assertLocationNameAvailable(user.tenant_id, name);
    for (
      let attempt = 1;
      attempt <= LOCATION_CODE_CREATE_ATTEMPTS;
      attempt += 1
    ) {
      const locationCode = this.locationCodeGenerator.generate();
      const legacyCollision =
        await this.prisma.locationLegacyIdentifier.findFirst({
          where: { tenantId: user.tenant_id, legacyCode: locationCode },
          select: { id: true },
        });
      if (legacyCollision) continue;
      try {
        const location = await this.prisma.location.create({
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
        await this.auditMutation(
          user,
          'location.created',
          location.locationCode,
          location.locationCode,
        );
        return this.toLocationResponse(location);
      } catch (error) {
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
  }, publicLocationId = person.locationId): PersonMappingDetailResponse {
    return {
      person_id: person.personCode,
      person_code: person.personCode,
      location_id: publicLocationId,
      person_name: person.personName,
      scan_code: person.personCode,
      email: person.email,
      email_masked: this.maskEmail(person.email),
      is_active: person.status === 'active',
    };
  }

  private toLocationResponse(location: {
    id: string;
    locationCode: string;
    name: string;
    type: string;
    status: string;
  }): LocationResponse {
    return {
      location_id: location.locationCode,
      location_code: location.locationCode,
      location_name: location.name,
      type: location.type,
      is_active: location.status === 'active',
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
      ...(isUuid
        ? { OR: [{ personCode }, { id: identifier }] }
        : { personCode }),
    };
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
