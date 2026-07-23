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
