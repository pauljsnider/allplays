import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyRegistrationPaymentLaunchState,
  arePaymentsEnabled,
  isDiamondScorebookUiEnabled
} from './launchFeatures';

describe('launchFeatures', () => {
  beforeEach(() => {
    delete window.__ALLPLAYS_CONFIG__;
  });

  afterEach(() => {
    delete window.__ALLPLAYS_CONFIG__;
    vi.unstubAllEnvs();
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

  it('keeps Diamond setup and activation UI off unless the runtime boolean is exactly true', () => {
    expect(isDiamondScorebookUiEnabled()).toBe(false);

    window.__ALLPLAYS_CONFIG__ = { diamondScorebookUiEnabled: false } as any;
    expect(isDiamondScorebookUiEnabled()).toBe(false);

    window.__ALLPLAYS_CONFIG__ = { diamondScorebookUiEnabled: 'true' } as any;
    expect(isDiamondScorebookUiEnabled()).toBe(false);

    Object.defineProperty(window, '__ALLPLAYS_CONFIG__', {
      configurable: true,
      get() {
        throw new Error('runtime config unavailable');
      }
    });
    expect(isDiamondScorebookUiEnabled()).toBe(false);

    delete window.__ALLPLAYS_CONFIG__;
    window.__ALLPLAYS_CONFIG__ = { diamondScorebookUiEnabled: true } as any;
    expect(isDiamondScorebookUiEnabled()).toBe(true);
  });

  it('uses an exact build-time true for hosted React and Capacitor artifacts', () => {
    expect(isDiamondScorebookUiEnabled()).toBe(false);

    vi.stubEnv('VITE_DIAMOND_SCOREBOOK_UI_ENABLED', 'TRUE');
    expect(isDiamondScorebookUiEnabled()).toBe(false);

    vi.stubEnv('VITE_DIAMOND_SCOREBOOK_UI_ENABLED', '1');
    expect(isDiamondScorebookUiEnabled()).toBe(false);

    vi.stubEnv('VITE_DIAMOND_SCOREBOOK_UI_ENABLED', 'true');
    expect(isDiamondScorebookUiEnabled()).toBe(true);

    window.__ALLPLAYS_CONFIG__ = { diamondScorebookUiEnabled: false } as any;
    expect(isDiamondScorebookUiEnabled()).toBe(false);
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
