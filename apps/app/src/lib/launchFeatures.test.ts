import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyRegistrationPaymentLaunchState, arePaymentsEnabled } from './launchFeatures';

describe('launchFeatures', () => {
  beforeEach(() => {
    delete window.__ALLPLAYS_CONFIG__;
  });

  afterEach(() => {
    delete window.__ALLPLAYS_CONFIG__;
  });

  it('keeps payments off for the initial store launch', () => {
    expect(arePaymentsEnabled()).toBe(false);
    window.__ALLPLAYS_CONFIG__ = { paymentsEnabled: false };
    expect(arePaymentsEnabled()).toBe(false);
  });

  it('requires explicit runtime enablement', () => {
    window.__ALLPLAYS_CONFIG__ = { paymentsEnabled: true };
    expect(arePaymentsEnabled()).toBe(true);
  });

  it('blocks online-only registration while preserving an explicit offline path', () => {
    expect(applyRegistrationPaymentLaunchState({
      onlineCheckout: true,
      paymentSettings: { offlinePaymentEnabled: false, onlineCheckoutEnabled: true }
    })).toMatchObject({
      onlineCheckout: false,
      onlinePaymentUnavailable: true
    });

    expect(applyRegistrationPaymentLaunchState({
      onlineCheckout: true,
      paymentSettings: { offlinePaymentEnabled: true, onlineCheckoutEnabled: true }
    })).toMatchObject({
      onlineCheckout: false,
      onlinePaymentUnavailable: false
    });
  });
});
