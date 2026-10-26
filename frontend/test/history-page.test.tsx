import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomePage, {
  cancellationSecondsRemaining,
  historyItemToRecord,
  shouldPollHistory,
} from '../app/page';
import type { ScanHistoryItem } from '../src/api/client';

const locationId = '44444444-4444-4444-8444-444444444444';

describe('history workspace', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('loads persisted history after restoring a session', async () => {
    vi.stubGlobal('fetch', createWorkspaceFetch({ items: [historyItem('sent')], next_cursor: null }));
    render(<HomePage />);

    expect(await screen.findByText('01K0ABC80001')).not.toBeNull();
    const historyTable = screen.getByRole('table', { name: '扫码记录' });
    expect(within(historyTable).getByRole('columnheader', { name: '人员名称' })).not.toBeNull();
    expect(within(historyTable).queryByRole('columnheader', { name: 'location' })).toBeNull();
    expect(within(historyTable).getByRole('cell', { name: 'History Person' })).not.toBeNull();
    expect(screen.getByTestId('scan-action').textContent).toContain('进入');
    expect(screen.queryByText(/2026-12-31/)).toBeNull();
    expect(screen.getByTestId('mail-status').textContent).toContain('已发送');
  });

  it('shows an empty history state', async () => {
    vi.stubGlobal('fetch', createWorkspaceFetch({ items: [], next_cursor: null }));
    render(<HomePage />);
    expect(await screen.findByText('暂无扫码记录')).not.toBeNull();
  });

  it.each([
    ['exit', 'person_action_code', '离开'],
    ['unknown', 'legacy_unknown', '动作未知'],
  ] as const)('renders persisted %s history as %s', async (action, source, label) => {
    const item = historyItem('sent');
    item.action = action;
    item.action_source = source;
    if (item.mail_job) {
      item.mail_job.action = action;
    }
    vi.stubGlobal('fetch', createWorkspaceFetch({ items: [item], next_cursor: null }));
    render(<HomePage />);

    expect((await screen.findByTestId('scan-action')).textContent).toContain(label);
  });

  it('shows a safe network error when history loading fails', async () => {
    vi.stubGlobal('fetch', createWorkspaceFetch(new TypeError('Failed to fetch')));
    render(<HomePage />);
    expect(await screen.findByText(/无法连接后端 API/)).not.toBeNull();
  });

  it('clears an expired session when history returns 401', async () => {
    vi.stubGlobal('fetch', createWorkspaceFetch({ status: 401 }));
    render(<HomePage />);

    await waitFor(() => expect(screen.getByTestId('login-submit')).not.toBeNull());
    expect(window.localStorage.getItem('poolduck.accessToken')).toBeNull();
  });

  it('polls only pending records and stops at final status or the attempt cap', () => {
    const queued = historyItemToRecord(historyItem('queued'));
    const processing = historyItemToRecord(historyItem('processing'));
    const sent = historyItemToRecord(historyItem('sent'));

    expect(shouldPollHistory([queued], 0)).toBe(true);
    expect(shouldPollHistory([processing], 9)).toBe(true);
    expect(shouldPollHistory([sent], 0)).toBe(false);
    expect(shouldPollHistory([queued], 10)).toBe(false);
  });

  it('uses a fallback when historical person name is unavailable', () => {
    const item = historyItem('sent');
    item.person_name = null;

    expect(historyItemToRecord(item).personName).toBe('-');
  });

  it('uses server offset for countdown and never extends a slept or skewed client deadline', () => {
    const clientNow = new Date('2026-07-20T02:02:04.000Z').getTime();
    const serverNow = new Date('2026-07-20T01:02:04.000Z').getTime();
    const offset = serverNow - clientNow;

    expect(
      cancellationSecondsRemaining(
        '2026-07-20T01:02:13.000Z',
        offset,
        clientNow,
      ),
    ).toBe(9);
    expect(
      cancellationSecondsRemaining(
        '2026-07-20T01:02:13.000Z',
        offset,
        clientNow + 10_000,
      ),
    ).toBe(0);
  });

  it('shows cancellation result unknown and refreshes instead of claiming success', async () => {
    vi.stubGlobal(
      'fetch',
      createWorkspaceFetch(
        { items: [historyItem('waiting')], next_cursor: null },
        new TypeError('Failed to fetch'),
      ),
    );
    render(<HomePage />);

    const cancel = await screen.findByTestId('scan-cancel');
    fireEvent.click(cancel);

    expect(
      await screen.findByText('取消结果未知，正在刷新权威状态。'),
    ).not.toBeNull();
    expect(screen.getByTestId('mail-status').textContent).toContain('可取消等待中');
    expect(screen.getByTestId('mail-status').textContent).not.toContain('已取消');
  });

  it('shows at most 25 records and moves through server cursor pages', async () => {
    const first = Array.from({ length: 25 }, (_, index) => namedHistoryItem(index + 1));
    const fetchMock = createWorkspaceFetch((url) => url.searchParams.get('cursor') === 'older'
      ? { items: [namedHistoryItem(26)], next_cursor: null }
      : { items: [...first, namedHistoryItem(99)], next_cursor: 'older' });
    vi.stubGlobal('fetch', fetchMock);
    render(<HomePage />);

    const table = await screen.findByRole('table', { name: '扫码记录' });
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(26));
    expect(screen.queryByText('Person 99')).toBeNull();
    const firstUrl = new URL(String(fetchMock.mock.calls.find(([input]) => String(input).includes('/api/scan-events?'))?.[0]));
    expect(firstUrl.searchParams.get('limit')).toBe('25');
    expect(firstUrl.searchParams.get('location_id')).toBe(locationId);

    fireEvent.click(screen.getByTestId('history-next'));
    expect(await screen.findByText('Person 26')).not.toBeNull();
    expect(screen.queryByText('Person 1')).toBeNull();
    expect((screen.getByTestId('history-next') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('history-previous'));
    expect(await screen.findByText('Person 1')).not.toBeNull();
  });

  it('sends status and local-day filters to the server and resets cursor on filter or location changes', async () => {
    const secondLocation = '44444445-4445-4445-8445-444444444445';
    const requests: URL[] = [];
    const fetchMock = createWorkspaceFetch((url) => {
      requests.push(url);
      return {
        items: [namedHistoryItem(requests.length)],
        next_cursor: url.searchParams.has('cursor') ? null : 'older',
      };
    }, undefined, [locationId, secondLocation]);
    vi.stubGlobal('fetch', fetchMock);
    render(<HomePage />);

    await screen.findByText('Person 1');
    fireEvent.click(screen.getByTestId('history-next'));
    await screen.findByText('Person 2');
    fireEvent.change(screen.getByTestId('history-status-filter'), { target: { value: 'waiting' } });
    await screen.findByText('Person 3');
    expect(requests.at(-1)?.searchParams.get('status')).toBe('waiting');
    expect(requests.at(-1)?.searchParams.has('cursor')).toBe(false);
    expect(screen.getByText(/第 1 页/)).not.toBeNull();

    fireEvent.change(screen.getByTestId('history-from-filter'), { target: { value: '2026-07-01' } });
    await screen.findByText('Person 4');
    fireEvent.change(screen.getByTestId('history-to-filter'), { target: { value: '2026-07-02' } });
    await screen.findByText('Person 5');
    expect(requests.at(-1)?.searchParams.get('created_from')).toBe(new Date('2026-07-01T00:00:00').toISOString());
    expect(requests.at(-1)?.searchParams.get('created_to')).toBe(new Date('2026-07-02T23:59:59.999').toISOString());

    fireEvent.change(screen.getByTestId('location-select'), { target: { value: secondLocation } });
    await screen.findByText('Person 6');
    expect(requests.at(-1)?.searchParams.get('location_id')).toBe(secondLocation);
    expect(requests.at(-1)?.searchParams.has('cursor')).toBe(false);
    fireEvent.click(screen.getByTestId('history-clear-filters'));
    await screen.findByText('Person 7');
    expect(requests.at(-1)?.searchParams.has('status')).toBe(false);
    expect(requests.at(-1)?.searchParams.has('created_from')).toBe(false);
    expect(requests.at(-1)?.searchParams.has('created_to')).toBe(false);
  });

  it('does not query an inverted date range and shows a permission error for forbidden history', async () => {
    const fetchMock = createWorkspaceFetch((url) => url.searchParams.has('created_from')
      ? { status: 403 }
      : { items: [], next_cursor: null });
    vi.stubGlobal('fetch', fetchMock);
    render(<HomePage />);
    await screen.findByText('暂无扫码记录');
    fireEvent.change(screen.getByTestId('history-from-filter'), { target: { value: '2026-07-03' } });
    fireEvent.change(screen.getByTestId('history-to-filter'), { target: { value: '2026-07-01' } });
    expect((await screen.findByRole('alert')).textContent).toContain('起始日期不能晚于结束日期');
    const before = fetchMock.mock.calls.filter(([input]) => String(input).includes('/api/scan-events?')).length;
    fireEvent.change(screen.getByTestId('history-to-filter'), { target: { value: '2026-07-04' } });
    expect(await screen.findByText('无权限查看此地点的扫码记录')).not.toBeNull();
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/api/scan-events?'))).toHaveLength(before + 1);
  });

  it('refreshes and polls only the selected cursor page without appending duplicate records', async () => {
    let olderLoads = 0;
    const waiting = { ...namedHistoryItem(2), ...historyItem('waiting'),
      scan_event_id: 'scan-2', person_name: 'Person 2',
      cancel_until: new Date(Date.now() + 10_000).toISOString() };
    const fetchMock = createWorkspaceFetch((url) => {
      if (!url.searchParams.has('cursor')) return { items: [namedHistoryItem(1)], next_cursor: 'older' };
      olderLoads += 1;
      return { items: [olderLoads < 3 ? waiting : namedHistoryItem(2)], next_cursor: null };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<HomePage />);
    await screen.findByText('Person 1');
    fireEvent.click(screen.getByTestId('history-next'));
    await screen.findByText('Person 2');
    fireEvent.click(screen.getByTestId('history-refresh'));
    await waitFor(() => expect(olderLoads).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(screen.getByTestId('mail-status').textContent).toContain('已发送'), { timeout: 5_000 });
    const table = screen.getByRole('table', { name: '扫码记录' });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(screen.queryByText('Person 1')).toBeNull();
    const olderRequests = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes('/api/scan-events?') && new URL(String(input)).searchParams.get('cursor') === 'older');
    expect(olderRequests).toHaveLength(olderLoads);
  });

  it('keeps cancellation available on a filtered page and reloads that filter after canceling', async () => {
    let canceled = false;
    const waiting = { ...historyItem('waiting'), cancel_until: new Date(Date.now() + 10_000).toISOString() };
    const workspaceFetch = createWorkspaceFetch((url) => ({
      items: url.searchParams.get('status') === 'waiting' && canceled ? [] : [waiting],
      next_cursor: null,
    }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/cancel')) canceled = true;
      return workspaceFetch(input);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<HomePage />);
    await screen.findByTestId('scan-cancel');
    fireEvent.change(screen.getByTestId('history-status-filter'), { target: { value: 'waiting' } });
    const cancel = await screen.findByTestId('scan-cancel');
    expect((cancel as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(cancel);
    await screen.findByText('暂无扫码记录');
    const lastHistoryUrl = new URL(String(fetchMock.mock.calls.filter(([input]) => String(input).includes('/api/scan-events?')).at(-1)?.[0]));
    expect(lastHistoryUrl.searchParams.get('status')).toBe('waiting');
    expect(screen.queryByTestId('scan-cancel')).toBeNull();
  });

  it('returns to the first unfiltered page after a new scan so the waiting cancellation stays visible', async () => {
    let created = false;
    const waiting = { ...historyItem('waiting'), scan_event_id: 'new-scan', person_name: 'New Person',
      cancel_until: new Date(Date.now() + 10_000).toISOString() };
    const baseFetch = createWorkspaceFetch((url) => url.searchParams.has('cursor')
      ? { items: [namedHistoryItem(26)], next_cursor: null }
      : { items: created ? [waiting, ...Array.from({ length: 24 }, (_, index) => namedHistoryItem(index + 1))]
        : Array.from({ length: 25 }, (_, index) => namedHistoryItem(index + 1)), next_cursor: 'older' });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/api/scan-events') && init?.method === 'POST') {
        created = true;
        return jsonResponse({ scan_event_id: 'new-scan' });
      }
      return baseFetch(input);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<HomePage />);
    await screen.findByText('Person 1');
    fireEvent.change(screen.getByTestId('history-status-filter'), { target: { value: 'sent' } });
    await screen.findByText('Person 1');
    fireEvent.click(screen.getByTestId('history-next'));
    await screen.findByText('Person 26');
    fireEvent.change(screen.getByTestId('scan-code-input'), { target: { value: 'E01K0ABC80001' } });
    fireEvent.click(screen.getByTestId('scan-submit'));
    expect(await screen.findByText('New Person')).not.toBeNull();
    expect((screen.getByTestId('history-status-filter') as HTMLSelectElement).value).toBe('');
    expect(screen.getByText(/第 1 页/)).not.toBeNull();
    expect((screen.getByTestId('scan-cancel') as HTMLButtonElement).disabled).toBe(false);
    expect(within(screen.getByRole('table', { name: '扫码记录' })).getAllByRole('row')).toHaveLength(26);
  });
});

