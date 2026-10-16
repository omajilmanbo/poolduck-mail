import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

type WindowSnapshot = {
  dbNow: Date;
  latest: Date | null;
  recentCount: number;
  oldest: Date | null;
};

export type OciRateDecision = { admitted: true } | { admitted: false; scheduledAt: Date };

// Interim ADR-019 application pacing: at most one OCI submission reservation per 50 ms
// across all backend instances. This is not an OCI tenancy quota or a daily cap.
const OCI_RATE_LOCK = 19019139;
const OCI_APP_PACE_MS = 50;
const OCI_APP_MAX_PER_SECOND = 20;

@Injectable()
export class OciMailRateLimiter {
  constructor(private readonly prisma: PrismaService) {}

  async reserve(tenantId: string, mailJobId: string, attemptId: string, rfcMessageId: string): Promise<OciRateDecision> {
    return this.prisma.$transaction(async (tx) => {
      // The lock function returns void, which Prisma's pg adapter cannot decode.
      await tx.$queryRawUnsafe('SELECT 1::int AS acquired FROM pg_advisory_xact_lock($1::bigint)', OCI_RATE_LOCK);
      const [window] = await tx.$queryRawUnsafe<WindowSnapshot[]>(`
        SELECT CURRENT_TIMESTAMP AS "dbNow", MAX("provider_invoked_at") AS "latest",
          COUNT(*)::int AS "recentCount", MIN("provider_invoked_at") AS "oldest"
        FROM "mail_delivery_attempts"
        WHERE "rfc_message_id" IS NOT NULL
          AND "provider_invoked_at" > CURRENT_TIMESTAMP - INTERVAL '1 second'
      `);
      if (!window) throw new Error('OCI_EMAIL_RATE_WINDOW_UNAVAILABLE');
      const nextAtMs = Math.max(
        window.dbNow.getTime(),
        window.latest ? window.latest.getTime() + OCI_APP_PACE_MS : 0,
        window.recentCount >= OCI_APP_MAX_PER_SECOND && window.oldest
          ? window.oldest.getTime() + 1_001 : 0,
      );
      if (nextAtMs > window.dbNow.getTime()) {
        const scheduledAt = new Date(nextAtMs);
        await tx.mailJob.update({
          where: { id: mailJobId, tenantId },
          data: {
            status: 'queued', scheduledAt, claimedAt: null, claimAttemptId: null,
            errorMessage: 'PROVIDER_RATE_LIMITED',
          },
        });
        await tx.mailDeliveryAttempt.update({
          where: { id: attemptId, tenantId },
          data: { status: 'deferred', completedAt: window.dbNow, errorCode: 'PROVIDER_RATE_LIMITED' },
        });
        return { admitted: false, scheduledAt };
      }
      await tx.mailDeliveryAttempt.update({
        where: { id: attemptId, tenantId },
        data: { status: 'invoked', providerInvokedAt: window.dbNow, rfcMessageId },
      });
      return { admitted: true };
    });
  }
}
