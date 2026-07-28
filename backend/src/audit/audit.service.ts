import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthenticatedUserResponse } from '../auth/auth.types';
import { ExportAuditLogsDto, ListAuditLogsDto } from './dto';

export type AuditEvent = {
  tenantId?: string | null;
  actorUserId?: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  result: 'success' | 'failure' | 'denied';
  metadata?: Record<string, unknown>;
};

const SENSITIVE_KEY = /(password|token|authorization|secret|body|email|payload)/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(event: AuditEvent): Promise<boolean> {
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId: event.tenantId ?? null,
          actorUserId: event.actorUserId ?? null,
          action: event.action,
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          result: event.result,
          metadataJson: this.sanitize(event.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  async listLogs(user: AuthenticatedUserResponse, query: ListAuditLogsDto) {
    const cursor = this.decodeCursor(query.cursor);
    const rows = await this.prisma.auditLog.findMany({
      where: {
        tenantId: user.tenant_id,
        ...(query.action ? { action: { contains: query.action, mode: 'insensitive' as const } } : {}),
        ...(query.result ? { result: query.result } : {}),
        ...(query.resource_type ? { resourceType: query.resource_type } : {}),
        ...(query.actor_user_id ? { actorUserId: query.actor_user_id } : {}),
        ...(query.created_from || query.created_to
          ? { createdAt: {
              ...(query.created_from ? { gte: new Date(query.created_from) } : {}),
              ...(query.created_to ? { lte: new Date(query.created_to) } : {}),
            } }
          : {}),
        ...(cursor ? { OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      select: {
        id: true,
        actorUserId: true,
        action: true,
        resourceType: true,
        resourceId: true,
        result: true,
        metadataJson: true,
        createdAt: true,
      },
    });
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    await this.record({
      tenantId: user.tenant_id,
      actorUserId: user.user_id,
      action: 'audit.query',
      resourceType: 'audit_log',
      resourceId: user.tenant_id,
      result: 'success',
      metadata: { action: query.action, result: query.result, resource_type: query.resource_type, count: page.length },
    });
    return {
      items: page.map((row) => ({
        audit_log_id: row.id,
        actor_user_id: row.actorUserId,
        action: row.action,
        resource_type: row.resourceType,
        resource_id: row.resourceId,
        result: row.result,
        metadata: this.sanitize(row.metadataJson),
        created_at: row.createdAt.toISOString(),
      })),
      next_cursor: hasMore && last ? this.encodeCursor(last.createdAt, last.id) : null,
    };
  }

  async exportLogs(user: AuthenticatedUserResponse, query: ExportAuditLogsDto) {
    const range = this.assertExportRange(query.created_from, query.created_to);
    const rows = await this.prisma.auditLog.findMany({
      where: {
        tenantId: user.tenant_id,
        createdAt: { gte: range.from, lte: range.to },
        ...(query.action ? { action: { contains: query.action, mode: 'insensitive' as const } } : {}),
        ...(query.result ? { result: query.result } : {}),
        ...(query.resource_type ? { resourceType: query.resource_type } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 5000,
      select: {
        createdAt: true,
        action: true,
        resourceType: true,
        resourceId: true,
        result: true,
        metadataJson: true,
      },
    });
    await this.record({
      tenantId: user.tenant_id,
      actorUserId: user.user_id,
      action: 'audit.export',
      resourceType: 'audit_log',
      resourceId: user.tenant_id,
      result: 'success',
      metadata: { created_from: query.created_from, created_to: query.created_to, count: rows.length },
    });
    return '\uFEFF' + [
      ['time', 'action', 'resource_type', 'resource_id', 'result', 'metadata'],
      ...rows.map((row) => [
        row.createdAt.toISOString(), row.action, row.resourceType, row.resourceId, row.result,
        JSON.stringify(this.sanitize(row.metadataJson)),
      ]),
    ].map((row) => row.map((value) => this.csvCell(String(value))).join(',')).join('\r\n');
  }

  sanitize(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitize(item));
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, item]) => [
          key,
          SENSITIVE_KEY.test(key) ? '[redacted]' : this.sanitize(item),
        ]),
      );
    }
    if (typeof value === 'string') {
      return value.replace(BEARER, '[redacted-token]').replace(EMAIL, '[redacted-email]');
    }
    return value;
  }

  private assertExportRange(createdFrom: string, createdTo: string) {
    const from = new Date(createdFrom);
    const to = new Date(createdTo);
    if (from > to || to.getTime() - from.getTime() > 31 * 24 * 60 * 60 * 1000) {
      throw new BadRequestException({ code: 'INVALID_EXPORT_RANGE', message: '导出时间范围必须为 31 天以内' });
    }
    return { from, to };
  }

  private csvCell(value: string) {
    const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  }

  private encodeCursor(createdAt: Date, id: string) {
    return Buffer.from(JSON.stringify({ created_at: createdAt.toISOString(), id })).toString('base64url');
  }

  private decodeCursor(cursor?: string): { createdAt: Date; id: string } | null {
    if (!cursor) return null;
    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { created_at?: unknown; id?: unknown };
      const createdAt = new Date(String(parsed.created_at ?? ''));
      if (Number.isNaN(createdAt.getTime()) || typeof parsed.id !== 'string' || !parsed.id) throw new Error();
      return { createdAt, id: parsed.id };
    } catch {
      throw new BadRequestException({ code: 'INVALID_CURSOR', message: 'cursor 无效' });
    }
  }
}
