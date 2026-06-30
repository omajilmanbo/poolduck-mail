import { Injectable } from '@nestjs/common';
import {
  MailProvider,
  MailProviderSendInput,
  MailProviderSendResult,
} from './mail-provider.types';

@Injectable()
export class SandboxMailProvider implements MailProvider {
  async send(input: MailProviderSendInput): Promise<MailProviderSendResult> {
    const configuredResult =
      process.env.MAIL_MOCK_SEND_RESULT?.toLowerCase() ?? 'success';

    if (configuredResult === 'failed' || configuredResult === 'failure') {
      return {
        provider: 'sandbox',
        success: false,
        errorMessage: 'Sandbox provider simulated failure',
      };
    }

    return {
      provider: 'sandbox',
      success: true,
      providerMessageId: `sandbox_${input.mailJobId}`,
    };
  }
}
