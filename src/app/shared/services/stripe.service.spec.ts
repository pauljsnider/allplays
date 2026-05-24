import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCallable = vi.fn();
const mockHttpsCallable = vi.fn(() => mockCallable);
const mockFunctions = {};

vi.mock('@angular/core', () => ({
  Injectable: () => () => undefined
}));

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => mockFunctions),
  httpsCallable: mockHttpsCallable
}));

vi.mock('../../firebase-config', () => ({
  app: {}
}));

const { StripeService } = await import('./stripe.service');
const { getFunctions, httpsCallable } = await import('firebase/functions');

describe('StripeService team fee checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls createStripeTeamFeeCheckout with teamId, batchId, and recipientId', async () => {
    mockCallable.mockResolvedValueOnce({
      data: { checkoutUrl: 'https://checkout.stripe.com/team-fee-session' }
    });

    const service = new StripeService();
    const checkoutUrl = await service.initiateTeamFeeCheckout('team-123', 'batch-456', 'recipient-789');

    expect(checkoutUrl).toBe('https://checkout.stripe.com/team-fee-session');
    expect(getFunctions).toHaveBeenCalledWith({});
    expect(httpsCallable).toHaveBeenCalledWith(mockFunctions, 'createStripeTeamFeeCheckout');
    expect(mockCallable).toHaveBeenCalledWith({
      teamId: 'team-123',
      batchId: 'batch-456',
      recipientId: 'recipient-789'
    });
  });

  it('surfaces an error when checkoutUrl is missing without changing location', async () => {
    const originalLocation = globalThis.location;
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { href: 'https://allplays.test/team-fees' }
    });
    mockCallable.mockResolvedValueOnce({ data: {} });

    const service = new StripeService();

    await expect(service.initiateTeamFeeCheckout('team-123', 'batch-456', 'recipient-789'))
      .rejects.toThrow('Stripe checkout URL not returned from function.');
    expect(globalThis.location.href).toBe('https://allplays.test/team-fees');

    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: originalLocation
    });
  });
});
