import path from 'node:path';
import type { Plugin } from 'vite';

const LEGACY_NATIVE_RUNTIME_HELPER = `function isNativeRuntimeProtocol(protocol) {
    return protocol === 'capacitor:' || protocol === 'ionic:';
}`;

const CAPACITOR_NATIVE_RUNTIME_HELPER = `function isNativeRuntimeProtocol(protocol) {
    return protocol === 'capacitor:'
        || protocol === 'ionic:'
        || (protocol === 'https:' && globalThis.location?.hostname === 'localhost');
}`;

const LEGACY_BLOCKING_APP_CHECK = `export const appCheckReady = initializePrimaryAppCheck(app);
await appCheckReady;`;

const CAPACITOR_NON_BLOCKING_APP_CHECK = `export const appCheckReady = initializePrimaryAppCheck(app);
// App Check is fail-open during rollout. Native attestation must not suspend
// the entire Capacitor module graph while Play Integrity initializes.
void appCheckReady.catch((error) => {
    console.warn('[firebase] App Check initialization did not complete cleanly:', error);
});`;

export function transformNativeFirebaseRuntimeConfig(source: string): string {
  if (!source.includes(LEGACY_NATIVE_RUNTIME_HELPER)) {
    throw new Error('Legacy Firebase native-runtime helper changed; update the Capacitor transform intentionally.');
  }

  return source.replace(LEGACY_NATIVE_RUNTIME_HELPER, CAPACITOR_NATIVE_RUNTIME_HELPER);
}

export function transformNativeFirebaseBootstrap(source: string): string {
  if (!source.includes(LEGACY_BLOCKING_APP_CHECK)) {
    throw new Error('Legacy Firebase App Check bootstrap changed; update the Capacitor transform intentionally.');
  }

  return source.replace(LEGACY_BLOCKING_APP_CHECK, CAPACITOR_NON_BLOCKING_APP_CHECK);
}

export function createNativeFirebaseRuntimeTransform(repoRoot: string): Plugin {
  const runtimeConfigPath = path.resolve(repoRoot, 'js/firebase-runtime-config.js');
  const firebaseBootstrapPath = path.resolve(repoRoot, 'js/firebase.js');

  return {
    name: 'allplays-capacitor-firebase-runtime',
    enforce: 'pre',
    transform(source, moduleId) {
      const sourcePath = path.resolve(moduleId.split('?', 1)[0]);
      if (sourcePath === firebaseBootstrapPath) {
        return {
          code: transformNativeFirebaseBootstrap(source),
          map: null
        };
      }
      if (sourcePath !== runtimeConfigPath) return null;

      return {
        code: transformNativeFirebaseRuntimeConfig(source),
        map: null
      };
    }
  };
}
