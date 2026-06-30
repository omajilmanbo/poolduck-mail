import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma.service';
import { LoginDto } from './dto';
import {
  AuthenticatedUserResponse,
  AuthTokenPayload,
} from './auth.types';
import { DEFAULT_ACCESS_TOKEN_TTL_SECONDS } from './auth.constants';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: dto.tenant_id },
      select: { id: true },
    });

    if (!tenant) {
      throw new NotFoundException({
        code: 'TENANT_NOT_FOUND',
        message: 'tenant不存在',
      });
    }

    const user = await this.prisma.user.findFirst({
      where: {
        tenantId: dto.tenant_id,
        email: dto.email,
      },
      select: {
        id: true,
        tenantId: true,
        email: true,
        passwordHash: true,
        role: true,
      },
    });

    if (!user || !(await this.verifyPassword(user.passwordHash, dto.password))) {
      throw new UnauthorizedException({
        code: 'LOGIN_FAILED',
        message: '登录失败',
      });
    }

    const payload: AuthTokenPayload = {
      sub: user.id,
      user_id: user.id,
      tenant_id: user.tenantId,
      role: user.role,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return {
      access_token: accessToken,
      expires_in: Number(
        process.env.JWT_ACCESS_TOKEN_TTL_SECONDS ??
          DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
      ),
      user: this.toUserResponse(user),
    };
  }

  logout() {
    return {
      status: 'ok',
      strategy: 'stateless',
    };
  }

  me(user: AuthenticatedUserResponse) {
    return {
      user,
    };
  }

  async authenticate(
    authorizationHeader: string | undefined,
  ): Promise<AuthenticatedUserResponse> {
    const token = this.extractBearerToken(authorizationHeader);
    const payload = await this.verifyAccessToken(token);

    const user = await this.prisma.user.findFirst({
      where: {
        id: payload.user_id,
        tenantId: payload.tenant_id,
      },
      select: {
        id: true,
        tenantId: true,
        email: true,
        role: true,
      },
    });

    if (!user) {
      throw this.invalidToken();
    }

    return this.toUserResponse(user);
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

      if (!payload.user_id || !payload.tenant_id || !payload.role) {
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

  private toUserResponse(user: {
    id: string;
    tenantId: string;
    email: string;
    role: string;
  }): AuthenticatedUserResponse {
    return {
      user_id: user.id,
      tenant_id: user.tenantId,
      email: user.email,
      role: user.role,
    };
  }
}
