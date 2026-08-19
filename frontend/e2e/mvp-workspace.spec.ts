import { expect, Page, test } from '@playwright/test';

const activeTenantCode = '10CA000001';
const suspendedTenantCode = '10CA000002';
const password = 'PoolduckLocal123!';
const expectedMailStatus = process.env.E2E_EXPECT_MAIL_STATUS ?? 'sent';

async function login(page: Page, input: {
  tenantCode: string;
  identifier: string;
  password?: string;
}) {
  await page.goto('/');
  await page.getByTestId('tenant-code-input').fill(input.tenantCode);
  await page.getByTestId('identifier-input').fill(input.identifier);
  await page.getByTestId('password-input').fill(input.password ?? password);
  await page.getByTestId('login-submit').click();
  await expect(page.getByRole('heading', { name: '扫码工作台' })).toBeVisible();
}

test('MVP GUI: login, rejected/mapped scan, history refresh, and sandbox result', async ({ page }) => {
  await login(page, {
    tenantCode: activeTenantCode,
    identifier: 'local-operator',
  });

  await expect(page.getByTestId('license-status')).toHaveText('active');
  await expect(page.getByTestId('location-select')).toContainText('Local Office');
  await expect(
    page.getByRole('cell', { name: 'Local Recipient', exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText('l***t@example.local')).toBeVisible();

  await page
    .getByTestId('scan-code-input')
    .fill('V2E01K0ABC19999');
  await page.getByTestId('scan-submit').click();
  await expect(page.getByText('person_code未在当前 location 找到映射邮箱')).toBeVisible();
  await expect(page.getByText('01K0ABC19999')).toHaveCount(0);

  await page
    .getByTestId('scan-code-input')
    .fill('V2E01K0ABC10001');
  await page.getByTestId('scan-submit').click();

  const latestMailStatus = page.getByTestId('mail-status').first();
  await expect(latestMailStatus).toHaveText('可取消等待中');
  await expect(latestMailStatus).toHaveText(
    expectedMailStatus === 'queued' ? '发送中' : '已发送',
    { timeout: 20_000 },
  );
  await expect(page.getByText('01K0ABC10001').first()).toBeVisible();
  await expect(page.getByTestId('scan-action').first()).toHaveText('进入');
  const currentHistoryRow = page
    .getByRole('table', { name: '扫码记录' })
    .getByRole('row')
    .filter({ hasText: '01K0ABC10001' })
    .first();
  await expect(currentHistoryRow).toContainText('Local Recipient');

  await page.reload();
  const persistedHistoryRow = page
    .getByRole('table', { name: '扫码记录' })
    .getByRole('row')
    .filter({ hasText: '01K0ABC10001' })
    .first();
  await expect(persistedHistoryRow).toContainText('Local Recipient');
});

test('history API does not allow a tenant token to select another tenant location', async ({ request }) => {
  const loginResponse = await request.post('http://localhost:3001/api/auth/login', {
    data: {
      tenant_code: activeTenantCode,
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

test('ADR-017 cancellation survives refresh/relogin and treats a network failure as unknown', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, {
    tenantCode: activeTenantCode,
    identifier: 'local-operator',
  });

  await page.getByTestId('scan-code-input').fill('V2X01K0ABC10001');
  await page.getByTestId('scan-submit').click();
  const cancel = page.getByTestId('scan-cancel').first();
  await expect(cancel).toContainText('取消发送');
  await cancel.scrollIntoViewIfNeeded();
  const statusBox = await page.getByTestId('mail-status').first().boundingBox();
  const cancelBox = await cancel.boundingBox();
  expect(statusBox).not.toBeNull();
  expect(cancelBox).not.toBeNull();
  expect(statusBox?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((statusBox?.x ?? 390) + (statusBox?.width ?? 0)).toBeLessThanOrEqual(390);
  expect(cancelBox?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((cancelBox?.x ?? 390) + (cancelBox?.width ?? 0)).toBeLessThanOrEqual(390);
  expect(cancelBox?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect((cancelBox?.y ?? 0) + (cancelBox?.height ?? 0)).toBeLessThan(844);
  await cancel.click();
  await expect(page.getByTestId('mail-status').first()).toHaveText('已取消');

  await page.reload();
  await expect(page.getByTestId('mail-status').first()).toHaveText('已取消');
  await page.getByRole('button', { name: '退出' }).click();
  await login(page, {
    tenantCode: activeTenantCode,
    identifier: 'local-operator',
  });
  await expect(page.getByTestId('mail-status').first()).toHaveText('已取消');

  await page.route('**/api/scan-events/*/cancel', (route) => route.abort('failed'));
  await page.getByTestId('scan-code-input').fill('V2X01K0ABC10001');
  await page.getByTestId('scan-submit').click();
  await page.getByTestId('scan-cancel').first().click();
  await expect(page.getByText('取消结果未知，正在刷新权威状态。')).toBeVisible();
  await expect(page.getByTestId('mail-status').first()).not.toHaveText('已取消');
});

test('MVP GUI blocks scan entry for suspended subscriptions', async ({ page }) => {
  await login(page, {
    tenantCode: suspendedTenantCode,
    identifier: 'suspended-operator',
  });

  await expect(page.getByTestId('license-status')).toHaveText('suspended');
  await expect(page.getByText('订阅状态不可发送，扫码与发送入口已禁用。')).toBeVisible();
  await expect(page.getByTestId('scan-code-input')).toBeDisabled();
  await expect(page.getByTestId('scan-submit')).toBeDisabled();
});

test('operator can create, edit, deactivate and reactivate a person mapping', async ({ page }) => {
  await login(page, { tenantCode: activeTenantCode, identifier: 'local-operator' });
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
  await expect(codeDialog).toContainText(`V2E${personCode}`);
  await expect(codeDialog).toContainText(`V2X${personCode}`);
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
  const inactiveRow = page.getByRole('row').filter({ hasText: personCode });
  await expect(inactiveRow).toContainText('停用');
  page.once('dialog', (dialog) => dialog.accept());
  await inactiveRow.getByRole('button', { name: '重新启用' }).click();
  const reactivatedRow = page.getByRole('row').filter({ hasText: personCode });
  await expect(reactivatedRow).toContainText('启用');
  page.once('dialog', (dialog) => dialog.accept());
  await reactivatedRow.getByRole('button', { name: '删除', exact: true }).click();
  const pendingRow = page.getByRole('row').filter({ hasText: personCode });
  await expect(pendingRow).toContainText('待删除（剩余 14 天）');
  await expect(pendingRow.getByRole('button', { name: '恢复' })).toBeVisible();
  await pendingRow.getByRole('button', { name: '恢复' }).click();
  await expect(page.getByRole('row').filter({ hasText: personCode })).toContainText('启用');
});

test('tenant_manager can manage locations while operator has no location navigation', async ({ page }) => {
  await login(page, { tenantCode: activeTenantCode, identifier: 'local-operator' });
  await expect(page.getByRole('link', { name: '地点管理' })).toHaveCount(0);
  await page.getByRole('button', { name: '退出' }).click();
  await expect(page.getByTestId('tenant-code-input')).toBeVisible();

  await login(page, { tenantCode: activeTenantCode, identifier: 'tenant-manager@example.local' });
  await page.getByRole('link', { name: '地点管理' }).click();
  const locationName = `E2E Location ${Date.now()}`;
  await expect(page.getByPlaceholder('地点代码')).toHaveCount(0);
  await expect(page.locator('select')).toHaveCount(0);
  await page.getByPlaceholder('地点名称').fill(locationName);
  await page.getByRole('button', { name: '新增地点' }).click();
  const row = page.getByRole('row').filter({ hasText: locationName });
  await expect(row).toBeVisible();
  const code = (await row.locator('td').first().innerText()).trim();
  expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
  page.once('dialog', (dialog) => dialog.accept());
  await row.getByRole('button', { name: '停用' }).click();
  const inactiveRow = page.getByRole('row').filter({ hasText: code });
  await expect(inactiveRow).toContainText('停用');
  page.once('dialog', (dialog) => dialog.accept());
  await inactiveRow.getByRole('button', { name: '重新启用' }).click();
  const reactivatedRow = page.getByRole('row').filter({ hasText: code });
  await expect(reactivatedRow).toContainText('启用');
  page.once('dialog', (dialog) => dialog.accept());
  await reactivatedRow.getByRole('button', { name: '删除', exact: true }).click();
  const pendingRow = page.getByRole('row').filter({ hasText: code });
  await expect(pendingRow).toContainText('待删除（剩余 14 天）');
  await expect(pendingRow.getByRole('button', { name: '恢复' })).toBeVisible();
  await pendingRow.getByRole('button', { name: '恢复' }).click();
  await expect(page.getByRole('row').filter({ hasText: code })).toContainText('启用');
});

test('tenant_manager manages operators while operator has no user-management entry', async ({ page }) => {
  await login(page, { tenantCode: activeTenantCode, identifier: 'local-operator' });
  await expect(page.getByRole('link', { name: '用户管理' })).toHaveCount(0);
  await page.goto('/users');
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('button', { name: '退出' }).click();
  await expect(page.getByTestId('tenant-code-input')).toBeVisible();

  await login(page, { tenantCode: activeTenantCode, identifier: 'tenant-manager@example.local' });
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

test('tenant_manager assigns and revokes operator location access from user management', async ({ page }) => {
  test.setTimeout(60_000);
  await login(page, { tenantCode: activeTenantCode, identifier: 'tenant-manager@example.local' });
  await page.getByRole('link', { name: '用户管理' }).click();

  const suffix = Date.now().toString();
  const username = `e2e-assignment-${suffix}`;
  const operatorPassword = 'E2Eassign123';
  await page.getByTestId('create-user-username').fill(username);
  await page.getByTestId('create-user-password').fill(operatorPassword);
  await page.getByTestId('create-user-submit').click();

  let row = page.getByRole('row').filter({ hasText: username });
  await page.setViewportSize({ width: 900, height: 480 });
  await row.getByRole('button', { name: '配置地点' }).click();
  let dialog = page.getByRole('dialog');
  const saveButton = dialog.getByRole('button', { name: '保存地点权限' });
  await expect(saveButton).toBeVisible();
  const saveButtonBox = await saveButton.boundingBox();
  expect(saveButtonBox?.y ?? 480).toBeLessThan(480);
  await dialog.getByRole('checkbox', { name: /Local Office/ }).check();
  await dialog.getByRole('checkbox', { name: /Local School/ }).check();
  await saveButton.click();
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(row).toContainText('Local Office');
  await expect(row).toContainText('Local School');

  await page.getByRole('link', { name: '返回工作台' }).click();
  await page.getByRole('button', { name: '退出' }).click();
  await expect(page.getByTestId('tenant-code-input')).toBeVisible();
  await login(page, {
    tenantCode: activeTenantCode,
    identifier: username,
    password: operatorPassword,
  });
  await expect(page.getByTestId('location-select')).toContainText('Local Office');
  await expect(page.getByTestId('location-select')).toContainText('Local School');

  await page.getByRole('button', { name: '退出' }).click();
  await expect(page.getByTestId('tenant-code-input')).toBeVisible();
  await login(page, { tenantCode: activeTenantCode, identifier: 'tenant-manager@example.local' });
  await page.getByRole('link', { name: '用户管理' }).click();
  row = page.getByRole('row').filter({ hasText: username });
  await row.getByRole('button', { name: '配置地点' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: /Local School/ }).uncheck();
  page.once('dialog', (confirmation) => confirmation.accept());
  await dialog.getByRole('button', { name: '保存地点权限' }).click();
  await expect(page.getByRole('status')).toContainText('被撤销地点的后续请求会立即被拒绝');

  await page.getByRole('link', { name: '返回工作台' }).click();
  await page.getByRole('button', { name: '退出' }).click();
  await expect(page.getByTestId('tenant-code-input')).toBeVisible();
  await login(page, {
    tenantCode: activeTenantCode,
    identifier: username,
    password: operatorPassword,
  });
  await expect(page.getByTestId('location-select')).toContainText('Local Office');
  await expect(page.getByTestId('location-select')).not.toContainText('Local School');
});
