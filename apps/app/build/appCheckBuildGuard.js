const SAFE_DISABLED_VALUES = new Set(['', 'false', '0']);

/**
 * Rejects any production build that could enable or embed an App Check debug
 * token. Development builds may opt in explicitly with `true`.
 */
export function assertSafeAppCheckBuildEnvironment(mode, environment = {}) {
  if (mode !== 'production') return;

  const configuredValue = String(environment.VITE_APP_CHECK_DEBUG_TOKEN ?? '')
    .trim()
    .toLowerCase();
  if (!SAFE_DISABLED_VALUES.has(configuredValue)) {
    throw new Error(
      'Production builds must not set VITE_APP_CHECK_DEBUG_TOKEN. Remove it or set it to false.',
    );
  }
}
