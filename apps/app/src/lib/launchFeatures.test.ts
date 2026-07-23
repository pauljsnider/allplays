import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { arePaymentsEnabled } from './launchFeatures';

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
});
