import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { randomBytes } from "node:crypto";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to run the Prisma smoke test.");
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const suffix = Date.now().toString();
const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeBase32(value, width) {
  let encoded = "";
  let remaining = value;
  for (let index = 0; index < width; index += 1) {
    encoded = alphabet[remaining % 32] + encoded;
    remaining = Math.floor(remaining / 32);
  }
  return encoded;
}

function createPersonCode() {
  const seconds = Math.floor(Date.now() / 1000);
  const random = randomBytes(4).readUInt32BE(0) & 0x1ffffff;
  return encodeBase32(seconds, 7) + encodeBase32(random, 5);
}

function createLocationCode() {
  return [...randomBytes(8)].map((value) => alphabet[value & 31]).join("");
}

function createTenantCode() {
  return [...randomBytes(10)].map((value) => alphabet[value & 31]).join("");
}

async function main() {
  const tenant = await prisma.tenant.create({
    data: {
      tenantCode: createTenantCode(),
      name: `Smoke Tenant ${suffix}`,
      status: "active",
      locationLimit: 2,
    },
  });

  await prisma.subscription.create({
    data: {
      tenantId: tenant.id,
      plan: "mvp",
      status: "trial",
      startAt: new Date(),
      endAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      username: null,
      email: `admin-${suffix}@example.local`,
      passwordHash: "argon2id-placeholder",
      role: "tenant_manager",
      status: "active",
    },
  });

  const operator = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      username: `smoke-${suffix}`,
      email: `operator-${suffix}@example.local`,
      passwordHash: "argon2id-placeholder",
      role: "operator",
      status: "active",
    },
  });

  const location = await prisma.location.create({
    data: {
      tenantId: tenant.id,
      locationCode: createLocationCode(),
      name: "Smoke Office",
      type: "location",
      status: "active",
    },
  });

  await prisma.operatorLocationAssignment.create({
    data: {
      tenantId: tenant.id,
      operatorId: operator.id,
      locationId: location.id,
    },
  });

  const personCode = createPersonCode();
  const mapping = await prisma.personMapping.create({
    data: {
      tenantId: tenant.id,
      locationId: location.id,
      personCode,
      scanCode: personCode,
      personName: "Smoke Recipient",
      email: `recipient-${suffix}@example.local`,
      status: "active",
    },
  });

  const scanEvent = await prisma.scanEvent.create({
    data: {
      tenantId: tenant.id,
      locationId: location.id,
      personMappingId: mapping.id,
      personCodeSnapshot: personCode,
      scanCode: personCode,
      scanType: "barcode",
      rawPayload: `SCAN-${suffix}`,
      receivedAt: new Date(),
      createdByUserId: user.id,
    },
  });

  await prisma.mailJob.create({
    data: {
      tenantId: tenant.id,
      locationId: location.id,
      personMappingId: mapping.id,
      scanEventId: scanEvent.id,
      tenantNameSnapshot: tenant.name,
      locationNameSnapshot: location.name,
      personNameSnapshot: mapping.personName,
      personCodeSnapshot: personCode,
      contextSnapshotSource: "scan_relation",
      toEmail: `recipient-${suffix}@example.local`,
      subject: "Smoke mail",
      body: "Smoke mail body",
      templateKey: "scan_notice_v1",
      status: "queued",
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "smoke_test",
      resourceType: "tenant",
      resourceId: tenant.id,
      result: "success",
      metadataJson: { issue: 21 },
    },
  });

  console.log(`Prisma smoke test completed for tenant ${tenant.id}`);
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
