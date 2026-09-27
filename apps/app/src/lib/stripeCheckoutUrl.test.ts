import { describe, expect, it } from 'vitest';
import { getTrustedStripeCheckoutUrl, requireTrustedStripeCheckoutUrl } from './stripeCheckoutUrl';

describe('Stripe checkout destination validation', () => {
  it('accepts only canonical Stripe Checkout HTTPS destinations', () => {
    const checkoutUrl = 'https://checkout.stripe.com/c/pay/session-1?source=app#payment';
    expect(getTrustedStripeCheckoutUrl(checkoutUrl)).toBe(checkoutUrl);
  });

  it.each([
    '',
    ' https://checkout.stripe.com/c/pay/space',
    'http://checkout.stripe.com/c/pay/insecure',
    'https://checkout.stripe.com.attacker.example/c/pay/lookalike',
    'https://user:password@checkout.stripe.com/c/pay/credentialed',
    'https://checkout.stripe.com:8443/c/pay/port',
    'https://checkout.stripe.com/'
  ])('rejects %j', (checkoutUrl) => {
    expect(getTrustedStripeCheckoutUrl(checkoutUrl)).toBe('');
    expect(() => requireTrustedStripeCheckoutUrl(checkoutUrl)).toThrow('invalid checkout destination');
  });
});
