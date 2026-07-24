import { expect, Page, test } from '@playwright/test';

const activeTenantId = '11111111-1111-4111-8111-111111111111';
const suspendedTenantId = '22222222-2222-4222-8222-222222222222';
const password = 'PoolduckLocal123!';
const expectedMailStatus = process.env.E2E_EXPECT_MAIL_STATUS ?? 'sent';

async function login(page: Page, input: {
  tenantId: string;
  identifier: string;
}) {
  await page.goto('/');
  await page.getByTestId('tenant-id-input').fill(input.tenantId);
  await page.getByTestId('identifier-input').fill(input.identifier);
  await page.getByTestId('password-input').fill(password);
  await page.getByTestId('login-submit').click();
  await expect(page.getByRole('heading', { name: '扫码工作台' })).toBeVisible();
}

test('MVP GUI: login, unmapped/mapped scan, history refresh, and sandbox result', async ({ page }) => {
  await login(page, {
    tenantId: activeTenantId,
    identifier: 'local-operator',
  });

  await expect(page.getByTestId('license-status')).toHaveText('active');
  await expect(page.getByTestId('location-select')).toContainText('Local Office');
  await expect(page.getByRole('cell', { name: 'Local Recipient', exact: true })).toBeVisible();
  await expect(page.getByText('l***t@example.local')).toBeVisible();

  await page
    .getByTestId('scan-code-input')
    .fill('PD1|ENTRY|01K0ABC19999');
  await page.getByTestId('scan-submit').click();
  await expect(page.getByTestId('mail-status').first()).toHaveText('未映射');
  await page.getByRole('link', { name: '未映射扫码' }).click();
  await expect(page.getByRole('heading', { name: '未映射扫码处理' })).toBeVisible();
  await expect(page.getByText('01K0ABC19999').first()).toBeVisible();
  await page.getByRole('link', { name: '返回工作台' }).click();

  await page
    .getByTestId('scan-code-input')
    .fill('PD1|ENTRY|01K0ABC10001');
  await page.getByTestId('scan-submit').click();

  await expect(page.getByTestId('mail-status').first()).toHaveText(
    expectedMailStatus === 'queued' ? '发送中' : '已发送',
  );
  await expect(page.getByText('01K0ABC10001').first()).toBeVisible();
  await expect(page.getByTestId('scan-action').first()).toHaveText('进入');

  await page.reload();
  await expect(page.getByText('01K0ABC10001').first()).toBeVisible();
});

