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
  suspendedTenantId: "22222222-2222-4222-8222-222222222222",
  rootUserId: "33333333-3333-4333-8333-333333333333",
  managerUserId: "44444444-4444-4444-8444-444444444444",
  suspendedManagerUserId: "55555555-5555-4555-8555-555555555555",
  officeLocationId: "66666666-6666-4666-8666-666666666666",
  schoolLocationId: "77777777-7777-4777-8777-777777777777",
  activeMappingId: "88888888-8888-4888-8888-888888888888",
  inactiveMappingId: "99999999-9999-4999-8999-999999999999",
  password: "PoolduckLocal123!",
  rootEmail: "root-admin@example.local",
  managerEmail: "manager@example.local",
  suspendedManagerEmail: "suspended-manager@example.local",
  activeScanCode: "SCAN-LOCAL-001",
  inactiveScanCode: "SCAN-LOCAL-INACTIVE",
  unmappedScanCode: "SCAN-LOCAL-UNMAPPED",
};

async function upsertLocation(data) {
  const existing = await prisma.location.findFirst({
    where: {
      tenantId: data.tenantId,
      locationCode: data.locationCode,
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

async function upsertPersonMapping(data) {
  const existing = await prisma.personMapping.findFirst({
    where: {
      tenantId: data.tenantId,
      locationId: data.locationId,
      scanCode: data.scanCode,
    },
    select: { id: true },
  });

  if (existing) {
    return prisma.personMapping.update({
      where: { id: existing.id },
      data: {
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

  await prisma.tenant.upsert({
    where: { id: seed.activeTenantId },
    update: {
      name: "Poolduck Local Active Tenant",
      status: "active",
    },
    create: {
      id: seed.activeTenantId,
      name: "Poolduck Local Active Tenant",
      status: "active",
    },
  });

  await prisma.tenant.upsert({
    where: { id: seed.suspendedTenantId },
    update: {
      name: "Poolduck Local Suspended Tenant",
      status: "active",
    },
    create: {
      id: seed.suspendedTenantId,
      name: "Poolduck Local Suspended Tenant",
      status: "active",
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

  await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: seed.activeTenantId,
        email: seed.rootEmail,
      },
    },
    update: {
      passwordHash,
      role: "root_admin",
      status: "active",
    },
    create: {
      id: seed.rootUserId,
      tenantId: seed.activeTenantId,
      email: seed.rootEmail,
      passwordHash,
      role: "root_admin",
      status: "active",
    },
  });

  await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: seed.activeTenantId,
        email: seed.managerEmail,
      },
    },
    update: {
      passwordHash,
      role: "manager",
      status: "active",
    },
    create: {
      id: seed.managerUserId,
      tenantId: seed.activeTenantId,
      email: seed.managerEmail,
      passwordHash,
      role: "manager",
      status: "active",
    },
  });

  await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: seed.suspendedTenantId,
        email: seed.suspendedManagerEmail,
      },
    },
    update: {
      passwordHash,
      role: "manager",
      status: "active",
    },
    create: {
      id: seed.suspendedManagerUserId,
      tenantId: seed.suspendedTenantId,
      email: seed.suspendedManagerEmail,
      passwordHash,
      role: "manager",
      status: "active",
    },
  });

  await upsertLocation({
    id: seed.officeLocationId,
    tenantId: seed.activeTenantId,
    locationCode: "LOCAL-OFFICE",
    name: "Local Office",
    type: "office",
    status: "active",
  });

  await upsertLocation({
    id: seed.schoolLocationId,
    tenantId: seed.activeTenantId,
    locationCode: "LOCAL-SCHOOL",
    name: "Local School",
    type: "school",
    status: "active",
  });

  await upsertPersonMapping({
    id: seed.activeMappingId,
    tenantId: seed.activeTenantId,
    locationId: seed.officeLocationId,
    scanCode: seed.activeScanCode,
    personName: "Local Recipient",
    email: "local-recipient@example.local",
    status: "active",
  });

  await upsertPersonMapping({
    id: seed.inactiveMappingId,
    tenantId: seed.activeTenantId,
    locationId: seed.officeLocationId,
    scanCode: seed.inactiveScanCode,
    personName: "Inactive Local Recipient",
    email: "inactive-recipient@example.local",
    status: "inactive",
  });

  console.log("Local seed data is ready.");
  console.log(JSON.stringify(seed, null, 2));
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
