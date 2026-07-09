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
    name: "Poolduck Staging Active Tenant",
    subscriptionStatus: "active",
    manager: {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      email: "staging-active-manager@example.local",
    },
    root: {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      email: "staging-active-root@example.local",
    },
    location: {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      code: "STG-ACTIVE-OFFICE",
      name: "Staging Active Office",
      type: "office",
    },
    mapping: {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      scanCode: "SCAN-STG-ACTIVE-001",
      personName: "Staging Active Recipient",
      email: "staging-active-recipient@example.local",
    },
  },
  {
    id: "11111112-1112-4112-8112-111111111112",
    name: "Poolduck Staging Suspended Tenant",
    subscriptionStatus: "suspended",
    manager: {
      id: "22222223-2223-4223-8223-222222222223",
      email: "staging-suspended-manager@example.local",
    },
    root: {
      id: "33333334-3334-4334-8334-333333333334",
      email: "staging-suspended-root@example.local",
    },
    location: {
      id: "44444445-4445-4445-8445-444444444445",
      code: "STG-SUSPENDED-OFFICE",
      name: "Staging Suspended Office",
      type: "office",
    },
    mapping: {
      id: "55555556-5556-4556-8556-555555555556",
      scanCode: "SCAN-STG-SUSPENDED-001",
      personName: "Staging Suspended Recipient",
      email: "staging-suspended-recipient@example.local",
    },
  },
  {
    id: "66666667-6667-4667-8667-666666666667",
    name: "Poolduck Staging Expired Tenant",
    subscriptionStatus: "expired",
    manager: {
      id: "77777778-7778-4778-8778-777777777778",
      email: "staging-expired-manager@example.local",
    },
    root: {
      id: "88888889-8889-4889-8889-888888888889",
      email: "staging-expired-root@example.local",
    },
    location: {
      id: "99999990-9990-4990-8990-999999999990",
      code: "STG-EXPIRED-OFFICE",
      name: "Staging Expired Office",
      type: "office",
    },
    mapping: {
      id: "abababab-abab-4bab-8bab-abababababab",
      scanCode: "SCAN-STG-EXPIRED-001",
      personName: "Staging Expired Recipient",
      email: "staging-expired-recipient@example.local",
    },
  },
];

async function upsertUser({ id, tenantId, email, passwordHash, role }) {
  return prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId,
        email,
      },
    },
    update: {
      passwordHash,
      role,
      status: "active",
    },
    create: {
      id,
      tenantId,
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
      locationCode: code,
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
  const existing = await prisma.personMapping.findFirst({
    where: {
      tenantId,
      locationId,
      scanCode,
    },
    select: { id: true },
  });

  if (existing) {
    return prisma.personMapping.update({
      where: { id: existing.id },
      data: {
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
  await prisma.tenant.upsert({
    where: { id: tenant.id },
    update: {
      name: tenant.name,
      status: "active",
    },
    create: {
      id: tenant.id,
      name: tenant.name,
      status: "active",
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
    ...tenant.root,
    tenantId: tenant.id,
    passwordHash,
    role: "root_admin",
  });

  await upsertUser({
    ...tenant.manager,
    tenantId: tenant.id,
    passwordHash,
    role: "manager",
  });

  await upsertLocation({
    ...tenant.location,
    tenantId: tenant.id,
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
          tenant_id: tenant.id,
          subscription_status: tenant.subscriptionStatus,
          manager_email: tenant.manager.email,
          root_email: tenant.root.email,
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
