import { randomBytes } from 'node:crypto';

export const TENANT_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const TENANT_CODE_PATTERN = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$/;
export const TENANT_CODE_MAX_ATTEMPTS = 5;

export class TenantCodeGenerationExhaustedError extends Error {
  constructor() {
    super('TENANT_CODE_GENERATION_EXHAUSTED');
    this.name = 'TenantCodeGenerationExhaustedError';
  }
}

export function normalizeTenantCode(value: string): string {
  return value.trim().toUpperCase();
}

export function generateTenantCode(
  source: (size: number) => Buffer = randomBytes,
): string {
  const bytes = source(10);
  if (bytes.length !== 10) {
    throw new Error('Tenant code random source must return 10 bytes.');
  }

  return Array.from(
    bytes,
    (value) => TENANT_CODE_ALPHABET[value % TENANT_CODE_ALPHABET.length],
  ).join('');
}

export async function generateUniqueTenantCode(
  isTaken: (candidate: string) => Promise<boolean>,
  source: (size: number) => Buffer = randomBytes,
): Promise<string> {
  for (let attempt = 0; attempt < TENANT_CODE_MAX_ATTEMPTS; attempt += 1) {
    const candidate = generateTenantCode(source);
    if (!(await isTaken(candidate))) {
      return candidate;
    }
  }

  throw new TenantCodeGenerationExhaustedError();
}
