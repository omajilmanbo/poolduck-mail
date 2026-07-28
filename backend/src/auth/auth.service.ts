import {
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { LoginDto } from './dto';
import {
  AuthenticatedUserResponse,
  AuthTokenPayload,
  PublicAuthenticatedUserResponse,
} from './auth.types';
import {
  ACCESS_COOKIE_NAME,
  DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
  DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
  REFRESH_COOKIE_NAME,
} from './auth.constants';
import { AuditService } from '../audit/audit.service';
import {
  normalizeEmail,
  parseLoginIdentity,
} from './identity';
import { LoginRateLimiterService } from './login-rate-limiter.service';
import { normalizeTenantCode } from '../tenants/tenant-code.generator';

const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$UgDSqK4u6aW1VlnypZuvDw$+J8Xad+ShD8yU2FVCBeeihzR1/yM57cWIt76pnfF8Wk';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly audit: AuditService,
    private readonly loginRateLimiter: LoginRateLimiterService,
  ) {}

  async login(dto: LoginDto, sourceIp = 'unknown') {
    const tenantCode = dto.tenant_code
      ? normalizeTenantCode(dto.tenant_code)
      : '';
    const tenantLookupKey = tenantCode || dto.tenant_id || '';
    const rawIdentifier = dto.identifier ?? dto.email ?? '';
    if (
      (dto.tenant_id && tenantCode) ||
      (dto.tenant_id && !this.legacyTenantUuidLoginEnabled())
    ) {
      await this.failLogin(
        tenantLookupKey,
        rawIdentifier,
        dto.tenant_id && tenantCode
          ? 'TENANT_IDENTIFIER_CONFLICT'
          : 'LEGACY_TENANT_UUID_DISABLED',
      );
    }
    if (
      dto.identifier !== undefined &&
      dto.email !== undefined &&
      dto.identifier.trim().toLowerCase() !== normalizeEmail(dto.email)
    ) {
      await this.failLogin(
        tenantLookupKey,
        rawIdentifier,
        'IDENTIFIER_CONFLICT',
      );
    }

    if (!this.loginRateLimiter.allow(sourceIp, tenantLookupKey, rawIdentifier)) {
      await this.audit.record({
        action: 'auth.login',
        resourceType: 'user',
        resourceId: 'unknown',
        result: 'denied',
        metadata: {
          reason: 'RATE_LIMITED',
          tenant_hash: this.loginRateLimiter.fingerprint(tenantLookupKey),
          identifier_hash:
            this.loginRateLimiter.fingerprint(rawIdentifier.trim().toLowerCase()),
        },
      });
      throw new HttpException(
        { code: 'LOGIN_RATE_LIMITED', message: '登录尝试过于频繁，请稍后重试' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const identity = parseLoginIdentity(rawIdentifier);
    const tenant = await this.prisma.tenant.findUnique({
      where: tenantCode
        ? { tenantCode }
        : { id: dto.tenant_id as string },
      select: { id: true, tenantCode: true },
    });
    const user = identity
      ? await this.prisma.user.findFirst({
          where: {
            tenantId: tenant?.id ?? '00000000-0000-0000-0000-000000000000',
            ...(identity.kind === 'email'
              ? { email: identity.value }
              : { username: identity.value, role: 'operator' }),
          },
          select: {
            id: true,
            tenantId: true,
            username: true,
            email: true,
            passwordHash: true,
            role: true,
            status: true,
          },
        })
      : null;

    const passwordMatches = await this.verifyPassword(
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
      dto.password,
    );
    if (
      !tenant ||
      !identity ||
      !user ||
      user.status !== 'active' ||
      !passwordMatches
    ) {
      return this.failLogin(
        tenantLookupKey,
        rawIdentifier,
        !tenant
          ? 'TENANT_NOT_FOUND'
          : !identity
            ? 'IDENTIFIER_INVALID'
            : !user
              ? 'IDENTITY_NOT_FOUND'
              : user.status !== 'active'
                ? 'USER_DISABLED'
                : 'PASSWORD_INVALID',
      );
    }

    const sessionId = randomUUID();
    const tokens = await this.issueTokens(user, sessionId);
    await this.prisma.session.create({
      data: {
        id: sessionId,
        tenantId: user.tenantId,
        userId: user.id,
        refreshTokenHash: this.hashToken(tokens.refreshToken),
        expiresAt: new Date(Date.now() + this.refreshTtlSeconds() * 1000),
      },
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await this.audit.record({
      tenantId: user.tenantId,
      actorUserId: user.id,
      action: 'auth.login',
      resourceType: 'user',
      resourceId: user.id,
      result: 'success',
    });

    return {
      ...tokens,
      expiresIn: this.accessTtlSeconds(),
      user: this.toUserResponse({ ...user, tenantCode: tenant.tenantCode }),
    };
  }

  async refresh(cookieHeader: string | undefined) {
    let refreshToken: string;
    let payload: AuthTokenPayload;
    try {
      refreshToken = this.readCookie(cookieHeader, REFRESH_COOKIE_NAME);
      payload = await this.verifyRefreshToken(refreshToken);
    } catch (error) {
      await this.audit.record({ action: 'auth.refresh', resourceType: 'session', resourceId: 'unknown', result: 'failure', metadata: { reason: 'INVALID_REFRESH_TOKEN' } });
      throw error;
    }
    const session = await this.prisma.session.findFirst({
      where: {
        id: payload.session_id,
        tenantId: payload.tenant_id,
        userId: payload.user_id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        refreshTokenHash: true,
        user: {
          select: {
            id: true,
            tenantId: true,
            username: true,
            email: true,
            role: true,
            status: true,
            tenant: { select: { tenantCode: true } },
          },
        },
      },
    });
    if (!session || !this.hashMatches(session.refreshTokenHash, refreshToken)) {
      await this.audit.record({ tenantId: payload.tenant_id, actorUserId: payload.user_id, action: 'auth.refresh', resourceType: 'session', resourceId: payload.session_id ?? 'unknown', result: 'failure', metadata: { reason: 'REVOKED_OR_REPLAYED' } });
      throw this.invalidToken();
    }
    if (session.user.status !== 'active') {
      await this.revokeUserSessions(session.user.tenantId, session.user.id, 'USER_DISABLED');
      await this.audit.record({ tenantId: payload.tenant_id, actorUserId: payload.user_id, action: 'auth.refresh', resourceType: 'session', resourceId: session.id, result: 'denied', metadata: { reason: 'USER_DISABLED' } });
      throw this.disabledUser();
    }

    const tokens = await this.issueTokens(session.user, session.id);
    await this.prisma.session.update({
      where: { id: session.id },
      data: { refreshTokenHash: this.hashToken(tokens.refreshToken), lastUsedAt: new Date() },
    });
    await this.audit.record({ tenantId: payload.tenant_id, actorUserId: payload.user_id, action: 'auth.refresh', resourceType: 'session', resourceId: session.id, result: 'success' });
    return {
      ...tokens,
      expiresIn: this.accessTtlSeconds(),
      user: this.toUserResponse({
        ...session.user,
        tenantCode: session.user.tenant.tenantCode,
      }),
    };
  }

  async logout(cookieHeader: string | undefined) {
    const refreshToken = this.readCookie(cookieHeader, REFRESH_COOKIE_NAME, false);
    if (!refreshToken) return;
    try {
      const payload = await this.verifyRefreshToken(refreshToken);
      await this.prisma.session.updateMany({
        where: { id: payload.session_id, refreshTokenHash: this.hashToken(refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record({ tenantId: payload.tenant_id, actorUserId: payload.user_id, action: 'auth.logout', resourceType: 'session', resourceId: payload.session_id ?? 'unknown', result: 'success' });
    } catch {
      return;
    }
  }

  me(user: AuthenticatedUserResponse) {
    return {
      user: this.presentUser(user),
    };
  }

  async authenticate(
    authorizationHeader: string | undefined,
    cookieHeader?: string,
  ): Promise<AuthenticatedUserResponse> {
    const token = authorizationHeader
      ? this.extractBearerToken(authorizationHeader)
      : this.readCookie(cookieHeader, ACCESS_COOKIE_NAME);
    const payload = await this.verifyAccessToken(token);

    const user = await this.prisma.user.findFirst({
      where: {
        id: payload.user_id,
        tenantId: payload.tenant_id,
      },
      select: {
        id: true,
        tenantId: true,
        username: true,
        email: true,
        role: true,
        status: true,
        tenant: { select: { tenantCode: true } },
      },
    });

    if (!user) {
      throw this.invalidToken();
    }

    if (user.status !== 'active') {
      await this.revokeUserSessions(user.tenantId, user.id, 'USER_DISABLED');
      throw this.disabledUser();
    }

    return this.toUserResponse({
      ...user,
      tenantCode: user.tenant?.tenantCode ?? '',
    });
  }

  private async verifyPassword(passwordHash: string, password: string) {
    try {
      return await argon2.verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  private extractBearerToken(authorizationHeader: string | undefined) {
    if (!authorizationHeader) {
      throw this.invalidToken();
    }

    const [scheme, token] = authorizationHeader.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw this.invalidToken();
    }

    return token;
  }

  private async verifyAccessToken(token: string): Promise<AuthTokenPayload> {
    try {
      const payload = await this.jwtService.verifyAsync<AuthTokenPayload>(token);

      if (!payload.user_id || !payload.tenant_id || !payload.role || payload.token_type === 'refresh') {
        throw this.invalidToken();
      }

      return payload;
    } catch {
      throw this.invalidToken();
    }
  }

  private invalidToken() {
    return new UnauthorizedException({
      code: 'UNAUTHORIZED',
      message: '未认证',
    });
  }

  accessTtlSeconds() {
    return Number(process.env.JWT_ACCESS_TOKEN_TTL_SECONDS ?? DEFAULT_ACCESS_TOKEN_TTL_SECONDS);
  }

  refreshTtlSeconds() {
    return Number(process.env.JWT_REFRESH_TOKEN_TTL_SECONDS ?? DEFAULT_REFRESH_TOKEN_TTL_SECONDS);
  }

  cookieOptions() {
    return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const };
  }

  async revokeUserSessions(
    tenantId: string,
    userId: string,
    reason: 'USER_DISABLED' | 'PASSWORD_RESET' | 'IDENTITY_CHANGED',
    actorUserId = userId,
  ) {
    const result = await this.prisma.session.updateMany({
      where: { tenantId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      tenantId,
      actorUserId,
      action: 'auth.sessions.revoke',
      resourceType: 'user',
      resourceId: userId,
      result: 'success',
      metadata: { reason, count: result.count },
    });
    return result.count;
  }

  private async issueTokens(user: { id: string; tenantId: string; role: string }, sessionId: string) {
    const base: AuthTokenPayload = {
      sub: user.id, user_id: user.id, tenant_id: user.tenantId, role: user.role, session_id: sessionId,
    };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync({ ...base, token_type: 'access', jti: randomUUID() }, { expiresIn: this.accessTtlSeconds() }),
      this.jwtService.signAsync(
        { ...base, token_type: 'refresh', jti: randomUUID() },
        { expiresIn: this.refreshTtlSeconds(), secret: this.refreshSecret() },
      ),
    ]);
    return { accessToken, refreshToken };
  }

  private async verifyRefreshToken(token: string): Promise<AuthTokenPayload> {
    try {
      const payload = await this.jwtService.verifyAsync<AuthTokenPayload>(token, { secret: this.refreshSecret() });
      if (payload.token_type !== 'refresh' || !payload.session_id || !payload.user_id || !payload.tenant_id) throw new Error();
      return payload;
    } catch {
      throw this.invalidToken();
    }
  }

  private readCookie(cookieHeader: string | undefined, name: string, required = true) {
    const value = cookieHeader?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
    if (!value && required) throw this.invalidToken();
    return value ? decodeURIComponent(value) : '';
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private refreshSecret() {
    return process.env.REFRESH_TOKEN_SECRET ?? process.env.JWT_SECRET ?? 'local-development-jwt-secret';
  }

  private legacyTenantUuidLoginEnabled() {
    return process.env.AUTH_ACCEPT_LEGACY_TENANT_UUID === 'true';
  }

  private hashMatches(expected: string, token: string) {
    const actual = this.hashToken(token);
    return expected.length === actual.length && timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
  }

  private disabledUser() {
    return new UnauthorizedException({
      code: 'USER_DISABLED',
      message: '用户已停用',
    });
  }

  private async failLogin(
    tenantId: string,
    identifier: string,
    reason: string,
  ): Promise<never> {
    await this.audit.record({
      action: 'auth.login',
      resourceType: 'user',
      resourceId: 'unknown',
      result: 'failure',
      metadata: {
        reason,
        tenant_hash: this.loginRateLimiter.fingerprint(tenantId),
        identifier_hash:
          this.loginRateLimiter.fingerprint(identifier.trim().toLowerCase()),
      },
    });
    throw new UnauthorizedException({
      code: 'LOGIN_FAILED',
      message: '登录失败',
    });
  }

  private toUserResponse(user: {
    id: string;
    tenantId: string;
    tenantCode: string;
    username: string | null;
    email: string | null;
    role: string;
  }): AuthenticatedUserResponse {
    return {
      user_id: user.id,
      tenant_id: user.tenantId,
      tenant_code: user.tenantCode,
      username: user.username,
      email: user.email,
      role: user.role,
    };
  }

  presentUser(
    user: AuthenticatedUserResponse,
  ): PublicAuthenticatedUserResponse {
    return {
      user_id: user.user_id,
      tenant_code: user.tenant_code ?? '',
      username: user.username,
      email: user.email,
      role: user.role,
    };
  }
}
