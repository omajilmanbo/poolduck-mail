import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { LoginDto } from './dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthenticatedUserResponse } from './auth.types';
import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME } from './auth.constants';

type HttpRequest = {
  headers: { cookie?: string };
  ip?: string;
  socket?: { remoteAddress?: string };
};
type HttpResponse = {
  cookie(name: string, value: string, options: Record<string, unknown>): void;
  clearCookie(name: string, options: Record<string, unknown>): void;
};

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() request: HttpRequest,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    const session = await this.authService.login(
      dto,
      request.ip ?? request.socket?.remoteAddress ?? 'unknown',
    );
    this.setSessionCookies(response, session.accessToken, session.refreshToken);
    return { expires_in: session.expiresIn, user: session.user };
  }

  @Post('refresh')
  async refresh(@Req() request: HttpRequest, @Res({ passthrough: true }) response: HttpResponse) {
    const session = await this.authService.refresh(request.headers.cookie);
    this.setSessionCookies(response, session.accessToken, session.refreshToken);
    return { expires_in: session.expiresIn, user: session.user };
  }

  @Post('logout')
  async logout(@Req() request: HttpRequest, @Res({ passthrough: true }) response: HttpResponse) {
    await this.authService.logout(request.headers.cookie);
    const options = this.authService.cookieOptions();
    response.clearCookie(ACCESS_COOKIE_NAME, { ...options, path: '/' });
    response.clearCookie(REFRESH_COOKIE_NAME, { ...options, path: '/api/auth' });
    return { status: 'ok' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUserResponse) {
    return this.authService.me(user);
  }

  private setSessionCookies(response: HttpResponse, accessToken: string, refreshToken: string) {
    const options = this.authService.cookieOptions();
    response.cookie(ACCESS_COOKIE_NAME, accessToken, { ...options, path: '/', maxAge: this.authService.accessTtlSeconds() * 1000 });
    response.cookie(REFRESH_COOKIE_NAME, refreshToken, { ...options, path: '/api/auth', maxAge: this.authService.refreshTtlSeconds() * 1000 });
  }
}
