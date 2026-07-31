import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { PlatformAuthenticatedRequest } from './platform.types';

export const CurrentPlatformAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<PlatformAuthenticatedRequest>()
      .platformAuth,
);
