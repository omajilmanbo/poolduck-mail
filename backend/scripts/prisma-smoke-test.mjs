import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to run the Prisma smoke test.");
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const suffix = Date.now().toString();

async function main() {
  const tenant = await prisma.tenant.create({
    data: {
      name: `Smoke Tenant ${suffix}`,
      status: "active",
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
      email: `admin-${suffix}@example.local`,
      passwordHash: "argon2id-placeholder",
      role: "root_admin",
      status: "active",
    },
  });

  const location = await prisma.location.create({
    data: {
      tenantId: tenant.id,
      locationCode: `OFFICE_${suffix}`,
      name: "Smoke Office",
      type: "office",
      status: "active",
    },
  });

  await prisma.personMapping.create({
    data: {
      tenantId: tenant.id,
      locationId: location.id,
      scanCode: `SCAN-${suffix}`,
      personName: "Smoke Recipient",
      email: `recipient-${suffix}@example.local`,
      status: "active",
    },
  });

  const scanEvent = await prisma.scanEvent.create({
    data: {
      tenantId: tenant.id,
      locationId: location.id,
      scanCode: `SCAN-${suffix}`,
      scanType: "barcode",
      rawPayload: `SCAN-${suffix}`,
      receivedAt: new Date(),
      createdByUserId: user.id,
    },
  });

  await prisma.mailJob.create({
    data: {
      tenantId: tenant.id,
      scanEventId: scanEvent.id,
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
