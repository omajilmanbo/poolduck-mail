const dayMs = 24 * 60 * 60 * 1000;

export async function seedSyntheticSubscription(prisma, { tenantId, plan, status, startAt, endAt }, now) {
  const data = { plan, status, startAt };
  if (status !== "active" && status !== "trial") {
    const fixed = { ...data, endAt };
    await prisma.subscription.upsert({
      where: { tenantId },
      update: fixed,
      create: { tenantId, ...fixed },
    });
    return;
  }

  const renewedEndAt = new Date(now + 365 * dayMs);
  // Keep an existing healthy window stable on reruns, including across New Year.
  // Restore the status and renew a short window atomically for this fixture.
  await prisma.$transaction([
    prisma.subscription.upsert({
      where: { tenantId },
      update: data,
      create: { tenantId, ...data, endAt: renewedEndAt },
    }),
    prisma.subscription.updateMany({
      where: { tenantId, endAt: { lte: new Date(now + 30 * dayMs) } },
      data: { endAt: renewedEndAt },
    }),
  ]);
}
