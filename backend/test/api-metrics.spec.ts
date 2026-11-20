import { INestApplication, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { IncomingMessage, ServerResponse } from 'node:http';
import request from 'supertest';
import { ApiMetricWindows } from '../src/api-metrics';
import { AppModule } from '../src/app.module';
import { configureHttp } from '../src/main';
import { PrismaService } from '../src/prisma.service';

const start = Date.UTC(2026, 0, 1);
const minute = 60_000;

describe('API metric windows', () => {
  it.each<[number, number, boolean | null]>([
    [0, 0, null],
    [9, 1, null],
    [10, 0, false],
    [10, 1, true],
    [20, 1, true],
    [21, 1, false],
  ])('evaluates %i requests / %i 5xx over five full minutes', (requests, errors, expected) => {
    const emit = jest.fn();
    const windows = new ApiMetricWindows(start, emit);
    for (let i = 0; i < requests; i++) windows.record(i, 0, i < errors ? 500 : 200);
    for (let i = 1; i <= 5; i++) windows.advance(i * minute);
    const rows = emit.mock.calls.map(([row]) => row);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ requests, serverErrors: errors });
    expect(rows.slice(0, 4).every(row => row.fiveMinute5xxBreach === null)).toBe(true);
    expect(rows[4].fiveMinute5xxBreach).toBe(expected);
    windows.advance(6 * minute);
    expect(emit).toHaveBeenLastCalledWith(expect.objectContaining({ fiveMinute5xxBreach: null }));
  });

  it('sums counts across unequal minute buckets and evicts the oldest bucket', () => {
    const emit = jest.fn();
    const windows = new ApiMetricWindows(start, emit);
    windows.record(0, 0, 500);
    for (const [index, successes] of [0, 4, 12, 3, 1].entries()) {
      const bucketStart = (index + 1) * minute;
      windows.advance(bucketStart);
      for (let i = 0; i < successes; i++) windows.record(bucketStart + i, 0, 200);
    }
    windows.advance(6 * minute);
    expect(emit.mock.calls[4][0].fiveMinute5xxBreach).toBe(true);  // 1/20
    expect(emit.mock.calls[5][0].fiveMinute5xxBreach).toBe(false); // 0/20
  });

  it('requires ten consecutive sampled minutes with nearest-rank p95 strictly above 2s', () => {
    const emit = jest.fn();
    const windows = new ApiMetricWindows(start, emit);
    // With 20 samples, the 19th sorted value is the p95.
    for (let m = 0; m < 13; m++) {
      const slow = m === 0 || m === 12 ? 1 : 2;
      for (let i = 0; i < 20; i++) windows.record(m * minute + 3_000, i < slow ? 2_001 : 2_000, 204);
      windows.advance((m + 1) * minute);
    }
    expect(emit.mock.calls.map(([row]) => row.slowP95Minutes))
      .toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 0]);
    expect(emit.mock.calls[0][0].over2s).toBe(1);
  });

  it('assigns a boundary completion to the new minute and resets on empty, gaps and restart', () => {
    const emit = jest.fn();
    const windows = new ApiMetricWindows(start, emit);
    windows.record(minute - 1, 2_001, 499);
    windows.record(minute, 2_001, 599);
    windows.advance(2 * minute);
    windows.advance(3 * minute);
    windows.record(3 * minute + 1, 2_001, 500);
    windows.advance(8 * minute); // delayed timer: publish minute 3, skip 4..7
    windows.record(8 * minute + 1, 2_001, 200);
    windows.advance(9 * minute);
    const restarted = new ApiMetricWindows(start + 9 * minute, emit);
    restarted.record(3_000, 2_001, 200);
    restarted.advance(minute);
    expect(emit.mock.calls.map(([row]) => [
      (Date.parse(row.windowStart) - start) / minute, row.requests, row.serverErrors, row.slowP95Minutes,
    ])).toEqual([
      [0, 1, 0, 1], [1, 1, 1, 2], [2, 0, 0, 0], [3, 1, 1, 1], [8, 1, 0, 1], [9, 1, 0, 1],
    ]);
    expect(emit.mock.calls.every(([row]) => row.fiveMinute5xxBreach === null)).toBe(true);
  });
});

describe('normal Backend HTTP entry', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it.each(['true', 'false', undefined])('counts final responses once with API_METRICS_ENABLED=%s', async setting => {
    const env = { ...process.env, APP_ENV: 'local', MAIL_PROVIDER: 'mock', REAL_MAIL_SEND_ENABLED: 'false' };
    jest.replaceProperty(process, 'env', env);
    if (setting === undefined) delete process.env.API_METRICS_ENABLED;
    else process.env.API_METRICS_ENABLED = setting;
    jest.useFakeTimers({
      now: start,
      doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime'],
    });
    const findTenant = jest.fn(() => {
      jest.advanceTimersByTime(2_001);
      throw new ServiceUnavailableException();
    });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue({ tenant: { findUnique: findTenant } }).compile();
    app = module.createNestApplication();
    const output = jest.fn();
    app.useLogger({ log: output, error: output, warn: output, debug: output, verbose: output, fatal: output });
    configureHttp(app);
    app.use('/api/test-abort', (_req: IncomingMessage, res: ServerResponse) => res.destroy());
    await app.listen(0, '127.0.0.1');
    output.mockClear();

    const http = request(app.getHttpServer());
    const email = 'metrics-fixture@example.invalid';
    const name = 'SyntheticMetricsName';
    const password = 'SyntheticMetricsPassword';
    const token = 'synthetic-metrics-token';
    const code = 'E0000000001';
    const path = '/api/test-private-path';
    const cookie = 'metrics-cookie-marker';
    const tenantCode = '10CA000001';
    const responses = [
      await http.post('/api/auth/logout').expect(201).expect({ status: 'ok' }),
      await http.get('/api/license/check').set('Authorization', 'Bearer ' + token).expect(401),
      await http.post('/api/auth/login').send({ tenant_code: tenantCode, identifier: email, password }).expect(503),
      await http.get(path).query({ name, code }).set('Cookie', 'test=' + cookie).expect(404),
      await http.post('/api/auth/login').type('json').send('{').expect(400),
      await http.options('/api/auth/login').set('Origin', 'http://localhost:3000').expect(204),
    ];
    expect(responses[0].headers['set-cookie']).toHaveLength(2);
    expect(findTenant).toHaveBeenCalledTimes(1);
    await http.get('/health').expect(200);
    await expect(http.get('/api/test-abort')).rejects.toThrow(/socket hang up|ECONNRESET/i);
    const metrics = () => output.mock.calls.filter(([, context]) => context === 'ApiMetrics')
      .map(([message]) => JSON.parse(message));
    expect(metrics()).toEqual([]);
    jest.advanceTimersByTime(minute - 2_001);
    expect(metrics()).toEqual(setting === 'true' ? [{
      event: 'api.minute', windowStart: new Date(start).toISOString(),
      requests: responses.length, serverErrors: responses.filter(r => r.status >= 500).length,
      over2s: 1, fiveMinute5xxBreach: null, slowP95Minutes: 1,
    }] : []);
    const logText = JSON.stringify(output.mock.calls);
    for (const marker of [email, name, password, token, 'Bearer', code, path, cookie, tenantCode]) {
      expect(logText).not.toContain(marker);
    }
  });
});