test('history API does not allow a tenant token to select another tenant location', async ({ request }) => {
  const loginResponse = await request.post('http://localhost:3001/api/auth/login', {
    data: {
      tenant_id: activeTenantId,
      identifier: 'local-operator',
      password,
    },
  });
  expect(loginResponse.ok()).toBe(true);
  const response = await request.get(
    `http://localhost:3001/api/scan-events?location_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
  );
  expect(response.status()).toBe(404);
});

test('MVP GUI blocks scan entry for suspended subscriptions', async ({ page }) => {
  await login(page, {
    tenantId: suspendedTenantId,
    identifier: 'suspended-operator',
  });

  await expect(page.getByTestId('license-status')).toHaveText('suspended');
  await expect(page.getByText('订阅状态不可发送，扫码与发送入口已禁用。')).toBeVisible();
  await expect(page.getByTestId('scan-code-input')).toBeDisabled();
  await expect(page.getByTestId('scan-submit')).toBeDisabled();
});

test('operator can create, edit and soft-deactivate a person mapping', async ({ page }) => {
  await login(page, { tenantId: activeTenantId, identifier: 'local-operator' });
  await page.getByRole('link', { name: '人员管理' }).click();
  const suffix = Date.now().toString();
  const personName = `E2E Person ${suffix}`;
  const updatedPersonName = `${personName} Updated`;
  await page.getByLabel('姓名').fill(personName);
  await page.getByLabel('邮箱').fill(`e2e-${suffix}@example.local`);
  await page.getByRole('button', { name: '新增' }).click();
  const row = page.getByRole('row').filter({ hasText: personName });
  await expect(row).toBeVisible();
  const personCode = (await row.locator('td').nth(1).innerText()).trim();
  expect(personCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);

  await row.getByRole('button', { name: '查看动作码' }).click();
  const codeDialog = page.getByRole('dialog');
  await expect(codeDialog.getByRole('img')).toHaveCount(4);
  await expect(codeDialog).toContainText(`PD1|ENTRY|${personCode}`);
  await expect(codeDialog).toContainText(`PD1|EXIT|${personCode}`);
  const downloadPromise = page.waitForEvent('download');
  await codeDialog.getByRole('button', { name: '下载全部四张图片 ZIP' }).click();
  expect((await downloadPromise).suggestedFilename()).toBe(`${personCode}-action-codes.zip`);
  await codeDialog.getByRole('button', { name: '关闭' }).click();

  await row.getByRole('button', { name: '编辑' }).click();
  await page.getByLabel('姓名').fill(updatedPersonName);
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText(updatedPersonName)).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('row').filter({ hasText: personCode }).getByRole('button', { name: '停用' }).click();
  await expect(page.getByRole('row').filter({ hasText: personCode })).toContainText('停用');
});

test('tenant_manager can manage locations while operator has no location navigation', async ({ page }) => {
  await login(page, { tenantId: activeTenantId, identifier: 'local-operator' });
  await expect(page.getByRole('link', { name: '地点管理' })).toHaveCount(0);
  await page.getByRole('button', { name: '退出' }).click();
  await expect(page.getByTestId('tenant-id-input')).toBeVisible();

  await login(page, { tenantId: activeTenantId, identifier: 'tenant-manager@example.local' });
  await page.getByRole('link', { name: '地点管理' }).click();
  const code = `E2E-LOC-${Date.now()}`;
  await page.getByPlaceholder('地点代码').fill(code);
  await page.getByPlaceholder('地点名称').fill('E2E Location');
  await page.getByRole('button', { name: '新增' }).click();
  const row = page.getByRole('row').filter({ hasText: code });
  await expect(row).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await row.getByRole('button', { name: '停用' }).click();
  await expect(page.getByRole('row').filter({ hasText: code })).toContainText('停用');
});

test('tenant_manager manages operators while operator has no user-management entry', async ({ page }) => {
  await login(page, { tenantId: activeTenantId, identifier: 'local-operator' });
  await expect(page.getByRole('link', { name: '用户管理' })).toHaveCount(0);
  await page.goto('/users');
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('button', { name: '退出' }).click();
  await expect(page.getByTestId('tenant-id-input')).toBeVisible();

  await login(page, { tenantId: activeTenantId, identifier: 'tenant-manager@example.local' });
  await page.getByRole('link', { name: '用户管理' }).click();
  await expect(page.getByRole('heading', { name: '用户管理' })).toBeVisible();

  const suffix = Date.now().toString();
  const username = `e2e-operator-${suffix}`;
  await page.getByTestId('create-user-username').fill(username);
  await page.getByTestId('create-user-password').fill('E2Epass123');
  await page.getByTestId('create-user-submit').click();

  const row = page.getByRole('row').filter({ hasText: username });
  await expect(row).toContainText('operator');
  await expect(row).toContainText('启用');

  await row.getByRole('button', { name: '重置密码' }).click();
  await row.getByLabel('新密码').fill('E2Ereset123');
  page.once('dialog', (dialog) => dialog.accept());
  await row.getByRole('button', { name: '确认重置' }).click();
  await expect(page.getByRole('status')).toContainText('密码已重置');

  page.once('dialog', (dialog) => dialog.accept());
  await row.getByRole('button', { name: '停用' }).click();
  await expect(page.getByRole('row').filter({ hasText: username })).toContainText('停用');
});
