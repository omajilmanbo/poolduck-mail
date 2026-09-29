import { MailProvider } from './mail-provider.types';

export const MAIL_PROVIDER_TOKEN = Symbol('MAIL_PROVIDER');
export const MAIL_PROVIDER_CONFIG_TOKEN = Symbol('MAIL_PROVIDER_CONFIG');

export type MailProviderConfig =
  | { kind: 'mock' }
  | {
      kind: 'oci_email_delivery_https';
      region: string;
      fromAddress: string;
      messageIdDomain: string;
      recipientAllowlist: ReadonlySet<string>;
    };

const domainPattern = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const regionPattern = /^[a-z][a-z0-9-]*-[1-9][0-9]*$/;

function isValidEmail(value: string): boolean {
  const parts = value.split('@');
  return parts.length === 2
    && /^[^\s@,;]+$/.test(parts[0])
    && domainPattern.test(parts[1]);
}

function invalid(code: string): never {
  throw new Error(code);
}

export function parseMailProviderConfig(env: NodeJS.ProcessEnv): MailProviderConfig {
  const provider = env.MAIL_PROVIDER ?? 'mock';
  if (provider === 'mock') return { kind: 'mock' };
  if (provider !== 'oci_email_delivery_https') invalid('MAIL_PROVIDER_INVALID');

  if (env.APP_ENV !== 'staging' || env.NODE_ENV === 'test' || (env.CI && env.CI !== 'false')) {
    invalid('REAL_MAIL_ENV_NOT_ALLOWED');
  }
  if (env.REAL_MAIL_SEND_ENABLED !== 'true') invalid('REAL_MAIL_SEND_DISABLED');

  const region = env.OCI_EMAIL_REGION ?? '';
  const fromAddress = env.OCI_EMAIL_FROM_ADDRESS ?? '';
  const messageIdDomain = env.OCI_EMAIL_MESSAGE_ID_DOMAIN ?? '';
  if (!regionPattern.test(region)) invalid('OCI_EMAIL_REGION_INVALID');
  if (!isValidEmail(fromAddress)) invalid('OCI_EMAIL_FROM_ADDRESS_INVALID');
  if (!domainPattern.test(messageIdDomain)) invalid('OCI_EMAIL_MESSAGE_ID_DOMAIN_INVALID');

  const rawAllowlist = env.STAGING_REAL_MAIL_RECIPIENT_ALLOWLIST ?? '';
  const addresses = rawAllowlist.split(',').map((address) => address.trim());
  if (addresses.length === 0 || addresses.some((address) => !isValidEmail(address))) {
    invalid('STAGING_REAL_MAIL_RECIPIENT_ALLOWLIST_INVALID');
  }

  return {
    kind: 'oci_email_delivery_https',
    region,
    fromAddress,
    messageIdDomain,
    recipientAllowlist: new Set(addresses),
  };
}

export function isRecipientAllowed(config: MailProviderConfig, toEmail: string): boolean {
  return config.kind === 'mock' || config.recipientAllowlist.has(toEmail);
}
export function selectMailProvider(config: MailProviderConfig, mock: MailProvider): MailProvider {
  if (config.kind === 'mock') return mock;
  // #137 must bind the OCI adapter. A complete config is not permission to send yet.
  throw new Error('OCI_EMAIL_PROVIDER_NOT_IMPLEMENTED');
}
