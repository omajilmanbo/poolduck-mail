import { APIRequestContext, expect, Page, Route, test } from '@playwright/test';

const api = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';
const office = '10CA1001';
const school = '10CA1002';
const otherTenant = '5A5D0001';
const seededPerson = '01K0ABC10001';

function peopleUrl(location: string) {
  return `${api}/api/locations/${location}/people`;
}

function personRow(page: Page, personId: string) {
  return page.getByRole('row').filter({
    has: page.getByRole('cell', { name: personId, exact: true }),
  });
}

function editButton(page: Page, personId: string) {
  return personRow(page, personId).getByRole('button', { name: '编辑', exact: true });
}

function networkError(page: Page) {
  return page.getByRole('alert').filter({ hasText: '无法连接后端 API' });
}

let operator: APIRequestContext;
let manager: APIRequestContext;

test.beforeAll(async ({ playwright }) => {
  operator = await playwright.request.newContext();
  manager = await playwright.request.newContext();
  await login(operator, 'local-operator');
  await login(manager, 'tenant-manager@example.local');
});

test.afterAll(async () => {
  await operator?.dispose();
  await manager?.dispose();
});

async function login(request: APIRequestContext, identifier: string) {
  const response = await request.post(`${api}/api/auth/login`, {
    data: { tenant_code: '10CA000001', identifier, password: 'PoolduckLocal123!' },
  });
  expect(response.status()).toBe(201);
}

async function useSession(page: Page, request: APIRequestContext) {
  const { cookies } = await request.storageState();
  await page.context().addCookies(cookies);
}

async function createPerson(request: APIRequestContext, location: string) {
  const person = { person_name: 'Edit Race Fixture', email: 'edit-race@example.local' };
  const response = await request.post(peopleUrl(location), { data: person });
  expect(response.status()).toBe(201);
  const { person_id } = await response.json();
  return { person, personId: person_id as string, detailUrl: `${peopleUrl(location)}/${person_id}` };
}

async function holdDetail(page: Page, location: string, personId: string) {
  const url = `${peopleUrl(location)}/${personId}`;
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  page.once('close', release);
  const routeDetail = async (route: Route) => {
    await hold;
    if (!page.isClosed()) await route.continue();
  };
  await page.route(url, routeDetail);
  const requested = page.waitForRequest((request) => request.url() === url && request.method() === 'GET');
  await editButton(page, personId).click();
  await requested;
  return async () => {
    const received = page.waitForResponse((response) => response.url() === url && response.request().method() === 'GET');
    release();
    const response = await received;
    expect(response.status()).toBe(200);
    await response.finished();
    await page.unroute(url, routeDetail);
  };
}

test('held person detail blocks keyboard input and submission, then saves and rereads both fields', async ({ page }) => {
  await useSession(page, operator);
  const { person, personId, detailUrl } = await createPerson(operator, office);
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith(peopleUrl(office)) && ['POST', 'PATCH'].includes(request.method())) {
      writes.push(request.method());
    }
  });
  await page.goto('/people');
  const name = page.getByLabel('姓名');
  const email = page.getByLabel('邮箱');
  const save = page.getByRole('button', { name: '保存', exact: true });
  const finishDetail = await holdDetail(page, office, personId);

  await expect(page.getByRole('status')).toContainText(`正在读取人员资料（${person.person_name}）`);
  await expect(name).toBeDisabled();
  await expect(email).toBeDisabled();
  await expect(save).toBeDisabled();
  await name.click({ force: true });
  await page.keyboard.type('Discarded draft');
  await email.click({ force: true });
  await page.keyboard.type('discarded@example.local');
  await page.keyboard.press('Enter');
  await expect(name).toHaveValue('');
  await expect(email).toHaveValue('');

  await finishDetail();
  await expect(name).toHaveValue(person.person_name);
  await expect(email).toHaveValue(person.email);
  expect(writes).toEqual([]);

  const updated = { person_name: 'Updated Edit Race Fixture', email: 'edit-race-updated@example.local' };
  await name.fill(updated.person_name);
  await email.fill(updated.email);
  await page.route(detailUrl, (route) => route.abort('failed'), { times: 1 });
  await save.click();
  await expect(networkError(page)).toBeVisible();
  await expect(name).toHaveValue(updated.person_name);
  await expect(email).toHaveValue(updated.email);

  const saved = page.waitForResponse((response) => response.url() === detailUrl && response.request().method() === 'PATCH');
  await save.click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole('status')).toHaveText('人员资料已更新');
  expect(writes).toEqual(['PATCH', 'PATCH']);
  await expect(personRow(page, personId)).toContainText(updated.person_name);

  await page.reload();
  await editButton(page, personId).click();
  await expect(name).toHaveValue(updated.person_name);
  await expect(email).toHaveValue(updated.email);
});

