const attemptIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createAttemptMessageId(attemptId: string, domain: string): string {
  if (!attemptIdPattern.test(attemptId)) throw new Error('MAIL_ATTEMPT_ID_INVALID');
  return `<${attemptId.toLowerCase()}@${domain}>`;
}
