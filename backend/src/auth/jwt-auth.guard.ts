import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthenticatedRequest } from './auth.types';

type RequestWithHeaders = AuthenticatedRequest & {
  headers: {
    authorization?: string;
    cookie?: string;
  };
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithHeaders>();
    request.auth = await this.authService.authenticate(
      request.headers.authorization,
      request.headers.cookie,
    );

    return true;
  }
}
