import { INestApplication, Logger } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';

const MINUTE_MS = 60_000;

function emptyMinute() {
  return { requests: 0, serverErrors: 0, over2s: 0 };
}

type Counts = ReturnType<typeof emptyMinute>;
type ApiMinute = Counts & {
  event: 'api.minute';
  windowStart: string;
  fiveMinute5xxBreach: boolean | null;
  slowP95Minutes: number;
};

export class ApiMetricWindows {
  private minute = 0;
  private counts = emptyMinute();
  private readonly lastFive: Counts[] = [];
  private slowP95Minutes = 0;

  constructor(private readonly startedAt: number, private readonly emit: (row: ApiMinute) => void) {}

  record(finishedAtMs: number, durationMs: number, status: number) {
    this.advance(finishedAtMs);
    this.counts.requests++;
    if (status >= 500 && status < 600) this.counts.serverErrors++;
    if (durationMs > 2_000) this.counts.over2s++;
  }

  // Times are monotonic milliseconds since observation started. Rotate before
  // counting a completion, even when the interval callback is delayed.
  advance(elapsedMs: number) {
    const next = Math.floor(elapsedMs / MINUTE_MS);
    if (next <= this.minute) return;

    const counts = this.counts;
    this.lastFive.push(counts);
    if (this.lastFive.length > 5) this.lastFive.shift();
    const requests = this.lastFive.reduce((sum, bucket) => sum + bucket.requests, 0);
    const errors = this.lastFive.reduce((sum, bucket) => sum + bucket.serverErrors, 0);
    // Nearest-rank p95 > 2s iff strictly more than 5% of samples took > 2s.
    this.slowP95Minutes = counts.over2s * 20 > counts.requests
      ? Math.min(this.slowP95Minutes + 1, 10) : 0;
    this.emit({
      event: 'api.minute',
      windowStart: new Date(this.startedAt + this.minute * MINUTE_MS).toISOString(),
      ...counts,
      fiveMinute5xxBreach: this.lastFive.length === 5 && requests >= 10
        ? errors * 20 >= requests : null,
      slowP95Minutes: this.slowP95Minutes,
    });

    if (next > this.minute + 1) {
      // No timer or completion observed the intervening minutes.
      this.lastFive.length = 0;
      this.slowP95Minutes = 0;
    }
    this.minute = next;
    this.counts = emptyMinute();
  }
}

export function observeApiResponses(app: INestApplication) {
  const logger = new Logger('ApiMetrics');
  const origin = performance.now();
  const elapsed = () => performance.now() - origin;
  const windows = new ApiMetricWindows(Date.now(), (row) => {
    try {
      logger.log(JSON.stringify(row));
    } catch {
      // A failed log write leaves a gap. Never retry inside an HTTP callback.
    }
  });

  app.use('/api', (_req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const start = elapsed();
    res.once('finish', () => {
      const end = elapsed();
      windows.record(end, end - start, res.statusCode);
    });
    next();
  });
  const timer = setInterval(() => windows.advance(elapsed()), MINUTE_MS);
  timer.unref();
  app.getHttpServer().once('close', () => clearInterval(timer));
}
