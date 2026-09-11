import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import argon2 from "argon2";
import { config } from "dotenv";
import { readFileSync } from "node:fs";

config({ path: "../.env", quiet: true });
config({ path: ".env", quiet: true });
config({ path: ".env.local", override: true, quiet: true });

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://poolduck_local:poolduck_local_password@localhost:5432/poolduck_mail";
const APP_ENV = process.env.APP_ENV ?? "local";
const password = readPassword();
const operatorCount = boundedInteger("CAPACITY_OPERATOR_COUNT", 50, 1, 100);
const personCount = boundedInteger("CAPACITY_PERSON_COUNT", 4_096, 100, 99_999);

if (password.length < 16) {
  throw new Error("CAPACITY_TEST_PASSWORD must contain at least 16 characters.");
}

function readPassword() {
  if (process.env.CAPACITY_TEST_PASSWORD) return process.env.CAPACITY_TEST_PASSWORD;
  if (process.env.CAPACITY_TEST_PASSWORD_FILE) {
    return readFileSync(process.env.CAPACITY_TEST_PASSWORD_FILE, "utf8").trimEnd();
  }
  return "";
}
if (!new Set(["local", "test", "staging"]).has(APP_ENV)) {
  throw new Error(`Capacity seed refuses APP_ENV=${APP_ENV}.`);
}

const adapter = new PrismaPg({ connectionString: DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const profiles = [
  {
    status: "active",
    tenantCode: "5A6E116001",
    tenantName: "Poolduck Capacity Active Tenant",
    locationCode: "5A6E1161",
    locationName: "Capacity Active Location",
    operatorPrefix: "capacity-a-op-",
    personPrefix: "01K0CAA",
    operators: operatorCount,
    people: personCount,
  },
  {
    status: "suspended",
    tenantCode: "5A6E116002",
    tenantName: "Poolduck Capacity Suspended Tenant",
    locationCode: "5A6E1162",
    locationName: "Capacity Suspended Location",
    operatorPrefix: "capacity-s-op-",
    personPrefix: "01K0CAS",
    operators: 1,
    people: 100,
  },
];

function boundedInteger(name, fallback, minimum, maximum) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function suffix(index) {
  return String(index + 1).padStart(5, "0");
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function seedProfile(profile, passwordHash) {
  const tenant = await prisma.tenant.upsert({
    where: { tenantCode: profile.tenantCode },
    update: {
      name: profile.tenantName,
      status: "active",
      locationLimit: 1,
    },
    create: {
      tenantCode: profile.tenantCode,
      name: profile.tenantName,
      status: "active",
      locationLimit: 1,
    },
  });
  const now = new Date();
  const endAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1_000);
  await prisma.subscription.upsert({
    where: { tenantId: tenant.id },
    update: {
      plan: "capacity-test",
      status: profile.status,
      startAt: now,
      endAt,
    },
    create: {
      tenantId: tenant.id,
      plan: "capacity-test",
      status: profile.status,
      startAt: now,
      endAt,
    },
  });
  const location = await prisma.location.upsert({
    where: {
      tenantId_locationCode: {
        tenantId: tenant.id,
        locationCode: profile.locationCode,
      },
    },
    update: {
      name: profile.locationName,
      status: "active",
      deletedAt: null,
      purgeAfter: null,
      deletedFromStatus: null,
    },
    create: {
      tenantId: tenant.id,
      locationCode: profile.locationCode,
      name: profile.locationName,
      type: "location",
      status: "active",
    },
  });

  const operators = Array.from({ length: profile.operators }, (_, index) => ({
    tenantId: tenant.id,
    username: `${profile.operatorPrefix}${suffix(index)}`,
    email: `${profile.operatorPrefix}${suffix(index)}@example.local`,
    passwordHash,
    role: "operator",
    status: "active",
  }));
  for (const batch of chunks(operators, 500)) {
    await prisma.user.createMany({ data: batch, skipDuplicates: true });
  }
  await prisma.user.updateMany({
    where: { tenantId: tenant.id, username: { startsWith: profile.operatorPrefix } },
    data: { passwordHash, role: "operator", status: "active" },
  });
  const operatorRows = await prisma.user.findMany({
    where: { tenantId: tenant.id, username: { startsWith: profile.operatorPrefix } },
    select: { id: true },
  });
  await prisma.operatorLocationAssignment.createMany({
    data: operatorRows.map((operator) => ({
      tenantId: tenant.id,
      operatorId: operator.id,
      locationId: location.id,
    })),
    skipDuplicates: true,
  });

  const people = Array.from({ length: profile.people }, (_, index) => {
    const personCode = `${profile.personPrefix}${suffix(index)}`;
    return {
      tenantId: tenant.id,
      locationId: location.id,
      personCode,
      scanCode: personCode,
      personName: `Capacity Person ${suffix(index)}`,
      email: `capacity-person-${profile.status}-${suffix(index)}@example.local`,
      status: "active",
    };
  });
  for (const batch of chunks(people, 500)) {
    await prisma.personMapping.createMany({ data: batch, skipDuplicates: true });
  }
  await prisma.personMapping.updateMany({
    where: { tenantId: tenant.id, personCode: { startsWith: profile.personPrefix } },
    data: {
      locationId: location.id,
      status: "active",
      deletedAt: null,
      purgeAfter: null,
      deletedFromStatus: null,
    },
  });

  return {
    subscription_status: profile.status,
    tenant_code: profile.tenantCode,
    location_code: profile.locationCode,
    operator_count: operatorRows.length,
    person_count: profile.people,
  };
}

async function main() {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const seeded = [];
  for (const profile of profiles) {
    seeded.push(await seedProfile(profile, passwordHash));
  }
  console.log(JSON.stringify({ event: "capacity_seed.ready", app_env: APP_ENV, profiles: seeded }));
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
