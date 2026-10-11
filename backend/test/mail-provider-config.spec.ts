import { parseMailProviderConfig, selectMailProvider } from '../src/mail-jobs/mail-provider.config';

const validRealConfig: NodeJS.ProcessEnv = {
  APP_ENV: 'staging',
  MAIL_PROVIDER: 'oci_email_delivery_https',
  REAL_MAIL_SEND_ENABLED: 'true',
  OCI_EMAIL_REGION: 'ap-tokyo-1',
  OCI_EMAIL_SENDER_COMPARTMENT_ID: 'ocid1.compartment.oc1..synthetic',
  OCI_EMAIL_FROM_ADDRESS: 'sender@example.com',
  OCI_EMAIL_MESSAGE_ID_DOMAIN: 'mail.example.com',
};

describe('mail provider configuration', () => {
  it('defaults to mock and accepts only the explicit mock value', () => {
    expect(parseMailProviderConfig({})).toEqual({ kind: 'mock' });
    expect(parseMailProviderConfig({ MAIL_PROVIDER: 'mock' })).toEqual({ kind: 'mock' });
    expect(() => parseMailProviderConfig({ MAIL_PROVIDER: 'sandbox' })).toThrow('MAIL_PROVIDER_INVALID');
    expect(() => parseMailProviderConfig({ MAIL_PROVIDER: 'smtp' })).toThrow('MAIL_PROVIDER_INVALID');
  });

  it('accepts only a fully gated staging configuration', () => {
    const config = parseMailProviderConfig(validRealConfig);
    expect(config).toEqual({
      kind: 'oci_email_delivery_https',
      region: 'ap-tokyo-1',
      senderCompartmentId: 'ocid1.compartment.oc1..synthetic',
      fromAddress: 'sender@example.com',
      messageIdDomain: 'mail.example.com',
    });
  });

  it('selects mock without initializing OCI and selects OCI only through the gated factory', async () => {
    const mock = { send: jest.fn() };
    const real = { send: jest.fn() };
    const createOci = jest.fn().mockResolvedValue(real);
    await expect(selectMailProvider({ kind: 'mock' }, mock, createOci)).resolves.toBe(mock);
    expect(createOci).not.toHaveBeenCalled();
    const config = parseMailProviderConfig(validRealConfig);
    await expect(selectMailProvider(config, mock, createOci)).resolves.toBe(real);
    expect(createOci).toHaveBeenCalledWith(config);
  });

  it.each([
    [{ APP_ENV: 'local' }, 'REAL_MAIL_ENV_NOT_ALLOWED'],
    [{ APP_ENV: 'production' }, 'REAL_MAIL_ENV_NOT_ALLOWED'],
    [{ NODE_ENV: 'test' }, 'REAL_MAIL_ENV_NOT_ALLOWED'],
    [{ CI: 'true' }, 'REAL_MAIL_ENV_NOT_ALLOWED'],
    [{ CI: '1' }, 'REAL_MAIL_ENV_NOT_ALLOWED'],
    [{ REAL_MAIL_SEND_ENABLED: 'false' }, 'REAL_MAIL_SEND_DISABLED'],
    [{ REAL_MAIL_SEND_ENABLED: '' }, 'REAL_MAIL_SEND_DISABLED'],
    [{ OCI_EMAIL_REGION: '' }, 'OCI_EMAIL_REGION_INVALID'],
    [{ OCI_EMAIL_REGION: 'invalid' }, 'OCI_EMAIL_REGION_INVALID'],
    [{ OCI_EMAIL_SENDER_COMPARTMENT_ID: '' }, 'OCI_EMAIL_SENDER_COMPARTMENT_ID_INVALID'],
    [{ OCI_EMAIL_SENDER_COMPARTMENT_ID: 'invalid' }, 'OCI_EMAIL_SENDER_COMPARTMENT_ID_INVALID'],
    [{ OCI_EMAIL_FROM_ADDRESS: '' }, 'OCI_EMAIL_FROM_ADDRESS_INVALID'],
    [{ OCI_EMAIL_FROM_ADDRESS: 'invalid' }, 'OCI_EMAIL_FROM_ADDRESS_INVALID'],
    [{ OCI_EMAIL_FROM_ADDRESS: 'sender@example..com' }, 'OCI_EMAIL_FROM_ADDRESS_INVALID'],
    [{ OCI_EMAIL_MESSAGE_ID_DOMAIN: '' }, 'OCI_EMAIL_MESSAGE_ID_DOMAIN_INVALID'],
    [{ OCI_EMAIL_MESSAGE_ID_DOMAIN: 'invalid' }, 'OCI_EMAIL_MESSAGE_ID_DOMAIN_INVALID'],
  ])('rejects invalid real mail configuration with a safe code', (change, code) => {
    expect(() => parseMailProviderConfig({ ...validRealConfig, ...change })).toThrow(code);
  });
});
