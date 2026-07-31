import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedRequest, UserRole } from './auth.types';
import { ROLES_KEY } from './roles.decorator';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles =
      this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    if (requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const role = request.auth?.role;

    if (request.auth?.must_change_password) {
      throw new ForbiddenException({
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: '首次登录必须先修改临时密码',
      });
    }

    if (role && requiredRoles.includes(role as UserRole)) {
      return true;
    }

    await this.audit.record({
      tenantId: request.auth?.tenant_id,
      actorUserId: request.auth?.user_id,
      action: 'authorization.denied',
      resourceType: 'route',
      resourceId: context.getHandler().name,
      result: 'denied',
      metadata: { role: role ?? 'unknown', required_roles: requiredRoles },
    });

    throw new ForbiddenException({
      code: 'ROLE_FORBIDDEN',
      message: '当前角色无权访问该接口',
    });
  }
}
