import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import argon2 from "argon2";
import { config } from "dotenv";

config({ path: "../.env", quiet: true });
config({ path: ".env", quiet: true });
config({ path: ".env.local", override: true, quiet: true });

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://poolduck_local:poolduck_local_password@localhost:5432/poolduck_mail";

const adapter = new PrismaPg({ connectionString: DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const password = "PoolduckStaging123!";
const activeStartAt = new Date("2026-01-01T00:00:00.000Z");
const activeEndAt = new Date("2027-01-01T00:00:00.000Z");
const expiredStartAt = new Date("2025-01-01T00:00:00.000Z");
const expiredEndAt = new Date("2025-12-31T23:59:59.000Z");

const tenants = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    tenantCode: "5A6E000001",
    name: "Poolduck Staging Active Tenant",
    subscriptionStatus: "active",
    operator: {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      username: "staging-active-operator",
      email: "staging-active-operator@example.local",
    },
    tenantManager: {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      email: "staging-active-tenant-manager@example.local",
    },
    location: {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      code: "5A6E0001",
      name: "Staging Active Office",
      type: "location",
    },
    mapping: {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      scanCode: "01K0ABC20001",
      personName: "Staging Active Recipient",
      email: "staging-active-recipient@example.local",
    },
  },
  {
    id: "11111112-1112-4112-8112-111111111112",
    tenantCode: "5A6E000002",
    name: "Poolduck Staging Suspended Tenant",
    subscriptionStatus: "suspended",
    operator: {
      id: "22222223-2223-4223-8223-222222222223",
      username: "staging-suspended-operator",
      email: "staging-suspended-operator@example.local",
    },
    tenantManager: {
      id: "33333334-3334-4334-8334-333333333334",
      email: "staging-suspended-tenant-manager@example.local",
    },
    location: {
      id: "44444445-4445-4445-8445-444444444445",
      code: "5A6E0002",
      name: "Staging Suspended Office",
      type: "location",
    },
    mapping: {
      id: "55555556-5556-4556-8556-555555555556",
      scanCode: "01K0ABC20002",
      personName: "Staging Suspended Recipient",
      email: "staging-suspended-recipient@example.local",
    },
  },
  {
    id: "66666667-6667-4667-8667-666666666667",
    tenantCode: "5A6E000003",
    name: "Poolduck Staging Expired Tenant",
    subscriptionStatus: "expired",
    operator: {
      id: "77777778-7778-4778-8778-777777777778",
      username: "staging-expired-operator",
      email: "staging-expired-operator@example.local",
    },
    tenantManager: {
      id: "88888889-8889-4889-8889-888888888889",
      email: "staging-expired-tenant-manager@example.local",
    },
    location: {
      id: "99999990-9990-4990-8990-999999999990",
      code: "5A6E0003",
      name: "Staging Expired Office",
      type: "location",
    },
    mapping: {
      id: "abababab-abab-4bab-8bab-abababababab",
      scanCode: "01K0ABC20003",
      personName: "Staging Expired Recipient",
      email: "staging-expired-recipient@example.local",
    },
  },
];

async function upsertUser({ id, tenantId, username = null, email, passwordHash, role }) {
  const existingByIdentity = await prisma.user.findUnique({
    where: username
      ? { tenantId_username: { tenantId, username } }
      : { tenantId_email: { tenantId, email } },
    select: { id: true },
  });
  const existing =
    existingByIdentity ??
    (await prisma.user.findUnique({
      where: { id },
      select: { id: true },
    }));

  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        tenantId,
        username,
        email,
        passwordHash,
        role,
        status: "active",
      },
    });
  }

  return prisma.user.create({
    data: {
      id,
      tenantId,
      username,
      email,
      passwordHash,
      role,
      status: "active",
    },
  });
}

