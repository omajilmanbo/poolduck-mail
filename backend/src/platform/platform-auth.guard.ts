import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformAuthenticatedRequest } from './platform.types';

type RequestWithHeaders = PlatformAuthenticatedRequest & {
  headers: { authorization?: string; cookie?: string };
};

@Injectable()
export class PlatformAuthGuard implements CanActivate {
  constructor(private readonly auth: PlatformAuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<RequestWithHeaders>();
    request.platformAuth = await this.auth.authenticate(
      request.headers.authorization,
      request.headers.cookie,
    );
    return true;
  }
}
