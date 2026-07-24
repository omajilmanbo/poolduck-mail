import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { LicenseCheckResponse, SubscriptionStatus } from './license.types';

@Injectable()
export class LicenseService {
  private readonly sendAllowedStatuses = new Set<SubscriptionStatus>([
    'trial',
    'active',
  ]);

  constructor(private readonly prisma: PrismaService) {}

  async checkTenantLicense(tenantId: string): Promise<LicenseCheckResponse> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
      select: {
        plan: true,
        status: true,
        endAt: true,
      },
    });

    if (!subscription) {
      throw new NotFoundException({
        code: 'SUBSCRIPTION_NOT_FOUND',
        message: '订阅不存在',
      });
    }

    return this.toLicenseCheckResponse(subscription);
  }

  canSendForStatus(status: string): boolean {
    return this.sendAllowedStatuses.has(status as SubscriptionStatus);
  }

  assertCanSend(status: string) {
    if (this.canSendForStatus(status)) {
      return;
    }

    throw new ForbiddenException({
      code: 'SUBSCRIPTION_NOT_SENDABLE',
      message: '订阅状态不允许扫码或发送邮件',
    });
  }

  private toLicenseCheckResponse(subscription: {
    plan: string;
    status: string;
    endAt: Date;
  }): LicenseCheckResponse {
    const endAt = subscription.endAt.toISOString();
    const status =
      this.canSendForStatus(subscription.status) && subscription.endAt.getTime() <= Date.now()
        ? 'expired'
        : subscription.status;

    return {
      status,
      plan: subscription.plan,
      end_at: endAt,
      expired_at: endAt,
      grace_period: null,
      can_send: this.canSendForStatus(status),
    };
  }
}
