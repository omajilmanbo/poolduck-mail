import { expect, Page, test } from '@playwright/test';

const activeTenantId = '11111111-1111-4111-8111-111111111111';
const suspendedTenantId = '22222222-2222-4222-8222-222222222222';
const password = 'PoolduckLocal123!';

async function login(page: Page, input: {
  tenantId: string;
  email: string;
}) {
  await page.goto('/');
  await page.getByTestId('tenant-id-input').fill(input.tenantId);
  await page.getByTestId('email-input').fill(input.email);
  await page.getByTestId('password-input').fill(password);
  await page.getByTestId('login-submit').click();
  await expect(page.getByRole('heading', { name: '扫码工作台' })).toBeVisible();
}

test('MVP GUI happy path: login, scan, and trigger sandbox send', async ({ page }) => {
  await login(page, {
    tenantId: activeTenantId,
    email: 'manager@example.local',
  });

  await expect(page.getByTestId('license-status')).toHaveText('active');
  await expect(page.getByTestId('location-select')).toContainText('Local Office');
  await expect(page.getByRole('cell', { name: 'Local Recipient', exact: true })).toBeVisible();
  await expect(page.getByText('l***t@example.local')).toBeVisible();

  await page.getByTestId('scan-code-input').fill('SCAN-LOCAL-001');
  await page.getByTestId('scan-submit').click();

  await expect(page.getByTestId('mail-status').first()).toHaveText('发送中');
  await expect(page.getByText('SCAN-LOCAL-001').first()).toBeVisible();

  await page.getByTestId('send-mail-button').first().click();
  await expect(page.getByTestId('mail-status').first()).toHaveText('已发送');
});

test('MVP GUI blocks scan entry for suspended subscriptions', async ({ page }) => {
  await login(page, {
    tenantId: suspendedTenantId,
    email: 'suspended-manager@example.local',
  });

  await expect(page.getByTestId('license-status')).toHaveText('suspended');
  await expect(page.getByText('订阅状态不可发送，扫码与发送入口已禁用。')).toBeVisible();
  await expect(page.getByTestId('scan-code-input')).toBeDisabled();
  await expect(page.getByTestId('scan-submit')).toBeDisabled();
});
