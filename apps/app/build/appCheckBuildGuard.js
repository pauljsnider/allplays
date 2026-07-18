import process from 'node:process';

const SAFE_DISABLED_VALUES = new Set(['', 'false', '0']);
export const NATIVE_APP_CHECK_DEBUG_MODE = 'native-debug';

function normalizeBuildValue(value) {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * Rejects any production build that could enable or embed an App Check debug
 * provider. Browser development may opt in with the Vite debug-token flag.
 * Token-free native debug builds require both the dedicated Vite mode and the
 * non-client opt-in set by the local Capacitor debug scripts.
 */
export function assertSafeAppCheckBuildEnvironment(
  mode,
  environment = {},
  buildEnvironment = process.env,
) {
  const configuredDebugToken = normalizeBuildValue(
    environment.VITE_APP_CHECK_DEBUG_TOKEN,
  );
  const nativeDebugOptIn = normalizeBuildValue(
    buildEnvironment.ALLPLAYS_APP_CHECK_NATIVE_DEBUG,
  );
  const hasDebugToken = !SAFE_DISABLED_VALUES.has(configuredDebugToken);
  const hasNativeDebugOptIn = !SAFE_DISABLED_VALUES.has(nativeDebugOptIn);

  if (mode === NATIVE_APP_CHECK_DEBUG_MODE) {
    if (nativeDebugOptIn !== '1') {
      throw new Error(
        'Native App Check debug builds require the dedicated local build script.',
      );
    }
    if (hasDebugToken) {
      throw new Error(
        'Native App Check debug builds must not set VITE_APP_CHECK_DEBUG_TOKEN; the native SDK generates the registration token.',
      );
    }
    return;
  }

  if (hasNativeDebugOptIn) {
    throw new Error(
      'ALLPLAYS_APP_CHECK_NATIVE_DEBUG is only allowed in the native-debug build mode.',
    );
  }

  if (mode === 'production' && hasDebugToken) {
    throw new Error(
      'Production builds must not set VITE_APP_CHECK_DEBUG_TOKEN. Remove it or set it to false.',
    );
  }
}