test('failed detail can be retried and an older person response cannot replace the current draft', async ({ page }) => {
  await useSession(page, operator);
  const { person, personId, detailUrl } = await createPerson(operator, office);
  await page.goto('/people');
  const finishEarlierDetail = await holdDetail(page, office, seededPerson);
  await page.route(detailUrl, (route) => route.abort('failed'), { times: 1 });
  await editButton(page, personId).click();

  const save = page.getByRole('button', { name: '保存', exact: true });
  const name = page.getByLabel('姓名');
  const email = page.getByLabel('邮箱');
  await expect(networkError(page)).toBeVisible();
  await expect(name).toBeDisabled();
  await expect(email).toBeDisabled();
  await expect(save).toBeDisabled();
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(networkError(page)).toHaveCount(0);
  await expect(name).toHaveValue(person.person_name);
  await expect(email).toHaveValue(person.email);

  const draft = { person_name: 'Selected Person Draft', email: 'selected-draft@example.local' };
  await name.fill(draft.person_name);
  await email.fill(draft.email);
  await finishEarlierDetail();

  const saved = page.waitForResponse((response) => response.request().method() === 'PATCH');
  await save.click();
  const response = await saved;
  expect(response.url()).toBe(detailUrl);
  expect(response.request().postDataJSON()).toEqual(draft);
  expect(response.status()).toBe(200);
});

test('changing location isolates the edit and preserves operator location boundaries', async ({ page }) => {
  const { person, personId, detailUrl } = await createPerson(manager, school);
  await useSession(page, operator);
  await page.goto(`/people?location_id=${school}`);
  const location = page.getByRole('combobox', { name: '地点' });
  await expect(location).toHaveValue(office);
  await expect(location.locator('option')).toHaveCount(1);

  for (const url of [detailUrl, `${peopleUrl(otherTenant)}/${seededPerson}`]) {
    const read = await page.request.get(url);
    const update = await page.request.patch(url, { data: { person_name: 'Out of scope' } });
    for (const denied of [read, update]) {
      expect(denied.status()).toBe(404);
      expect(await denied.json()).toMatchObject({ code: 'LOCATION_NOT_FOUND' });
    }
  }

  await useSession(page, manager);
  await page.goto(`/people?location_id=${office}`);
  const finishOfficeDetail = await holdDetail(page, office, seededPerson);
  await location.selectOption(school);
  await expect(editButton(page, seededPerson)).toHaveCount(0);
  await editButton(page, personId).click();
  const name = page.getByLabel('姓名');
  const email = page.getByLabel('邮箱');
  await expect(name).toHaveValue(person.person_name);
  await expect(email).toHaveValue(person.email);

  const draft = { person_name: 'School Person Draft', email: 'school-draft@example.local' };
  await name.fill(draft.person_name);
  await email.fill(draft.email);
  await finishOfficeDetail();

  const saved = page.waitForResponse((response) => response.request().method() === 'PATCH');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const response = await saved;
  expect(response.url()).toBe(detailUrl);
  expect(response.request().postDataJSON()).toEqual(draft);
  expect(response.status()).toBe(200);
});
