import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

type PlatformAuditEvent = {
  platformAdminId?: string | null;
  targetTenantId?: string | null;
  requestId?: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  result: 'success' | 'failure' | 'denied';
  metadata?: Record<string, unknown>;
};

const SENSITIVE_KEY = /(password|token|authorization|secret|email|body|payload)/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;

@Injectable()
export class PlatformAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(event: PlatformAuditEvent): Promise<boolean> {
    try {
      await this.prisma.platformAuditLog.create({
        data: {
          platformAdminId: event.platformAdminId ?? null,
          targetTenantId: event.targetTenantId ?? null,
          requestId: event.requestId ?? null,
          action: event.action,
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          result: event.result,
          metadataJson: this.sanitize(
            event.metadata ?? {},
          ) as Prisma.InputJsonValue,
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  sanitize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.sanitize(item));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, item]) => [
          key,
          SENSITIVE_KEY.test(key) ? '[redacted]' : this.sanitize(item),
        ]),
      );
    }
    if (typeof value === 'string') {
      return value
        .replace(BEARER, '[redacted-token]')
        .replace(EMAIL, '[redacted-email]');
    }
    return value;
  }
}
