import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { AuthenticatedUserResponse } from '../auth/auth.types';
import {
  isAllowedUsername,
  normalizeEmail,
  normalizeUsername,
} from '../auth/identity';
import { PrismaService } from '../prisma.service';
import {
  CreateOperatorDto,
  ResetOperatorPasswordDto,
  SetOperatorLocationAssignmentsDto,
  UpdateOperatorDto,
} from './dto';
import {
  ManagedOperatorResponse,
  OperatorLocationAssignmentResponse,
} from './users.types';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  async listOperators(
    actor: AuthenticatedUserResponse,
  ): Promise<ManagedOperatorResponse[]> {
    const rows = await this.prisma.user.findMany({
      where: { tenantId: actor.tenant_id, role: 'operator' },
      orderBy: [{ username: 'asc' }, { id: 'asc' }],
      select: this.userSelect(),
    });
    return rows.map((row) => this.toResponse(row));
  }

  async createOperator(
    actor: AuthenticatedUserResponse,
    dto: CreateOperatorDto,
  ): Promise<ManagedOperatorResponse> {
    const username = this.assertUsername(dto.username);
    try {
      const row = await this.prisma.user.create({
        data: {
          tenantId: actor.tenant_id,
          username,
          email: dto.email ? normalizeEmail(dto.email) : null,
          passwordHash: await argon2.hash(dto.password),
          role: 'operator',
          status: 'active',
        },
        select: this.userSelect(),
      });
      await this.record(actor, 'user.operator.created', row.id);
      return this.toResponse(row);
    } catch (error) {
      this.throwIdentityConflict(error);
      throw error;
    }
  }

  async updateOperator(
    actor: AuthenticatedUserResponse,
    userId: string,
    dto: UpdateOperatorDto,
  ): Promise<ManagedOperatorResponse> {
    if (
      dto.username === undefined &&
      dto.email === undefined &&
      dto.status === undefined &&
      dto.role === undefined
    ) {
      throw new BadRequestException({
        code: 'EMPTY_USER_UPDATE',
        message: '至少提供一个可更新字段',
      });
    }
    await this.assertManagedOperator(actor, userId);
    const username =
      dto.username === undefined ? undefined : this.assertUsername(dto.username);
    const identityChanged =
      dto.username !== undefined || dto.email !== undefined;
    try {
      const row = await this.prisma.user.update({
        where: { id: userId },
        data: {
          ...(username !== undefined ? { username } : {}),
          ...(dto.email !== undefined
            ? { email: dto.email ? normalizeEmail(dto.email) : null }
            : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(dto.role !== undefined ? { role: 'operator' } : {}),
        },
        select: this.userSelect(),
      });
      if (dto.status === 'inactive' || identityChanged) {
        await this.auth.revokeUserSessions(
          actor.tenant_id,
          userId,
          dto.status === 'inactive' ? 'USER_DISABLED' : 'IDENTITY_CHANGED',
          actor.user_id,
        );
      }
      await this.record(
        actor,
        dto.status === 'inactive'
          ? 'user.operator.disabled'
          : dto.status === 'active'
            ? 'user.operator.enabled'
            : 'user.operator.updated',
        userId,
      );
      return this.toResponse(row);
    } catch (error) {
      this.throwIdentityConflict(error);
      throw error;
    }
  }

  async resetOperatorPassword(
    actor: AuthenticatedUserResponse,
    userId: string,
    dto: ResetOperatorPasswordDto,
  ) {
    await this.assertManagedOperator(actor, userId);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await argon2.hash(dto.new_password) },
    });
    await this.auth.revokeUserSessions(
      actor.tenant_id,
      userId,
      'PASSWORD_RESET',
      actor.user_id,
    );
    await this.record(actor, 'user.operator.password_reset', userId);
    return { user_id: userId, status: 'password_reset' };
  }

  async listLocationAssignments(
    actor: AuthenticatedUserResponse,
    operatorId: string,
  ): Promise<OperatorLocationAssignmentResponse> {
    await this.assertManagedOperator(actor, operatorId);
    const assignments = await this.prisma.operatorLocationAssignment.findMany({
      where: {
        tenantId: actor.tenant_id,
        operatorId,
      },
      orderBy: [
        { location: { name: 'asc' } },
        { locationId: 'asc' },
      ],
      select: {
        location: {
          select: {
            id: true,
            locationCode: true,
            name: true,
            status: true,
          },
        },
      },
    });
    return this.toLocationAssignmentsResponse(operatorId, assignments);
  }

  async setLocationAssignments(
    actor: AuthenticatedUserResponse,
    operatorId: string,
    dto: SetOperatorLocationAssignmentsDto,
  ): Promise<OperatorLocationAssignmentResponse> {
    await this.assertManagedOperator(actor, operatorId);
    const locations = dto.location_ids.length
      ? await this.prisma.location.findMany({
          where: {
            tenantId: actor.tenant_id,
            id: { in: dto.location_ids },
            status: 'active',
          },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            locationCode: true,
            name: true,
            status: true,
          },
        })
      : [];
    if (locations.length !== dto.location_ids.length) {
      await this.recordAssignmentDenied(actor, operatorId);
      throw new NotFoundException({
        code: 'ASSIGNABLE_LOCATION_NOT_FOUND',
        message: '一个或多个 location 不存在、已停用或不属于当前租户',
      });
    }

    const existing = await this.prisma.operatorLocationAssignment.findMany({
      where: { tenantId: actor.tenant_id, operatorId },
      select: { locationId: true },
    });
    const requestedIds = new Set(dto.location_ids);
    const existingIds = new Set(existing.map((row) => row.locationId));
    await this.prisma.$transaction(async (tx) => {
      await tx.operatorLocationAssignment.deleteMany({
        where: {
          tenantId: actor.tenant_id,
          operatorId,
          locationId: { notIn: dto.location_ids },
        },
      });
      if (dto.location_ids.length) {
        await tx.operatorLocationAssignment.createMany({
          data: dto.location_ids.map((locationId) => ({
            tenantId: actor.tenant_id,
            operatorId,
            locationId,
          })),
          skipDuplicates: true,
        });
      }
    });

    await this.audit.record({
      tenantId: actor.tenant_id,
      actorUserId: actor.user_id,
      action: 'operator_location_assignment.set',
      resourceType: 'operator_location_assignment',
      resourceId: operatorId,
      result: 'success',
      metadata: {
        assignment_count: requestedIds.size,
        added_count: [...requestedIds].filter((id) => !existingIds.has(id)).length,
        revoked_count: [...existingIds].filter((id) => !requestedIds.has(id)).length,
      },
    });
    return this.toLocationAssignmentsResponse(
      operatorId,
      locations.map((location) => ({ location })),
    );
  }

  async revokeLocationAssignment(
    actor: AuthenticatedUserResponse,
    operatorId: string,
    locationId: string,
  ) {
    await this.assertManagedOperator(actor, operatorId);
    const location = await this.prisma.location.findFirst({
      where: { id: locationId, tenantId: actor.tenant_id },
      select: { id: true },
    });
    if (!location) {
      await this.recordAssignmentDenied(actor, operatorId);
      throw new NotFoundException({
        code: 'OPERATOR_LOCATION_ASSIGNMENT_NOT_FOUND',
        message: 'assignment 不存在或不属于当前租户',
      });
    }
    const deleted = await this.prisma.operatorLocationAssignment.deleteMany({
      where: {
        tenantId: actor.tenant_id,
        operatorId,
        locationId,
      },
    });
    if (deleted.count !== 1) {
      throw new NotFoundException({
        code: 'OPERATOR_LOCATION_ASSIGNMENT_NOT_FOUND',
        message: 'assignment 不存在或不属于当前租户',
      });
    }
    await this.audit.record({
      tenantId: actor.tenant_id,
      actorUserId: actor.user_id,
      action: 'operator_location_assignment.revoked',
      resourceType: 'operator_location_assignment',
      resourceId: operatorId,
      result: 'success',
      metadata: { location_id: locationId },
    });
    return {
      operator_id: operatorId,
      location_id: locationId,
      status: 'revoked',
    };
  }

  private async assertManagedOperator(
    actor: AuthenticatedUserResponse,
    userId: string,
  ) {
    const target = await this.prisma.user.findFirst({
      where: {
        id: userId,
        tenantId: actor.tenant_id,
        role: 'operator',
      },
      select: { id: true },
    });
    if (target) return;

    await this.audit.record({
      tenantId: actor.tenant_id,
      actorUserId: actor.user_id,
      action: 'authorization.user_management.denied',
      resourceType: 'user',
      resourceId: userId,
      result: 'denied',
    });
    throw new NotFoundException({
      code: 'MANAGED_OPERATOR_NOT_FOUND',
      message: 'operator不存在或不属于当前租户',
    });
  }

  private async recordAssignmentDenied(
    actor: AuthenticatedUserResponse,
    operatorId: string,
  ) {
    await this.audit.record({
      tenantId: actor.tenant_id,
      actorUserId: actor.user_id,
      action: 'authorization.operator_location_assignment.denied',
      resourceType: 'operator_location_assignment',
      resourceId: operatorId,
      result: 'denied',
    });
  }

  private async record(
    actor: AuthenticatedUserResponse,
    action: string,
    resourceId: string,
  ) {
    await this.audit.record({
      tenantId: actor.tenant_id,
      actorUserId: actor.user_id,
      action,
      resourceType: 'user',
      resourceId,
      result: 'success',
    });
  }

  private throwIdentityConflict(error: unknown): void {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const target = String(
        (error.meta as { target?: unknown } | undefined)?.target ?? '',
      );
      if (target.includes('username')) {
        throw new ConflictException({
          code: 'USER_USERNAME_CONFLICT',
          message: '当前租户已存在该 username',
        });
      }
      if (target.includes('email')) {
        throw new ConflictException({
          code: 'USER_EMAIL_CONFLICT',
          message: '当前租户已存在该 email',
        });
      }
      throw new ConflictException({
        code: 'USER_IDENTITY_CONFLICT',
        message: '当前租户已存在该登录身份',
      });
    }
  }

  private assertUsername(value: string): string {
    const normalized = normalizeUsername(value);
    if (!isAllowedUsername(normalized)) {
      throw new BadRequestException({
        code: 'USERNAME_RESERVED',
        message: '该 username 不可使用',
      });
    }
    return normalized;
  }

  private userSelect() {
    return {
      id: true,
      username: true,
      email: true,
      role: true,
      status: true,
      lastLoginAt: true,
      createdAt: true,
      updatedAt: true,
    } as const;
  }

  private toResponse(row: {
    id: string;
    username: string | null;
    email: string | null;
    role: string;
    status: string;
    lastLoginAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): ManagedOperatorResponse {
    if (!row.username) {
      throw new Error('Managed operator is missing a username.');
    }
    return {
      user_id: row.id,
      username: row.username,
      email: row.email,
      role: 'operator',
      status: row.status,
      last_login_at: row.lastLoginAt?.toISOString() ?? null,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }

  private toLocationAssignmentsResponse(
    operatorId: string,
    assignments: Array<{
      location: {
        id: string;
        locationCode: string;
        name: string;
        status: string;
      };
    }>,
  ): OperatorLocationAssignmentResponse {
    return {
      operator_id: operatorId,
      locations: assignments.map(({ location }) => ({
        location_id: location.id,
        location_code: location.locationCode,
        location_name: location.name,
        is_active: location.status === 'active',
      })),
    };
  }
}
