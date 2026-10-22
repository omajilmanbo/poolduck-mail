import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { PlatformAuditService } from './platform-audit.service';
import { ListPlatformAuditsDto } from './platform-audit-query.dto';
import { AuthenticatedPlatformAdmin } from './platform.types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_CODE = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;
const SAFE_RESOURCE = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;

type Cursor = { created_at: string; id: string; filter: string };

@Injectable()
export class PlatformAuditQueryService {
  constructor(private readonly prisma: PrismaService, private readonly audit: PlatformAuditService) {}

  async list(admin: AuthenticatedPlatformAdmin, query: ListPlatformAuditsDto) {
    const from = query.created_from ? new Date(query.created_from) : null;
    const to = query.created_to ? new Date(query.created_to) : null;
    if (from && to && from > to) throw new BadRequestException({ code: 'INVALID_AUDIT_RANGE', message: '时间范围无效' });
    const filter = createHash('sha256').update(JSON.stringify({
      from: from?.toISOString() ?? null, to: to?.toISOString() ?? null,
      admin: query.platform_admin_id ?? null, action: query.action ?? null,
      result: query.result ?? null, tenant: query.target_tenant_id ?? null,
    })).digest('hex');
    const cursor = this.decode(query.cursor, filter);
    const rows = await this.prisma.platformAuditLog.findMany({
      where: {
        ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        ...(query.platform_admin_id ? { platformAdminId: query.platform_admin_id } : {}),
        ...(query.action ? { action: query.action } : {}),
        ...(query.result ? { result: query.result } : {}),
        ...(query.target_tenant_id ? { targetTenantId: query.target_tenant_id } : {}),
        ...(cursor ? { OR: [
          { createdAt: { lt: new Date(cursor.created_at) } },
          { createdAt: new Date(cursor.created_at), id: { lt: cursor.id } },
        ] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      select: {
        id: true, platformAdminId: true, targetTenantId: true, action: true,
        resourceType: true, resourceId: true, result: true, metadataJson: true, createdAt: true,
        targetTenant: { select: { tenantCode: true, name: true, status: true } },
      },
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const recorded = await this.audit.record({
      platformAdminId: admin.platform_admin_id, action: 'platform.audit.query',
      resourceType: 'platform_audit_log', resourceId: 'list', result: 'success',
      metadata: { count: page.length },
    });
    if (!recorded) throw new ServiceUnavailableException({ code: 'PLATFORM_AUDIT_UNAVAILABLE', message: '平台审计暂不可用' });
    return {
      items: page.map((row) => ({
        audit_id: row.id,
        platform_admin_id: row.platformAdminId,
        target_tenant_id: row.targetTenantId,
        target_tenant: row.targetTenant ? {
          tenant_code: row.targetTenant.tenantCode,
          name: this.audit.sanitize(row.targetTenant.name) as string,
          status: row.targetTenant.status,
        } : null,
        action: this.safeCode(row.action),
        resource_type: this.safeCode(row.resourceType),
        resource_id: UUID.test(row.resourceId) || SAFE_RESOURCE.test(row.resourceId) ? row.resourceId : '[redacted]',
        result: ['success', 'failure', 'denied'].includes(row.result) ? row.result : 'unknown',
        metadata: this.safeMetadata(row.metadataJson),
        created_at: row.createdAt.toISOString(),
      })),
      next_cursor: rows.length > query.limit && last
        ? Buffer.from(JSON.stringify({ created_at: last.createdAt.toISOString(), id: last.id, filter })).toString('base64url')
        : null,
    };
  }

  private safeCode(value: string) { return SAFE_CODE.test(value) ? value : '[redacted]'; }

  private safeMetadata(value: Prisma.JsonValue): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const source = value as Record<string, Prisma.JsonValue>;
    const safe: Record<string, unknown> = {};
    if (typeof source.reason === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(source.reason)) safe.reason = source.reason;
    if (source.environment === 'production' || source.environment === 'staging') safe.environment = source.environment;
    if (source.counts && typeof source.counts === 'object' && !Array.isArray(source.counts)) {
      const counts = Object.entries(source.counts).filter(([key, count]) =>
        /^[a-z][a-z0-9_]{0,63}$/.test(key) && typeof count === 'number' && Number.isSafeInteger(count) && count >= 0);
      safe.counts = Object.fromEntries(counts);
    }
    return safe;
  }

  private decode(raw: string | undefined, filter: string): Cursor | null {
    if (!raw) return null;
    try {
      if (raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
      const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor;
      if (!parsed || parsed.filter !== filter || !UUID.test(parsed.id)
        || typeof parsed.created_at !== 'string'
        || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(parsed.created_at)
        || Number.isNaN(Date.parse(parsed.created_at))) throw new Error();
      return parsed;
    } catch {
      throw new BadRequestException({ code: 'INVALID_CURSOR', message: 'cursor 无效' });
    }
  }
}
