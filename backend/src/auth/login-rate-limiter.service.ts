import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';

type Counter = {
  count: number;
  resetAt: number;
};

@Injectable()
export class LoginRateLimiterService {
  private static readonly MAX_COUNTERS = 20_000;
  private readonly counters = new Map<string, Counter>();

  allow(sourceIp: string, tenantId: string, identifier: string): boolean {
    const now = Date.now();
    this.prune(now);
    const windowMs = this.numberSetting(
      'AUTH_LOGIN_RATE_WINDOW_MS',
      15 * 60 * 1000,
    );
    const dimensions: Array<[string, string, number]> = [
      [
        'ip',
        sourceIp || 'unknown',
        this.numberSetting('AUTH_LOGIN_MAX_PER_IP', 60),
      ],
      [
        'tenant',
        tenantId,
        this.numberSetting('AUTH_LOGIN_MAX_PER_TENANT', 100),
      ],
      [
        'identifier',
        identifier.trim().toLowerCase(),
        this.numberSetting('AUTH_LOGIN_MAX_PER_IDENTIFIER', 10),
      ],
      [
        'composite',
        `${sourceIp}|${tenantId}|${identifier.trim().toLowerCase()}`,
        this.numberSetting('AUTH_LOGIN_MAX_PER_COMPOSITE', 8),
      ],
    ];

    return dimensions
      .map(([dimension, value, limit]) =>
        this.increment(`${dimension}:${this.fingerprint(value)}`, limit, now, windowMs),
      )
      .every(Boolean);
  }

  fingerprint(value: string): string {
    return createHmac('sha256', this.hashSecret()).update(value).digest('hex');
  }

  private increment(
    key: string,
    limit: number,
    now: number,
    windowMs: number,
  ): boolean {
    const current = this.counters.get(key);
    if (!current || current.resetAt <= now) {
      if (
        !current &&
        this.counters.size >= LoginRateLimiterService.MAX_COUNTERS
      ) {
        return false;
      }
      this.counters.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    current.count += 1;
    return current.count <= limit;
  }

  private prune(now: number): void {
    if (this.counters.size < LoginRateLimiterService.MAX_COUNTERS) {
      return;
    }
    for (const [key, counter] of this.counters) {
      if (counter.resetAt <= now) {
        this.counters.delete(key);
      }
    }
  }

  private numberSetting(name: string, fallback: number): number {
    const parsed = Number(process.env[name] ?? fallback);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private hashSecret(): string {
    return (
      process.env.AUTH_IDENTITY_HASH_SECRET ??
      process.env.REFRESH_TOKEN_SECRET ??
      process.env.JWT_SECRET ??
      'local-development-identity-hash-secret'
    );
  }
}
