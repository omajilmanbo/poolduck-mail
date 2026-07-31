import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  PLATFORM_ACCESS_COOKIE_NAME,
  PLATFORM_REFRESH_COOKIE_NAME,
} from './platform.constants';
import { PlatformAuthGuard } from './platform-auth.guard';
import { PlatformAuthService } from './platform-auth.service';
import { CurrentPlatformAdmin } from './platform-current-admin.decorator';
import { PlatformLoginDto } from './platform.dto';
import { AuthenticatedPlatformAdmin } from './platform.types';

type HttpRequest = {
  headers: { cookie?: string };
  ip?: string;
  socket?: { remoteAddress?: string };
};
type HttpResponse = {
  cookie(name: string, value: string, options: Record<string, unknown>): void;
  clearCookie(name: string, options: Record<string, unknown>): void;
};

@Controller('api/platform/auth')
export class PlatformAuthController {
  constructor(private readonly auth: PlatformAuthService) {}

  @Post('login')
  async login(
    @Body() dto: PlatformLoginDto,
    @Req() request: HttpRequest,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    const session = await this.auth.login(
      dto,
      request.ip ?? request.socket?.remoteAddress ?? 'unknown',
    );
    this.setCookies(response, session.accessToken, session.refreshToken);
    return { expires_in: session.expiresIn, admin: session.admin };
  }

  @Post('refresh')
  async refresh(
    @Req() request: HttpRequest,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    const session = await this.auth.refresh(request.headers.cookie);
    this.setCookies(response, session.accessToken, session.refreshToken);
    return { expires_in: session.expiresIn, admin: session.admin };
  }

  @Post('logout')
  async logout(
    @Req() request: HttpRequest,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    await this.auth.logout(request.headers.cookie);
    const options = this.auth.cookieOptions();
    response.clearCookie(PLATFORM_ACCESS_COOKIE_NAME, {
      ...options,
      path: '/',
    });
    response.clearCookie(PLATFORM_REFRESH_COOKIE_NAME, {
      ...options,
      path: '/api/platform',
    });
    return { status: 'ok' };
  }

  @Get('me')
  @UseGuards(PlatformAuthGuard)
  me(@CurrentPlatformAdmin() admin: AuthenticatedPlatformAdmin) {
    return { admin };
  }

  private setCookies(
    response: HttpResponse,
    accessToken: string,
    refreshToken: string,
  ) {
    const options = this.auth.cookieOptions();
    response.cookie(PLATFORM_ACCESS_COOKIE_NAME, accessToken, {
      ...options,
      path: '/',
      maxAge: this.auth.accessTtlSeconds() * 1000,
    });
    response.cookie(PLATFORM_REFRESH_COOKIE_NAME, refreshToken, {
      ...options,
      path: '/api/platform',
      maxAge: this.auth.refreshTtlSeconds() * 1000,
    });
  }
}
