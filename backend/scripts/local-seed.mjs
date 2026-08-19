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

const seed = {
  activeTenantId: "11111111-1111-4111-8111-111111111111",
  activeTenantCode: "10CA000001",
  suspendedTenantId: "22222222-2222-4222-8222-222222222222",
  suspendedTenantCode: "10CA000002",
  tenantManagerUserId: "33333333-3333-4333-8333-333333333333",
  operatorUserId: "44444444-4444-4444-8444-444444444444",
  suspendedOperatorUserId: "55555555-5555-4555-8555-555555555555",
  officeLocationId: "66666666-6666-4666-8666-666666666666",
  schoolLocationId: "77777777-7777-4777-8777-777777777777",
  suspendedLocationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  activeMappingId: "88888888-8888-4888-8888-888888888888",
  inactiveMappingId: "99999999-9999-4999-8999-999999999999",
  password: "PoolduckLocal123!",
  tenantManagerEmail: "tenant-manager@example.local",
  operatorUsername: "local-operator",
  operatorEmail: "operator@example.local",
  suspendedOperatorUsername: "suspended-operator",
  suspendedOperatorEmail: "suspended-operator@example.local",
  activeScanCode: "01K0ABC10001",
  inactiveScanCode: "01K0ABC10002",
};

async function upsertLocation(data) {
  const existing = await prisma.location.findFirst({
    where: {
      tenantId: data.tenantId,
      OR: [{ id: data.id }, { locationCode: data.locationCode }],
    },
    select: { id: true },
  });

  if (existing) {
    return prisma.location.update({
      where: { id: existing.id },
      data: {
        locationCode: data.locationCode,
        name: data.name,
        type: data.type,
        status: data.status,
      },
    });
  }

  return prisma.location.create({
    data,
  });
}

async function upsertUser(data) {
  const existingByIdentity = await prisma.user.findUnique({
    where: data.username
      ? {
          tenantId_username: {
            tenantId: data.tenantId,
            username: data.username,
          },
        }
      : {
          tenantId_email: {
            tenantId: data.tenantId,
            email: data.email,
          },
        },
    select: { id: true },
  });
  const existingById =
    existingByIdentity ??
    (await prisma.user.findUnique({
      where: { id: data.id },
      select: { id: true },
    }));

  if (existingById) {
    return prisma.user.update({
      where: { id: existingById.id },
      data: {
        tenantId: data.tenantId,
        username: data.username ?? null,
        email: data.email,
        passwordHash: data.passwordHash,
        role: data.role,
        status: data.status,
      },
    });
  }

  return prisma.user.create({
    data,
  });
}

async function upsertPersonMapping(data) {
  const existingByCode = await prisma.personMapping.findFirst({
    where: {
      tenantId: data.tenantId,
      locationId: data.locationId,
      personCode: data.personCode,
    },
    select: { id: true },
  });
  const existing =
    existingByCode ??
    (await prisma.personMapping.findUnique({
      where: { id: data.id },
      select: { id: true },
    }));

  if (existing) {
    return prisma.personMapping.update({
      where: { id: existing.id },
      data: {
        personCode: data.personCode,
        scanCode: data.scanCode,
        personName: data.personName,
        email: data.email,
        status: data.status,
      },
    });
  }

  return prisma.personMapping.create({
    data,
  });
}

