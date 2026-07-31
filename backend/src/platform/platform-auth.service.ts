import {
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import {
  createHash,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { LoginRateLimiterService } from '../auth/login-rate-limiter.service';
import { PrismaService } from '../prisma.service';
import {
  PLATFORM_ACCESS_COOKIE_NAME,
  PLATFORM_ACCESS_TTL_SECONDS,
  PLATFORM_AUDIENCE,
  PLATFORM_REFRESH_COOKIE_NAME,
  PLATFORM_REFRESH_TTL_SECONDS,
} from './platform.constants';
import { PlatformLoginDto } from './platform.dto';
import {
  AuthenticatedPlatformAdmin,
  PlatformTokenPayload,
} from './platform.types';
import { PlatformAuditService } from './platform-audit.service';

const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$UgDSqK4u6aW1VlnypZuvDw$+J8Xad+ShD8yU2FVCBeeihzR1/yM57cWIt76pnfF8Wk';

@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: PlatformAuditService,
    private readonly limiter: LoginRateLimiterService,
  ) {}

  async login(dto: PlatformLoginDto, sourceIp: string) {
    this.assertSecrets();
    if (!this.limiter.allow(sourceIp, 'platform', dto.email)) {
      await this.audit.record({
        action: 'platform.auth.login',
        resourceType: 'platform_admin',
        resourceId: 'unknown',
        result: 'denied',
        metadata: {
          reason: 'RATE_LIMITED',
          identity_hash: this.limiter.fingerprint(dto.email),
        },
      });
      throw new HttpException(
        { code: 'PLATFORM_LOGIN_RATE_LIMITED', message: '登录尝试过于频繁，请稍后重试' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const admin = await this.prisma.platformAdmin.findUnique({
      where: { email: dto.email },
    });
    const matches = await this.verifyPassword(
      admin?.passwordHash ?? DUMMY_PASSWORD_HASH,
      dto.password,
    );
    if (!admin || admin.status !== 'active' || !matches) {
      return this.failLogin(dto.email);
    }

    const sessionId = randomUUID();
    const tokens = await this.issueTokens(
      admin.id,
      admin.identityVersion,
      sessionId,
    );
    await this.prisma.platformSession.create({
      data: {
        id: sessionId,
        platformAdminId: admin.id,
        identityVersionSnapshot: admin.identityVersion,
        refreshTokenHash: this.hashToken(tokens.refreshToken),
        expiresAt: new Date(Date.now() + this.refreshTtlSeconds() * 1000),
      },
    });
    await this.prisma.platformAdmin.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });
    await this.audit.record({
      platformAdminId: admin.id,
      action: 'platform.auth.login',
      resourceType: 'platform_admin',
      resourceId: admin.id,
      result: 'success',
    });
    return {
      ...tokens,
      expiresIn: this.accessTtlSeconds(),
      admin: this.presentAdmin(admin.id, admin.email, admin.identityVersion, sessionId),
    };
  }

  async refresh(cookieHeader: string | undefined) {
    this.assertSecrets();
    const token = this.readCookie(cookieHeader, PLATFORM_REFRESH_COOKIE_NAME);
    const payload = await this.verifyRefreshToken(token);
    const session = await this.prisma.platformSession.findUnique({
      where: { id: payload.session_id },
      include: { platformAdmin: true },
    });
    if (
      !session ||
      session.platformAdminId !== payload.platform_admin_id ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.platformAdmin.status !== 'active' ||
      session.identityVersionSnapshot !== session.platformAdmin.identityVersion ||
      session.identityVersionSnapshot !== payload.identity_version ||
      !this.hashMatches(session.refreshTokenHash, token)
    ) {
      if (session && !session.revokedAt) {
        await this.prisma.platformSession.update({
          where: { id: session.id },
          data: { revokedAt: new Date() },
        });
      }
      await this.audit.record({
        platformAdminId: session?.platformAdminId,
        action: 'platform.auth.refresh',
        resourceType: 'platform_session',
        resourceId: payload.session_id,
        result: 'failure',
        metadata: { reason: 'REVOKED_OR_REPLAYED' },
      });
      throw this.invalidToken();
    }

    const tokens = await this.issueTokens(
      session.platformAdminId,
      session.platformAdmin.identityVersion,
      session.id,
    );
    await this.prisma.platformSession.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: this.hashToken(tokens.refreshToken),
        lastUsedAt: new Date(),
      },
    });
    return {
      ...tokens,
      expiresIn: this.accessTtlSeconds(),
      admin: this.presentAdmin(
        session.platformAdmin.id,
        session.platformAdmin.email,
        session.platformAdmin.identityVersion,
        session.id,
      ),
    };
  }

  async logout(cookieHeader: string | undefined) {
    const token = this.readCookie(
      cookieHeader,
      PLATFORM_REFRESH_COOKIE_NAME,
      false,
    );
    if (!token) return;
    try {
      const payload = await this.verifyRefreshToken(token);
      await this.prisma.platformSession.updateMany({
        where: {
          id: payload.session_id,
          refreshTokenHash: this.hashToken(token),
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
    } catch {
      return;
    }
  }

  async authenticate(
    authorizationHeader: string | undefined,
    cookieHeader?: string,
  ): Promise<AuthenticatedPlatformAdmin> {
    this.assertSecrets();
    const token = authorizationHeader
      ? this.extractBearerToken(authorizationHeader)
      : this.readCookie(cookieHeader, PLATFORM_ACCESS_COOKIE_NAME);
    const payload = await this.verifyAccessToken(token);
    const session = await this.prisma.platformSession.findUnique({
      where: { id: payload.session_id },
      include: { platformAdmin: true },
    });
    if (
      !session ||
      session.platformAdminId !== payload.platform_admin_id ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.platformAdmin.status !== 'active' ||
      session.identityVersionSnapshot !== session.platformAdmin.identityVersion ||
      payload.identity_version !== session.platformAdmin.identityVersion
    ) {
      throw this.invalidToken();
    }
    return this.presentAdmin(
      session.platformAdmin.id,
      session.platformAdmin.email,
      session.platformAdmin.identityVersion,
      session.id,
    );
  }

  cookieOptions() {
    return {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
    };
  }

  accessTtlSeconds() {
    return this.numberSetting(
      'PLATFORM_JWT_ACCESS_TOKEN_TTL_SECONDS',
      PLATFORM_ACCESS_TTL_SECONDS,
    );
  }

  refreshTtlSeconds() {
    return this.numberSetting(
      'PLATFORM_JWT_REFRESH_TOKEN_TTL_SECONDS',
      PLATFORM_REFRESH_TTL_SECONDS,
    );
  }

  private async issueTokens(
    adminId: string,
    identityVersion: number,
    sessionId: string,
  ) {
    const base = {
      sub: adminId,
      platform_admin_id: adminId,
      identity_version: identityVersion,
      session_id: sessionId,
    };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        { ...base, token_type: 'access', jti: randomUUID() },
        {
          secret: this.accessSecret(),
          audience: PLATFORM_AUDIENCE,
          expiresIn: this.accessTtlSeconds(),
        },
      ),
      this.jwt.signAsync(
        { ...base, token_type: 'refresh', jti: randomUUID() },
        {
          secret: this.refreshSecret(),
          audience: PLATFORM_AUDIENCE,
          expiresIn: this.refreshTtlSeconds(),
        },
      ),
    ]);
    return { accessToken, refreshToken };
  }

  private async verifyAccessToken(token: string) {
    try {
      const payload = await this.jwt.verifyAsync<PlatformTokenPayload>(token, {
        secret: this.accessSecret(),
        audience: PLATFORM_AUDIENCE,
      });
      if (
        payload.token_type !== 'access' ||
        !payload.platform_admin_id ||
        !payload.session_id
      ) {
        throw new Error();
      }
      return payload;
    } catch {
      throw this.invalidToken();
    }
  }

  private async verifyRefreshToken(token: string) {
    try {
      const payload = await this.jwt.verifyAsync<PlatformTokenPayload>(token, {
        secret: this.refreshSecret(),
        audience: PLATFORM_AUDIENCE,
      });
      if (
        payload.token_type !== 'refresh' ||
        !payload.platform_admin_id ||
        !payload.session_id
      ) {
        throw new Error();
      }
      return payload;
    } catch {
      throw this.invalidToken();
    }
  }

  private presentAdmin(
    id: string,
    email: string,
    identityVersion: number,
    sessionId: string,
  ): AuthenticatedPlatformAdmin {
    const [local = '', domain = ''] = email.split('@');
    const masked =
      local.length <= 1
        ? `*@${domain}`
        : `${local[0]}***${local.at(-1)}@${domain}`;
    return {
      platform_admin_id: id,
      email_masked: masked,
      identity_version: identityVersion,
      session_id: sessionId,
    };
  }

  private async failLogin(email: string): Promise<never> {
    await this.audit.record({
      action: 'platform.auth.login',
      resourceType: 'platform_admin',
      resourceId: 'unknown',
      result: 'failure',
      metadata: {
        reason: 'LOGIN_FAILED',
        identity_hash: this.limiter.fingerprint(email),
      },
    });
    throw new UnauthorizedException({
      code: 'PLATFORM_LOGIN_FAILED',
      message: '登录失败',
    });
  }

  private async verifyPassword(hash: string, password: string) {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private hashMatches(expected: string, token: string) {
    const actual = this.hashToken(token);
    return (
      expected.length === actual.length &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(actual))
    );
  }

  private readCookie(
    header: string | undefined,
    name: string,
    required = true,
  ) {
    const value = header
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`))
      ?.slice(name.length + 1);
    if (!value && required) throw this.invalidToken();
    return value ? decodeURIComponent(value) : '';
  }

  private extractBearerToken(header: string) {
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw this.invalidToken();
    return token;
  }

  private invalidToken() {
    return new UnauthorizedException({
      code: 'PLATFORM_UNAUTHORIZED',
      message: '未认证',
    });
  }

  private accessSecret() {
    return process.env.PLATFORM_JWT_SECRET as string;
  }

  private refreshSecret() {
    return process.env.PLATFORM_REFRESH_TOKEN_SECRET as string;
  }

  private assertSecrets() {
    if (
      !process.env.PLATFORM_JWT_SECRET ||
      !process.env.PLATFORM_REFRESH_TOKEN_SECRET
    ) {
      throw new ServiceUnavailableException({
        code: 'PLATFORM_AUTH_NOT_CONFIGURED',
        message: '平台认证尚未配置',
      });
    }
  }

  private numberSetting(name: string, fallback: number) {
    const value = Number(process.env[name] ?? fallback);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
}
