import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import argon2 from "argon2";
import { config } from "dotenv";

config({ path: "../.env", quiet: true });
config({ path: ".env", quiet: true });
config({ path: ".env.local", override: true, quiet: true });

if (process.env.NODE_ENV === "production" || process.env.APP_ENV === "production") {
  throw new Error("Synthetic platform seed is forbidden in Production.");
}
if (process.env.PLATFORM_SYNTHETIC_SEED !== "true") {
  throw new Error("Set PLATFORM_SYNTHETIC_SEED=true to opt in.");
}

const databaseUrl = process.env.DATABASE_URL;
const email = process.env.PLATFORM_SYNTHETIC_EMAIL?.trim().toLowerCase();
const password = process.env.PLATFORM_SYNTHETIC_PASSWORD;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (!email?.endsWith(".example.local")) {
  throw new Error("PLATFORM_SYNTHETIC_EMAIL must use .example.local.");
}
if (!password || password.length < 16) {
  throw new Error("PLATFORM_SYNTHETIC_PASSWORD must contain at least 16 characters.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

const tenants = [
  {
    id: "b1000000-0000-4000-8000-000000000001",
    code: "10PF000001",
    name: "Platform Synthetic Trial",
    status: "trial",
    limit: 1,
  },
  {
    id: "b1000000-0000-4000-8000-000000000002",
    code: "10PF000002",
    name: "Platform Synthetic Active",
    status: "active",
    limit: 3,
  },
  {
    id: "b1000000-0000-4000-8000-000000000003",
    code: "10PF000003",
    name: "Platform Synthetic Suspended",
    status: "suspended",
    limit: 1,
  },
  {
    id: "b1000000-0000-4000-8000-000000000004",
    code: "10PF000004",
    name: "Platform Synthetic Expired",
    status: "expired",
    limit: 1,
  },
];

async function main() {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const active = await prisma.platformAdmin.findFirst({
    where: { status: "active" },
  });
  if (active && active.email !== email) {
    throw new Error("A different active platform_admin exists; seed refused.");
  }
  if (!active) {
    await prisma.platformAdmin.upsert({
      where: { email },
      update: { passwordHash, status: "active" },
      create: { email, passwordHash, status: "active" },
    });
  }

  const now = new Date("2026-01-01T00:00:00.000Z");
  const future = new Date("2027-01-01T00:00:00.000Z");
  const pastStart = new Date("2025-01-01T00:00:00.000Z");
  const pastEnd = new Date("2025-12-31T23:59:59.000Z");

  for (const [index, tenant] of tenants.entries()) {
    const countedLocations = await prisma.location.count({
      where: { tenantId: tenant.id, status: { not: "purged" } },
    });
    const locationLimit = Math.max(tenant.limit, countedLocations);
    await prisma.tenant.upsert({
      where: { id: tenant.id },
      update: {
        tenantCode: tenant.code,
        name: tenant.name,
        locationLimit,
      },
      create: {
        id: tenant.id,
        tenantCode: tenant.code,
        name: tenant.name,
        status: "active",
        locationLimit,
      },
    });
    await prisma.subscription.upsert({
      where: { tenantId: tenant.id },
      update: {
        plan: "synthetic",
        status: tenant.status,
        startAt: tenant.status === "expired" ? pastStart : now,
        endAt: tenant.status === "expired" ? pastEnd : future,
      },
      create: {
        tenantId: tenant.id,
        plan: "synthetic",
        status: tenant.status,
        startAt: tenant.status === "expired" ? pastStart : now,
        endAt: tenant.status === "expired" ? pastEnd : future,
      },
    });
    await prisma.user.upsert({
      where: {
        tenantId_email: {
          tenantId: tenant.id,
          email: `manager-${index + 1}@seed.example.local`,
        },
      },
      update: {
        passwordHash,
        role: "tenant_manager",
        status: "active",
        mustChangePassword: false,
      },
      create: {
        id: `b2000000-0000-4000-8000-00000000000${index + 1}`,
        tenantId: tenant.id,
        email: `manager-${index + 1}@seed.example.local`,
        username: null,
        passwordHash,
        role: "tenant_manager",
        status: "active",
      },
    });
  }

  const activeTenantId = tenants[1].id;
  const locationStates = ["active", "inactive", "pending_delete", "purged"];
  for (const [index, status] of locationStates.entries()) {
    await prisma.location.upsert({
      where: {
        tenantId_locationCode: {
          tenantId: activeTenantId,
          locationCode: `PF00000${index + 1}`,
        },
      },
      update: {
        name: `Synthetic ${status}`,
        status,
        deletedAt: status === "pending_delete" ? now : null,
        purgeAfter:
          status === "pending_delete"
            ? new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
            : null,
      },
      create: {
        id: `b3000000-0000-4000-8000-00000000000${index + 1}`,
        tenantId: activeTenantId,
        locationCode: `PF00000${index + 1}`,
        name: `Synthetic ${status}`,
        type: "location",
        status,
        deletedAt: status === "pending_delete" ? now : null,
        purgeAfter:
          status === "pending_delete"
            ? new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
            : null,
      },
    });
  }
  console.log("Synthetic platform seed completed.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Synthetic seed failed.");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
