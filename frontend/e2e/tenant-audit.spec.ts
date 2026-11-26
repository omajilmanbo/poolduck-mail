import { expect, Page, test } from '@playwright/test';
import type { AuditLogItem } from '../src/api/client';

const auditList = /\/api\/audit-logs(?:\?|$)/;
const actor = '33333333-3333-4333-8333-333333333333';
const timestamp = '2026-11-17T01:00:00.000Z';
const filters = {
  created_from: '2026-11-17T00:00:00.000Z',
  created_to: '2026-11-17T02:00:00.000Z',
  action: 'fixture.inspect',
  result: 'success',
  actor_user_id: actor,
};
const items: AuditLogItem[] = Array.from({ length: 31 }, (_, index) => {
  const id = String(31 - index).padStart(12, '0');
  return {
    audit_log_id: `14600400-0000-4000-8000-${id}`,
    created_at: timestamp,
    actor_user_id: actor,
    action: filters.action,
    result: 'success',
    resource_type: 'fixture',
    resource_id: id,
    metadata: {},
  };
});
const cursor = 'synthetic+cursor=/';

test.use({ timezoneId: 'Asia/Tokyo' });

async function login(page: Page, identifier: string, tenantCode = '10CA000001') {
  await page.goto('/');
  await page.getByTestId('tenant-code-input').fill(tenantCode);
  await page.getByTestId('identifier-input').fill(identifier);
  await page.getByTestId('password-input').fill('PoolduckLocal123!');
  await page.getByTestId('login-submit').click();
  await expect(page.getByRole('heading', { name: '扫码工作台' })).toBeVisible();
}

test('tenant audit pages through the submitted filters and resets on a new query', async ({ page }) => {
  const queries: Record<string, string>[] = [];
  await page.route(auditList, async (route) => {
    const query = Object.fromEntries(new URL(route.request().url()).searchParams);
    queries.push(query);
    if (query.action !== filters.action) {
      await route.fulfill({ json: { items: [], next_cursor: null } });
      return;
    }
    await route.fulfill({ json: query.cursor === cursor
      ? { items: items.slice(25), next_cursor: null }
      : { items: items.slice(0, 25), next_cursor: cursor } });
  });

  await login(page, 'tenant-manager@example.local');
  await page.getByRole('link', { name: '审计', exact: true }).click();
  const pagination = page.getByRole('navigation', { name: '审计日志分页' });
  const previous = pagination.getByRole('button', { name: '上一页' });
  const next = pagination.getByRole('button', { name: '下一页' });
  const status = pagination.getByRole('status');
  const resources = page.getByRole('cell').filter({ hasText: /^fixture\// });
  const resourceNames = items.map(({ resource_id }) => `fixture/${resource_id}`);

  await expect(status).toHaveText('第 1 页 · 0 条记录');
  await page.getByLabel('开始时间').fill('2026-11-17T09:00');
  await page.getByLabel('结束时间').fill('2026-11-17T11:00');
  await page.getByPlaceholder('action').fill(filters.action);
  await page.getByLabel('result').selectOption(filters.result);
  await page.getByPlaceholder('actor user UUID').fill(actor);
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(status).toHaveText('第 1 页 · 25 条记录');
  await expect(resources).toHaveText(resourceNames.slice(0, 25));
  await expect(previous).toBeDisabled();

  await page.getByPlaceholder('action').fill('fixture.other');
  await next.click();
  await expect(status).toHaveText('第 2 页 · 6 条记录');
  await expect(resources).toHaveText(resourceNames.slice(25));
  await expect(next).toBeDisabled();
  expect(queries.at(-1)).toEqual({ ...filters, cursor });

  await previous.click();
  await expect(status).toHaveText('第 1 页 · 25 条记录');
  await expect(resources).toHaveText(resourceNames.slice(0, 25));
  expect(queries.at(-1)).toEqual(filters);

  await next.click();
  await expect(status).toHaveText('第 2 页 · 6 条记录');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(status).toHaveText('第 1 页 · 0 条记录');
  await expect(resources).toHaveCount(0);
  await expect(previous).toBeDisabled();
  await expect(next).toBeDisabled();
  expect(queries.at(-1)).toEqual({ ...filters, action: 'fixture.other' });
});

test('operator cannot open tenant audit or use the list API with a cursor', async ({ page }) => {
  // Use the separately seeded operator to isolate the workspace login quota.
  await login(page, 'suspended-operator', '10CA000002');
  await expect(page.getByRole('link', { name: '审计', exact: true })).toHaveCount(0);
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';
  const denied = await page.request.get(`${apiBase}/api/audit-logs?cursor=${encodeURIComponent(cursor)}`);
  expect(denied.status()).toBe(403);
  expect(await denied.json()).toMatchObject({ code: 'ROLE_FORBIDDEN' });

  await page.goto('/audit');
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: '扫码工作台' })).toBeVisible();
});
