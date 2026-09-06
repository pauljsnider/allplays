function readRuntimeConfig(): Record<string, unknown> | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    const runtimeConfig = (
      window as typeof window & {
        __ALLPLAYS_CONFIG__?: Record<string, unknown>;
      }
    ).__ALLPLAYS_CONFIG__;
    return runtimeConfig && typeof runtimeConfig === 'object' ? runtimeConfig : undefined;
  } catch {
    return undefined;
  }
}

function isRuntimeFeatureEnabled(feature: string): boolean {
  try {
    return readRuntimeConfig()?.[feature] === true;
  } catch {
    return false;
  }
}

export function arePaymentsEnabled(): boolean {
  return isRuntimeFeatureEnabled('paymentsEnabled');
}

export function isDiamondScorebookUiEnabled(): boolean {
  return isRuntimeFeatureEnabled('diamondScorebookUiEnabled');
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