async function upsertLocation({ id, tenantId, code, name, type }) {
  const existing = await prisma.location.findFirst({
    where: {
      tenantId,
      OR: [{ id }, { locationCode: code }],
    },
    select: { id: true },
  });

  if (existing) {
    return prisma.location.update({
      where: { id: existing.id },
      data: {
        locationCode: code,
        name,
        type,
        status: "active",
      },
    });
  }

  return prisma.location.create({
    data: {
      id,
      tenantId,
      locationCode: code,
      name,
      type,
      status: "active",
    },
  });
}

async function upsertPersonMapping({
  id,
  tenantId,
  locationId,
  scanCode,
  personName,
  email,
}) {
  const existingByCode = await prisma.personMapping.findFirst({
    where: {
      tenantId,
      locationId,
      personCode: scanCode,
    },
    select: { id: true },
  });
  const existing =
    existingByCode ??
    (await prisma.personMapping.findUnique({
      where: { id },
      select: { id: true },
    }));

  if (existing) {
    return prisma.personMapping.update({
      where: { id: existing.id },
      data: {
        personCode: scanCode,
        scanCode,
        personName,
        email,
        status: "active",
      },
    });
  }

  return prisma.personMapping.create({
    data: {
      id,
      tenantId,
      locationId,
      personCode: scanCode,
      scanCode,
      personName,
      email,
      status: "active",
    },
  });
}

function subscriptionDates(status) {
  if (status === "expired") {
    return {
      startAt: expiredStartAt,
      endAt: expiredEndAt,
    };
  }

  return {
    startAt: activeStartAt,
    endAt: activeEndAt,
  };
}

async function seedTenant(tenant, passwordHash) {
  const countedLocations = await prisma.location.count({
    where: { tenantId: tenant.id, status: { not: "purged" } },
  });
  const locationLimit = Math.max(tenant.locationLimit ?? 2, countedLocations);
  await prisma.tenant.upsert({
    where: { id: tenant.id },
    update: {
      tenantCode: tenant.tenantCode,
      name: tenant.name,
      status: "active",
      locationLimit,
    },
    create: {
      id: tenant.id,
      tenantCode: tenant.tenantCode,
      name: tenant.name,
      status: "active",
      locationLimit,
    },
  });

  await prisma.subscription.upsert({
    where: { tenantId: tenant.id },
    update: {
      plan: "mvp-staging",
      status: tenant.subscriptionStatus,
      ...subscriptionDates(tenant.subscriptionStatus),
    },
    create: {
      tenantId: tenant.id,
      plan: "mvp-staging",
      status: tenant.subscriptionStatus,
      ...subscriptionDates(tenant.subscriptionStatus),
    },
  });

  await upsertUser({
    ...tenant.tenantManager,
    tenantId: tenant.id,
    passwordHash,
    role: "tenant_manager",
  });

  await upsertUser({
    ...tenant.operator,
    tenantId: tenant.id,
    passwordHash,
    role: "operator",
  });

  await upsertLocation({
    ...tenant.location,
    tenantId: tenant.id,
  });

  await prisma.operatorLocationAssignment.upsert({
    where: {
      tenantId_operatorId_locationId: {
        tenantId: tenant.id,
        operatorId: tenant.operator.id,
        locationId: tenant.location.id,
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      operatorId: tenant.operator.id,
      locationId: tenant.location.id,
    },
  });

  await upsertPersonMapping({
    ...tenant.mapping,
    tenantId: tenant.id,
    locationId: tenant.location.id,
  });
}

async function main() {
  const passwordHash = await argon2.hash(password);

  for (const tenant of tenants) {
    await seedTenant(tenant, passwordHash);
  }

  console.log("Staging seed data is ready.");
  console.log(
    JSON.stringify(
      {
        password,
        tenants: tenants.map((tenant) => ({
          tenant_code: tenant.tenantCode,
          subscription_status: tenant.subscriptionStatus,
          operator_username: tenant.operator.username,
          operator_email: tenant.operator.email,
          tenant_manager_email: tenant.tenantManager.email,
          location_id: tenant.location.id,
          scan_code: tenant.mapping.scanCode,
        })),
      },
      null,
      2,
    ),
  );
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
