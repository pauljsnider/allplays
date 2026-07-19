import { isNativeRuntime } from './nativeRuntime';
import { getNativeSecureItem, setNativeSecureItem } from './nativeSecureStorage';

/**
 * Phase one of the iOS reinstall migration. The secure marker survives an iOS
 * uninstall while the WebView marker does not. This release only establishes
 * both markers and observes/repairs mismatches; it never interprets a missing
 * marker as permission to remove an existing auth session.
 */
export const nativeInstallEpochPhase = 'seed-observe-v1' as const;

const secureInstallEpochKey = 'native-install-epoch-v1';
const webInstallEpochKey = 'allplays-native-install-epoch-v1';

export type NativeInstallEpochSeedStatus =
  | 'not-native'
  | 'seeded'
  | 'already-seeded'
  | 'observed-missing-web-marker'
  | 'observed-mismatched-web-marker'
  | 'secure-marker-unrecognized'
  | 'secure-storage-unavailable'
  | 'web-storage-unavailable';

export type NativeInstallEpochSeedResult = {
  phase: typeof nativeInstallEpochPhase;
  status: NativeInstallEpochSeedStatus;
};

type WebMarkerRead = { available: true; value: string | null } | { available: false; value: null };

function readWebInstallEpoch(): WebMarkerRead {
  if (typeof window === 'undefined') return { available: false, value: null };
  try {
    return {
      available: true,
      value: window.localStorage?.getItem(webInstallEpochKey) || null
    };
  } catch {
    return { available: false, value: null };
  }
}

function writeWebInstallEpoch(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage?.setItem(webInstallEpochKey, nativeInstallEpochPhase);
    return window.localStorage?.getItem(webInstallEpochKey) === nativeInstallEpochPhase;
  } catch {
    return false;
  }
}

function result(status: NativeInstallEpochSeedStatus): NativeInstallEpochSeedResult {
  return { phase: nativeInstallEpochPhase, status };
}

/**
 * Establish the two durable boundaries needed by a later enforcement release.
 *
 * Passivity is deliberate:
 * - Unknown legacy upgrades and fresh installs both seed without signing out.
 * - A secure marker with a missing/mismatched WebView marker is observed and
 *   realigned without touching Firebase Auth or fallback session keys.
 * - Unknown secure marker versions are preserved for forward compatibility.
 * - Storage failures never become evidence of reinstall.
 *
 * A later release may enforce reinstall cleanup only after this phase has had
 * an adoption window, and only when secure storage contains this known marker
 * while readable WebView storage is missing its matching marker.
 */
export async function seedNativeInstallEpochObserveOnly(): Promise<NativeInstallEpochSeedResult> {
  if (!isNativeRuntime()) return result('not-native');

  const webMarker = readWebInstallEpoch();
  let secureMarker: string | null;
  try {
    secureMarker = await getNativeSecureItem(secureInstallEpochKey);
  } catch {
    return result('secure-storage-unavailable');
  }

  if (secureMarker !== null && secureMarker !== nativeInstallEpochPhase) {
    // Never overwrite a marker written by an unknown/newer migration phase.
    return result('secure-marker-unrecognized');
  }

  const hadSecureMarker = secureMarker === nativeInstallEpochPhase;
  if (!hadSecureMarker) {
    try {
      await setNativeSecureItem(secureInstallEpochKey, nativeInstallEpochPhase);
    } catch {
      // The keyed secure-storage queue may still complete a timed-out write.
      // Leave the WebView marker unchanged so the next launch can reconcile.
      return result('secure-storage-unavailable');
    }
  }

  if (!webMarker.available || !writeWebInstallEpoch()) {
    return result('web-storage-unavailable');
  }

  if (!hadSecureMarker) return result('seeded');
  if (webMarker.value === nativeInstallEpochPhase) return result('already-seeded');
  return result(webMarker.value === null ? 'observed-missing-web-marker' : 'observed-mismatched-web-marker');
}
