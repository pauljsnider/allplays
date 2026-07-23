export function arePaymentsEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const runtimeConfig = (
    window as typeof window & {
      __ALLPLAYS_CONFIG__?: Record<string, unknown>;
    }
  ).__ALLPLAYS_CONFIG__;

  return runtimeConfig?.paymentsEnabled === true;
}

export function applyRegistrationPaymentLaunchState<T extends Record<string, any>>(
  form: T,
  paymentsEnabled = arePaymentsEnabled()
): T & { onlinePaymentUnavailable?: boolean } {
  if (paymentsEnabled || form.onlineCheckout !== true) {
    return { ...form, onlinePaymentUnavailable: false };
  }

  const offlinePaymentEnabled = form.paymentSettings?.offlinePaymentEnabled === true;
  return {
    ...form,
    onlineCheckout: false,
    onlinePaymentUnavailable: !offlinePaymentEnabled
  };
}