function createWorkspaceFetch(
  history:
    | { items: ScanHistoryItem[]; next_cursor: string | null }
    | { status: number }
    | TypeError
    | ((url: URL) => { items: ScanHistoryItem[]; next_cursor: string | null } | { status: number } | TypeError),
  cancelError?: TypeError,
  locationIds = [locationId],
) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/auth/me')) {
      return jsonResponse({ user: { user_id: 'user-1', tenant_code: '10CA000001', email: 'operator@example.local', role: 'operator' } });
    }
    if (url.endsWith('/api/auth/refresh')) {
      if (typeof history !== 'function' && !(history instanceof TypeError) && 'status' in history) {
        return jsonResponse({ code: 'UNAUTHORIZED' }, 401);
      }
      return jsonResponse({ expires_in: 900, user: {} });
    }
    if (url.endsWith('/api/license/check')) {
      return jsonResponse({
        status: 'active',
        plan: 'mvp',
        end_at: '2026-12-31T00:00:00.000Z',
        expired_at: '2026-12-31T00:00:00.000Z',
        grace_period: null,
        can_send: true,
      });
    }
    if (url.endsWith('/api/locations')) {
      return jsonResponse(locationIds.map((id, index) => ({
          location_id: id,
          location_code: 'OFFICE-A',
          location_name: `Office ${index + 1}`,
          type: 'office',
          is_active: true,
        })));
    }
    if (url.includes('/people')) {
      return jsonResponse([]);
    }
    if (url.includes('/api/scan-events?')) {
      const result = typeof history === 'function' ? history(new URL(url)) : history;
      if (result instanceof TypeError) {
        throw result;
      }
      if ('status' in result) {
        return jsonResponse({ code: 'UNAUTHORIZED', message: '登录已失效' }, result.status);
      }
      return jsonResponse(result);
    }
    if (url.includes('/api/scan-events/') && url.endsWith('/cancel')) {
      if (cancelError) throw cancelError;
      return jsonResponse({
        scan_event_id: '55555555-5555-4555-8555-555555555555',
        mail_job_id: '66666666-6666-4666-8666-666666666666',
        effective_status: 'canceled',
        mail_status: 'canceled',
        canceled_at: '2026-07-20T01:02:05.000Z',
        server_time: '2026-07-20T01:02:05.000Z',
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
}

function namedHistoryItem(index: number): ScanHistoryItem {
  const item = historyItem('sent');
  return { ...item, scan_event_id: `scan-${index}`, person_name: `Person ${index}` };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function historyItem(status: ScanHistoryItem['status']): ScanHistoryItem {
  return {
    scan_event_id: '55555555-5555-4555-8555-555555555555',
    location_id: locationId,
    location_name: 'Office A',
    person_code: '01K0ABC80001',
    person_name: 'History Person',
    scan_code: '01K0ABC80001',
    scan_type: 'entry',
    action: 'entry',
    action_source: 'person_action_code',
    received_at: '2026-07-20T01:02:03.000Z',
    status,
    effective_status: status === 'canceled' ? 'canceled' : 'active',
    mail_status: status,
    can_cancel: status === 'waiting',
    cancel_until: status === 'waiting' ? '2026-07-20T01:02:13.000Z' : null,
    server_time: '2026-07-20T01:02:04.000Z',
    canceled_at: status === 'canceled' ? '2026-07-20T01:02:05.000Z' : null,
    mail_job: {
      mail_job_id: '66666666-6666-4666-8666-666666666666',
      status,
      action: 'entry',
      sent_at: status === 'sent' ? '2026-07-20T01:03:03.000Z' : null,
      error_message: status === 'failed' ? '邮件发送失败' : null,
    },
  };
}
