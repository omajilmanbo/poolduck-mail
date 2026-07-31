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
  await page.getByRole('button', { name: '我已安全保存，清除显示' }).click();
  await expect(page.getByTestId('temporary-password')).toHaveCount(0);
});
