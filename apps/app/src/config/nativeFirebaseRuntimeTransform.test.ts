import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isNativeFirebaseTransformEnabled,
  transformNativeFirebaseBootstrap,
  transformNativeFirebaseRuntimeConfig
} from '../../build/nativeFirebaseRuntimeTransform';

describe('Capacitor Firebase runtime transform', () => {
  it('is enabled only for an explicitly requested Capacitor artifact', () => {
    expect(isNativeFirebaseTransformEnabled({})).toBe(false);
    expect(isNativeFirebaseTransformEnabled({ ALLPLAYS_CAPACITOR_BUILD: '0' })).toBe(false);
    expect(isNativeFirebaseTransformEnabled({ ALLPLAYS_CAPACITOR_BUILD: 'true' })).toBe(false);
    expect(isNativeFirebaseTransformEnabled({ ALLPLAYS_CAPACITOR_BUILD: '1' })).toBe(true);
  });

  it('teaches the actual legacy bootstrap that Android https localhost is native', () => {
    const repoRoot = path.resolve(process.cwd(), process.cwd().endsWith('apps/app') ? '../..' : '.');
    const source = readFileSync(path.join(repoRoot, 'js/firebase-runtime-config.js'), 'utf8');

    const transformed = transformNativeFirebaseRuntimeConfig(source);

    expect(transformed).toContain(
      "protocol === 'https:' && globalThis.location?.hostname === 'localhost'"
    );
    expect(transformed).not.toContain(
      "return protocol === 'capacitor:' || protocol === 'ionic:';"
    );
  });

  it('fails closed when the legacy bootstrap no longer matches the reviewed source', () => {
    expect(() => transformNativeFirebaseRuntimeConfig('export const changed = true;')).toThrow(
      'Legacy Firebase native-runtime helper changed'
    );
  });

  it('keeps fail-open native App Check from suspending the actual legacy bootstrap', () => {
    const repoRoot = path.resolve(process.cwd(), process.cwd().endsWith('apps/app') ? '../..' : '.');
    const source = readFileSync(path.join(repoRoot, 'js/firebase.js'), 'utf8');

    const transformed = transformNativeFirebaseBootstrap(source);

    expect(transformed).toContain('void appCheckReady.catch');
    expect(transformed).not.toContain('await appCheckReady;');
  });

  it('fails closed when the legacy App Check bootstrap no longer matches the reviewed source', () => {
    expect(() => transformNativeFirebaseBootstrap('export const changed = true;')).toThrow(
      'Legacy Firebase App Check bootstrap changed'
    );
  });
});
