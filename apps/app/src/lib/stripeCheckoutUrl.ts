export function getTrustedStripeCheckoutUrl(value: unknown): string {
  const checkoutUrl = typeof value === 'string' ? value : '';
  if (!checkoutUrl || checkoutUrl !== checkoutUrl.trim()) return '';

  try {
    const destination = new URL(checkoutUrl);
    if (
      destination.protocol === 'https:'
      && destination.hostname === 'checkout.stripe.com'
      && !destination.username
      && !destination.password
      && !destination.port
      && destination.pathname
      && destination.pathname !== '/'
    ) {
      return checkoutUrl;
    }
  } catch {
    // Invalid destinations use the same fail-closed result.
  }

  return '';
}

export function requireTrustedStripeCheckoutUrl(value: unknown): string {
  const checkoutUrl = getTrustedStripeCheckoutUrl(value);
  if (!checkoutUrl) {
    throw new Error('Stripe returned an invalid checkout destination. Please try again.');
  }
  return checkoutUrl;
}
