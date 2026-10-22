import { expect, test } from '@playwright/test';
import type {
  CreatedPlatformTenant,
  PlatformTenantSummary,
} from '../src/api/client';

test('platform UI is independent, responsive, and clears one-time credentials', async ({
  page,
}) => {
  await page.route('**/api/platform/auth/me', (route) =>
    route.fulfill({
      json: {
        admin: {
          platform_admin_id: 'admin-1',
          email_masked: 'r***t@example.local',
          identity_version: 1,
          session_id: 'session-1',
        },
      },
    }),
  );
  let tenants: PlatformTenantSummary[] = [];
  await page.route('**/api/platform/tenants', async (route) => {
    if (route.request().method() === 'POST') {
      const created: CreatedPlatformTenant = {
        tenant_code: '10PFABC001',
        name: 'E2E Tenant',
        status: 'active',
        created_at: new Date().toISOString(),
        platform_version: 1,
        location_limit: 1,
        location_count: 0,
        subscription: {
          plan: 'manual',
          status: 'trial',
          start_at: new Date().toISOString(),
          end_at: new Date(Date.now() + 86400000).toISOString(),
          version: 1,
        },
        manager: { email_masked: 'm***r@example.local', status: 'active' },
        recent_platform_operation: null,
        temporary_password: 'SyntheticTemporary123!',
        idempotency_replayed: false,
      };
      tenants = [created];
      await route.fulfill({ json: created });
      return;
    }
    await route.fulfill({ json: tenants });
  });
  page.on('dialog', (dialog) => dialog.accept());
  await page.setViewportSize({ width: 390, height: 720 });
  await page.goto('/platform');
  await expect(
    page.getByRole('heading', { name: '平台运营控制台' }),
  ).toBeVisible();
  await expect(
    page.locator('a[href="/people"], a[href="/locations"], a[href="/users"]'),
  ).toHaveCount(0);
  await page.getByLabel('租户名称').fill('E2E Tenant');
  await page
    .getByLabel('首个 tenant_manager 邮箱')
    .fill('manager@example.local');
  await page.getByRole('button', { name: '确认并创建' }).click();
  await expect(page.getByTestId('temporary-password')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载创建信息 CSV' }).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(
    /^poolduck-tenant-[0-9A-Z]{10}-credentials\.csv$/,
  );
  await page.getByRole('button', { name: '我已安全保存，清除显示' }).click();
  await expect(page.getByTestId('temporary-password')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '下载创建信息 CSV' })).toHaveCount(0);
});

test('platform deletion confirmation is usable by keyboard on a narrow screen', async ({ page }) => {
  let status = 'active';
  await page.route('**/api/platform/auth/me', (route) => route.fulfill({ json: {
    admin: { platform_admin_id: 'admin-1', email_masked: 'a***n@example.local' },
  } }));
  await page.route('**/api/platform/auth/environment', (route) => route.fulfill({ json: {
    environment: 'production', deletion_enabled: true,
  } }));
  await page.route('**/api/platform/auth/mail-mode', (route) => route.fulfill({ json: { mode: 'mock' } }));
  await page.route('**/api/platform/tenants', (route) => route.fulfill({ json: [{
    tenant_code: '10PFABC001', name: 'Synthetic Tenant', status,
    deleted_at: status === 'pending_delete' ? '2026-10-20T00:00:00.000Z' : null,
    purge_after: status === 'pending_delete' ? '2027-10-20T00:00:00.000Z' : null,
    created_at: '2026-01-01T00:00:00.000Z', platform_version: 1,
    location_limit: 1, location_count: 0,
    subscription: { plan: 'manual', status: status === 'pending_delete' ? 'suspended' : 'trial',
      start_at: '2026-01-01T00:00:00.000Z', end_at: '2027-01-01T00:00:00.000Z', version: 1 },
    manager: { email_masked: 'm***r@example.local', status: 'active' },
    recent_platform_operation: null,
  }] }));
  await page.route('**/api/platform/tenants/*/delete', async (route) => {
    const body = route.request().postDataJSON();
    expect(body).toEqual({ password: 'SyntheticPassword123!' });
    status = 'pending_delete';
    await route.fulfill({ json: { tenant_code: '10PFABC001', status,
      deleted_at: '2026-10-20T00:00:00.000Z', purge_after: '2027-10-20T00:00:00.000Z',
      idempotency_replayed: false } });
  });
  await page.setViewportSize({ width: 390, height: 720 });
  await page.goto('/platform');
  const open = page.getByRole('button', { name: '删除租户' });
  await expect(open).toBeVisible();
  await open.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('删除确认密码').fill('SyntheticPassword123!');
  await page.getByLabel('删除确认密码').press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('已进入删除期');
  await expect(page.getByLabel('删除确认密码')).toHaveCount(0);
});
