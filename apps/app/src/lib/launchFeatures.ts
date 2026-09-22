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
    const runtimeConfig = readRuntimeConfig();
    if (runtimeConfig && Object.prototype.hasOwnProperty.call(runtimeConfig, feature)) {
      return runtimeConfig[feature] === true;
    }
    if (feature === 'diamondScorebookUiEnabled') {
      return import.meta.env.VITE_DIAMOND_SCOREBOOK_UI_ENABLED === 'true';
    }
    return false;
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
