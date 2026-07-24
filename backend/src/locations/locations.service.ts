import {
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
import { PersonCodeGenerator } from './person-code.generator';

const PERSON_CODE_CREATE_ATTEMPTS = 5;

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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
      location_id: location.id,
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
    await this.assertLocation(user, locationId);

    const people = await this.prisma.personMapping.findMany({
      where: {
        tenantId: user.tenant_id,
        locationId,
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
    await this.assertLocation(user, locationId);
    const person = await this.prisma.personMapping.findFirst({
      where: this.personLookupWhere(user.tenant_id, locationId, personId),
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
      location_id: person.locationId,
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
    await this.assertLocation(user, locationId, true);
    for (let attempt = 1; attempt <= PERSON_CODE_CREATE_ATTEMPTS; attempt += 1) {
      const personCode = this.personCodeGenerator.generate();
      try {
        const person = await this.prisma.personMapping.create({
          data: {
            tenantId: user.tenant_id,
            locationId,
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
          locationId,
        );
        return this.toPersonDetail(person);
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
      resourceId: locationId,
      result: 'failure',
      metadata: { location_id: locationId, collision_retries: PERSON_CODE_CREATE_ATTEMPTS },
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
    await this.assertLocation(user, locationId, true);
    const existing = await this.prisma.personMapping.findFirst({
      where: this.personLookupWhere(user.tenant_id, locationId, personId),
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
        ...(dto.status !== undefined ? { status: dto.status } : {}),
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
      dto.status === 'inactive' ? 'person_mapping.deactivated' : 'person_mapping.updated',
      person.personCode,
      locationId,
    );
    return this.toPersonDetail(person);
  }

  async createLocation(
    user: AuthenticatedUserResponse,
    dto: CreateLocationDto,
  ): Promise<LocationResponse> {
    await this.assertLocationQuotaAvailable(user.tenant_id);
    try {
      const location = await this.prisma.location.create({
        data: {
          tenantId: user.tenant_id,
          locationCode: dto.location_code.trim(),
          name: dto.location_name.trim(),
          type: dto.type,
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
      await this.auditMutation(user, 'location.created', location.id, location.id);
      return this.toLocationResponse(location);
    } catch (error) {
      this.throwUniqueConflict(error, 'LOCATION_CODE_CONFLICT', 'location_code 已存在');
      throw error;
    }
  }

  async updateLocation(
    user: AuthenticatedUserResponse,
    locationId: string,
    dto: UpdateLocationDto,
  ): Promise<LocationResponse> {
    await this.assertLocation(user, locationId);
    try {
      const location = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.location.update({
          where: { id: locationId },
          data: {
            ...(dto.location_code !== undefined
              ? { locationCode: dto.location_code.trim() }
              : {}),
            ...(dto.location_name !== undefined ? { name: dto.location_name.trim() } : {}),
            ...(dto.type !== undefined ? { type: dto.type } : {}),
            ...(dto.status !== undefined ? { status: dto.status } : {}),
          },
          select: {
            id: true,
            locationCode: true,
            name: true,
            type: true,
            status: true,
          },
        });
        if (dto.status === 'inactive') {
          await tx.mailJob.updateMany({
            where: {
              tenantId: user.tenant_id,
              status: 'queued',
              scanEvent: { is: { locationId } },
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
        dto.status === 'inactive' ? 'location.deactivated' : 'location.updated',
        location.id,
        location.id,
      );
      return this.toLocationResponse(location);
    } catch (error) {
      this.throwUniqueConflict(error, 'LOCATION_CODE_CONFLICT', 'location_code 已存在');
      throw error;
    }
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

  private async assertLocationQuotaAvailable(tenantId: string) {
    // Deliberate service-layer checkpoint. Plan allowances remain blocked by Issue #83.
    void tenantId;
    return;
  }

  private toPersonDetail(person: {
    personCode: string;
    locationId: string;
    personName: string;
    email: string;
    status: string;
  }): PersonMappingDetailResponse {
    return {
      person_id: person.personCode,
      person_code: person.personCode,
      location_id: person.locationId,
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
      location_id: location.id,
      location_code: location.locationCode,
      location_name: location.name,
      type: location.type,
      is_active: location.status === 'active',
    };
  }

  private throwUniqueConflict(error: unknown, code: string, message: string) {
    if (this.isUniqueConflict(error)) {
      throw new ConflictException({ code, message });
    }
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
