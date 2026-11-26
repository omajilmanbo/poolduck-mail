import { readFile } from 'node:fs/promises';
import { expect, test, type Download, type Page } from '@playwright/test';

const firstLocation = '44444444-4444-4444-8444-444444444444';
const exportLocation = '55555555-5555-4555-8555-555555555555';
const emptyHistory = { items: [], next_cursor: null };

async function mockWorkspace(page: Page, role = 'tenant_manager') {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    switch (path) {
      case '/api/auth/me':
        return route.fulfill({ json: { user: { role, email: 'synthetic@example.local' } } });
      case '/api/license/check':
        return route.fulfill({ json: { status: 'active', plan: 'mvp', can_send: true } });
      case '/api/locations':
        return route.fulfill({
          json: [firstLocation, exportLocation].map((location_id, index) => ({
            location_id, location_code: '10CA100' + index, location_name: 'Synthetic Office ' + index, is_active: true,
          })),
        });
      case '/api/scan-events':
      case '/api/audit-logs':
        return route.fulfill({ json: emptyHistory });
      case '/api/locations/' + firstLocation + '/people':
      case '/api/locations/' + exportLocation + '/people':
        return route.fulfill({ json: [] });
      default:
        return route.abort();
    }
  });
}

const exports = [
  {
    label: '扫描',
    resource: 'scan-events',
    header: '"received_at","location","person_code","person_name","action","action_source","status","effective_status","canceled_at","mail_job_id"',
    row: '"2026-11-19T00:00:00Z","Synthetic Office","01K0ABC80001","Synthetic Person","entry","person_action_code","sent","active","","mail-1"',
  },
  {
    label: '邮件',
    resource: 'mail-jobs',
    header: '"created_at","mail_job_id","tenant","location","person_name","person_code","action","email_masked","status","sent_at"',
    row: '"2026-11-19T00:00:00Z","mail-1","Synthetic Tenant","Synthetic Office","Synthetic Person","01K0ABC80001","entry","s***c@example.local","sent","2026-11-19T00:01:00Z"',
  },
];

for (const { label, resource, header, row } of exports) {
  test(label + ' CSV reports empty results and failure, then downloads rows on retry', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.setFixedTime(new Date('2026-11-19T10:00:00.000Z'));
    await mockWorkspace(page);

    const csv = '\uFEFF' + header;
    const nonEmptyCsv = csv + '\r\n' + row;
    const privateResponse = 'raw export error for synthetic-private@example.local';
    const requests: URL[] = [];
    const downloads: Download[] = [];
    const pageErrors: Error[] = [];
    page.on('download', (download) => downloads.push(download));
    page.on('pageerror', (error) => pageErrors.push(error));

    let responseBody = csv;
    let failNextRequest = false;
    await page.route('**/api/' + resource + '/export?*', async (route) => {
      const request = route.request();
      requests.push(new URL(request.url()));
      expect(request.method()).toBe('GET');
      if (failNextRequest) {
        failNextRequest = false;
        return route.fulfill({ status: 503, json: { message: privateResponse } });
      }
      return route.fulfill({ contentType: 'text/csv; charset=utf-8', body: responseBody });
    });

    await page.goto('/');
    await page.getByTestId('location-select').selectOption(exportLocation);
    await page.getByTestId('history-status-filter').selectOption('failed');
    await page.getByTestId('history-from-filter').fill('2026-11-01');
    await page.getByTestId('history-to-filter').fill('2026-11-02');
    await expect(page.getByText('暂无扫码记录')).toBeVisible();
    const button = page.getByRole('button', { name: '导出' + label, exact: true });
    const empty = page.getByRole('status').filter({ hasText: '没有可导出的' + label + '记录，CSV 仅含表头。' });
    const failed = page.getByRole('status').filter({ hasText: label + '导出失败，请再次点击“导出' + label + '”重试。' });
    const success = page.getByRole('status').filter({ hasText: label + ' CSV 已发起下载。' });
    await expect(empty).toHaveCount(0);

    const emptyDownload = page.waitForEvent('download');
    await button.click();
    await expect(empty).toBeVisible();
    const headerFile = await emptyDownload;
    expect(headerFile.suggestedFilename()).toBe(resource + '.csv');
    expect(await readFile(await headerFile.path())).toEqual(Buffer.from(csv));

    failNextRequest = true;
    await button.click();
    await expect(failed).toBeVisible();
    await expect(empty).toHaveCount(0);
    await expect(button).toBeEnabled();
    await expect(page.getByText(privateResponse)).toHaveCount(0);
    expect(downloads).toHaveLength(1);

    responseBody = nonEmptyCsv;
    const retryDownload = page.waitForEvent('download');
    await button.click();
    await expect(success).toBeVisible();
    await expect(failed).toHaveCount(0);
    await expect(page.getByText('暂无扫码记录')).toBeVisible();
    const dataFile = await retryDownload;
    expect(dataFile.suggestedFilename()).toBe(resource + '.csv');
    expect(await readFile(await dataFile.path())).toEqual(Buffer.from(nonEmptyCsv));

    const expectedQuery = {
      location_id: exportLocation,
      created_from: '2026-10-20T10:00:00.000Z',
      created_to: '2026-11-19T10:00:00.000Z',
    };
    expect(requests.map((url) => Object.fromEntries(url.searchParams))).toEqual([
      expectedQuery, expectedQuery, expectedQuery,
    ]);
    expect(downloads).toHaveLength(2);
    expect(pageErrors).toEqual([]);
  });
}

test('operator can view history but has neither CSV export button', async ({ page }) => {
  await mockWorkspace(page, 'operator');
  await page.goto('/');
  await expect(page.getByText('暂无扫码记录')).toBeVisible();
  await expect(page.getByRole('button', { name: '导出扫描' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '导出邮件' })).toHaveCount(0);
});

test('tenant audit CSV still downloads the original bytes', async ({ page }) => {
  await mockWorkspace(page);
  const csv = '\uFEFF"created_at","action"';
  await page.route('**/api/audit-logs/export?*', (route) =>
    route.fulfill({ contentType: 'text/csv; charset=utf-8', body: csv }),
  );
  const auditPage = await page.goto('/audit');
  expect(auditPage?.status()).toBe(200);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('audit-logs.csv');
  expect(await readFile(await file.path())).toEqual(Buffer.from(csv));
});
