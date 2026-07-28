export function deletionDaysRemaining(
  purgeAfter?: string | null,
  now = Date.now(),
) {
  if (!purgeAfter) return 0;
  return Math.max(
    0,
    Math.ceil((new Date(purgeAfter).getTime() - now) / 86_400_000),
  );
}
