import { isEmail } from 'class-validator';

export const USERNAME_PATTERN =
  /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/;

export const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'root',
  'system',
  'support',
  'tenant_manager',
  'operator',
  'platform_admin',
  'poolduck',
]);

export type LoginIdentity =
  | { kind: 'email'; value: string }
  | { kind: 'username'; value: string };

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function isAllowedUsername(value: string): boolean {
  const normalized = normalizeUsername(value);
  return (
    USERNAME_PATTERN.test(normalized) &&
    !RESERVED_USERNAMES.has(normalized)
  );
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isAllowedEmail(value: string): boolean {
  const normalized = normalizeEmail(value);
  return (
    normalized.length >= 3 &&
    normalized.length <= 254 &&
    /^[\x21-\x7e]+$/.test(normalized) &&
    isEmail(normalized, { allow_utf8_local_part: false })
  );
}

export function parseLoginIdentity(value: string): LoginIdentity | null {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes('@')) {
    return isAllowedEmail(normalized)
      ? { kind: 'email', value: normalized }
      : null;
  }
  return isAllowedUsername(normalized)
    ? { kind: 'username', value: normalized }
    : null;
}
