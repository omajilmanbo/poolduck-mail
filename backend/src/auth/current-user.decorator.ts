import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import {
  AuthenticatedRequest,
  AuthenticatedUserResponse,
} from './auth.types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUserResponse => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.auth) {
      throw new Error('Authenticated request context is missing.');
    }

    return request.auth;
  },
);
