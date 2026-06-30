export type SubscriptionStatus = 'trial' | 'active' | 'expired' | 'suspended';

export type LicenseCheckResponse = {
  status: string;
  plan: string;
  end_at: string;
  expired_at: string;
  grace_period: null;
  can_send: boolean;
};