async function main() {
  const passwordHash = await argon2.hash(seed.password);
  const startAt = new Date("2026-01-01T00:00:00.000Z");
  const endAt = new Date("2027-01-01T00:00:00.000Z");
  const activeLocationCount = await prisma.location.count({
    where: { tenantId: seed.activeTenantId, status: { not: "purged" } },
  });
  const suspendedLocationCount = await prisma.location.count({
    where: { tenantId: seed.suspendedTenantId, status: { not: "purged" } },
  });
  // Preserve prior synthetic E2E rows while leaving capacity for the next
  // create/delete/recover rehearsal. Seed reruns must not require cleanup.
  const activeLocationLimit = Math.max(4, activeLocationCount + 2);
  const suspendedLocationLimit = Math.max(2, suspendedLocationCount + 1);

  await prisma.tenant.upsert({
    where: { id: seed.activeTenantId },
    update: {
      tenantCode: seed.activeTenantCode,
      name: "Poolduck Local Active Tenant",
      status: "active",
      locationLimit: activeLocationLimit,
    },
    create: {
      id: seed.activeTenantId,
      tenantCode: seed.activeTenantCode,
      name: "Poolduck Local Active Tenant",
      status: "active",
      locationLimit: activeLocationLimit,
    },
  });

  await prisma.tenant.upsert({
    where: { id: seed.suspendedTenantId },
    update: {
      tenantCode: seed.suspendedTenantCode,
      name: "Poolduck Local Suspended Tenant",
      status: "active",
      locationLimit: suspendedLocationLimit,
    },
    create: {
      id: seed.suspendedTenantId,
      tenantCode: seed.suspendedTenantCode,
      name: "Poolduck Local Suspended Tenant",
      status: "active",
      locationLimit: suspendedLocationLimit,
    },
  });

  await prisma.subscription.upsert({
    where: { tenantId: seed.activeTenantId },
    update: {
      plan: "mvp-local",
      status: "active",
      startAt,
      endAt,
    },
    create: {
      tenantId: seed.activeTenantId,
      plan: "mvp-local",
      status: "active",
      startAt,
      endAt,
    },
  });

  await prisma.subscription.upsert({
    where: { tenantId: seed.suspendedTenantId },
    update: {
      plan: "mvp-local",
      status: "suspended",
      startAt,
      endAt,
    },
    create: {
      tenantId: seed.suspendedTenantId,
      plan: "mvp-local",
      status: "suspended",
      startAt,
      endAt,
    },
  });

  await upsertUser({
    id: seed.tenantManagerUserId,
    tenantId: seed.activeTenantId,
    username: null,
    email: seed.tenantManagerEmail,
    passwordHash,
    role: "tenant_manager",
    status: "active",
  });

  await upsertUser({
    id: seed.operatorUserId,
    tenantId: seed.activeTenantId,
    username: seed.operatorUsername,
    email: seed.operatorEmail,
    passwordHash,
    role: "operator",
    status: "active",
  });

  await upsertUser({
    id: seed.suspendedOperatorUserId,
    tenantId: seed.suspendedTenantId,
    username: seed.suspendedOperatorUsername,
    email: seed.suspendedOperatorEmail,
    passwordHash,
    role: "operator",
    status: "active",
  });

  await upsertLocation({
    id: seed.officeLocationId,
    tenantId: seed.activeTenantId,
    locationCode: "10CA1001",
    name: "Local Office",
    type: "location",
    status: "active",
  });

  await upsertLocation({
    id: seed.suspendedLocationId,
    tenantId: seed.suspendedTenantId,
    locationCode: "5A5D0001",
    name: "Suspended Office",
    type: "location",
    status: "active",
  });

  await prisma.operatorLocationAssignment.upsert({
    where: {
      tenantId_operatorId_locationId: {
        tenantId: seed.activeTenantId,
        operatorId: seed.operatorUserId,
        locationId: seed.officeLocationId,
      },
    },
    update: {},
    create: {
      tenantId: seed.activeTenantId,
      operatorId: seed.operatorUserId,
      locationId: seed.officeLocationId,
    },
  });

  await prisma.operatorLocationAssignment.upsert({
    where: {
      tenantId_operatorId_locationId: {
        tenantId: seed.suspendedTenantId,
        operatorId: seed.suspendedOperatorUserId,
        locationId: seed.suspendedLocationId,
      },
    },
    update: {},
    create: {
      tenantId: seed.suspendedTenantId,
      operatorId: seed.suspendedOperatorUserId,
      locationId: seed.suspendedLocationId,
    },
  });

  await upsertLocation({
    id: seed.schoolLocationId,
    tenantId: seed.activeTenantId,
    locationCode: "10CA1002",
    name: "Local School",
    type: "location",
    status: "active",
  });

  await upsertPersonMapping({
    id: seed.activeMappingId,
    tenantId: seed.activeTenantId,
    locationId: seed.officeLocationId,
    scanCode: seed.activeScanCode,
    personCode: seed.activeScanCode,
    personName: "Local Recipient",
    email: "local-recipient@example.local",
    status: "active",
  });

  await upsertPersonMapping({
    id: seed.inactiveMappingId,
    tenantId: seed.activeTenantId,
    locationId: seed.officeLocationId,
    scanCode: seed.inactiveScanCode,
    personCode: seed.inactiveScanCode,
    personName: "Inactive Local Recipient",
    email: "inactive-recipient@example.local",
    status: "inactive",
  });

  console.log("Local seed data is ready.");
  console.log(
    JSON.stringify(
      {
        environment: "local",
        synthetic_only: true,
        tenants: 2,
        locations: 3,
        people: 2,
        operator_assignments: 2,
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
