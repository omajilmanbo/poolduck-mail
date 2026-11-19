import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import AuditPage from '../app/audit/page';
import type { AuditLogItem } from '../src/api/client';

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function auditPage(resource: string, next_cursor: string | null) {
  const item: AuditLogItem = {
    audit_log_id: resource,
    actor_user_id: null,
    action: 'fixture.inspect',
    resource_type: 'fixture',
    resource_id: resource,
    result: 'success',
    metadata: {},
    created_at: '2026-11-17T01:00:00.000Z',
  };
  return json({ items: [item], next_cursor });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('ignores a late page response after a new query has succeeded', async () => {
  let finishOlderPage!: (response: Response) => void;
  const olderPage = new Promise<Response>((resolve) => { finishOlderPage = resolve; });
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(json({ user: { role: 'tenant_manager' } }))
    .mockResolvedValueOnce(auditPage('initial', 'old-cursor'))
    .mockReturnValueOnce(olderPage)
    .mockResolvedValueOnce(auditPage('latest', null));
  vi.stubGlobal('fetch', fetchMock);

  render(<AuditPage />);
  await screen.findByText('fixture/initial');
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  await screen.findByText('正在加载审计日志…');
  fireEvent.change(screen.getByPlaceholderText('action'), { target: { value: 'new-query' } });
  fireEvent.click(screen.getByRole('button', { name: '查询' }));
  await screen.findByText('fixture/latest');

  await act(async () => finishOlderPage(auditPage('late', 'stale-cursor')));

  expect(screen.queryByText('fixture/late')).toBeNull();
  expect(screen.getByRole('status').textContent).toBe('第 1 页 · 1 条记录');
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '下一页' }).disabled).toBe(true);
  expect(new URL(fetchMock.mock.calls[3][0]).searchParams.has('cursor')).toBe(false);
});

it('keeps the last successful page and cursor available when navigation fails', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(json({ user: { role: 'tenant_manager' } }))
    .mockResolvedValueOnce(auditPage('first', 'next-cursor'))
    .mockResolvedValueOnce(json({}, 503))
    .mockResolvedValueOnce(auditPage('second', null));
  vi.stubGlobal('fetch', fetchMock);

  render(<AuditPage />);
  await screen.findByText('fixture/first');
  const next = screen.getByRole<HTMLButtonElement>('button', { name: '下一页' });
  fireEvent.click(next);
  await screen.findByRole('alert');
  expect(screen.getByRole('status').textContent).toBe('第 1 页 · 1 条记录');
  expect(screen.queryByText('fixture/first')).toBeTruthy();

  fireEvent.click(next);
  await screen.findByText('fixture/second');
  expect(screen.getByRole('status').textContent).toBe('第 2 页 · 1 条记录');
  expect(screen.queryByRole('alert')).toBeNull();
  await waitFor(() => expect(next.disabled).toBe(true));
  expect(fetchMock.mock.calls[3][0]).toBe(fetchMock.mock.calls[2][0]);
});
