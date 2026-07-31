import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import argon2 from "argon2";
import { config } from "dotenv";
import { createHash } from "node:crypto";

config({ path: "../.env", quiet: true });
config({ path: ".env", quiet: true });
config({ path: ".env.local", override: true, quiet: true });

const command = process.argv[2];
const databaseUrl = process.env.DATABASE_URL;
const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.PLATFORM_ADMIN_PASSWORD;

if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (!["bootstrap", "disable", "rotate", "recover"].includes(command)) {
  throw new Error("Usage: node scripts/platform-admin.mjs bootstrap|disable|rotate|recover");
}
if (!email || !email.includes("@")) {
  throw new Error("PLATFORM_ADMIN_EMAIL is required.");
}
if (["bootstrap", "rotate", "recover"].includes(command) && (!password || password.length < 16)) {
  throw new Error("PLATFORM_ADMIN_PASSWORD must contain at least 16 characters.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function audit(client, adminId, action, result, metadata = {}) {
  await client.platformAuditLog.create({
    data: {
      platformAdminId: adminId,
      action,
      resourceType: "platform_admin",
      resourceId: adminId ?? "unknown",
      result,
      metadataJson: metadata,
    },
  });
}

async function main() {
  if (command === "bootstrap") {
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    await prisma.$transaction(async (tx) => {
      const active = await tx.platformAdmin.findFirst({ where: { status: "active" } });
      if (active) throw new Error("An active platform_admin already exists; bootstrap refused.");
      const existing = await tx.platformAdmin.findUnique({ where: { email } });
      if (existing) throw new Error("Account already exists; use recover instead.");
      const admin = await tx.platformAdmin.create({
        data: { email, passwordHash: hash, status: "active" },
      });
      await audit(tx, admin.id, "platform.admin.bootstrap", "success", {
        identity_hash: fingerprint(email),
      });
    });
    console.log("platform_admin bootstrap completed.");
    return;
  }

  const admin = await prisma.platformAdmin.findUnique({ where: { email } });
  if (!admin) throw new Error("platform_admin was not found.");

  if (command === "disable") {
    await prisma.$transaction([
      prisma.platformAdmin.update({
        where: { id: admin.id },
        data: { status: "disabled", identityVersion: { increment: 1 } },
      }),
      prisma.platformSession.updateMany({
        where: { platformAdminId: admin.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      prisma.platformAuditLog.create({
        data: {
          platformAdminId: admin.id,
          action: "platform.admin.disable",
          resourceType: "platform_admin",
          resourceId: admin.id,
          result: "success",
          metadataJson: {},
        },
      }),
    ]);
    console.log("platform_admin disabled and all sessions revoked.");
    return;
  }

  const hash = await argon2.hash(password, { type: argon2.argon2id });
  if (command === "rotate") {
    if (admin.status !== "active") throw new Error("Disabled account requires recover.");
    await prisma.$transaction([
      prisma.platformAdmin.update({
        where: { id: admin.id },
        data: { passwordHash: hash, identityVersion: { increment: 1 } },
      }),
      prisma.platformSession.updateMany({
        where: { platformAdminId: admin.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      prisma.platformAuditLog.create({
        data: {
          platformAdminId: admin.id,
          action: "platform.admin.rotate",
          resourceType: "platform_admin",
          resourceId: admin.id,
          result: "success",
          metadataJson: {},
        },
      }),
    ]);
    console.log("platform_admin password rotated and all sessions revoked.");
    return;
  }

  const otherActive = await prisma.platformAdmin.findFirst({
    where: { status: "active", id: { not: admin.id } },
  });
  if (otherActive) throw new Error("Another active platform_admin exists; recovery refused.");
  await prisma.$transaction([
    prisma.platformAdmin.update({
      where: { id: admin.id },
      data: {
        status: "active",
        passwordHash: hash,
        identityVersion: { increment: 1 },
      },
    }),
    prisma.platformSession.updateMany({
      where: { platformAdminId: admin.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.platformAuditLog.create({
      data: {
        platformAdminId: admin.id,
        action: "platform.admin.recover",
        resourceType: "platform_admin",
        resourceId: admin.id,
        result: "success",
        metadataJson: {},
      },
    }),
  ]);
  console.log("platform_admin recovered and all prior sessions revoked.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "platform_admin command failed.");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
