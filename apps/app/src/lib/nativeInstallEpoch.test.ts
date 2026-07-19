// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeState = vi.hoisted(() => ({ native: true }));
const secureStorageMocks = vi.hoisted(() => ({
  getNativeSecureItem: vi.fn(),
  setNativeSecureItem: vi.fn()
}));

vi.mock('./nativeRuntime', () => ({ isNativeRuntime: () => runtimeState.native }));
vi.mock('./nativeSecureStorage', () => secureStorageMocks);

import { nativeInstallEpochPhase, seedNativeInstallEpochObserveOnly } from './nativeInstallEpoch';

const webInstallEpochKey = 'allplays-native-install-epoch-v1';
const secureInstallEpochKey = 'native-install-epoch-v1';

describe('native install epoch seed/observe phase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeState.native = true;
    installLocalStorage();
    window.localStorage.clear();
    secureStorageMocks.getNativeSecureItem.mockResolvedValue(null);
    secureStorageMocks.setNativeSecureItem.mockResolvedValue(undefined);
  });

  it('does nothing in the web app', async () => {
    runtimeState.native = false;

    await expect(seedNativeInstallEpochObserveOnly()).resolves.toEqual({
      phase: nativeInstallEpochPhase,
      status: 'not-native'
    });
    expect(secureStorageMocks.getNativeSecureItem).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(webInstallEpochKey)).toBeNull();
  });

  it('seeds unknown legacy upgrades and fresh installs without removing auth state', async () => {
    await expect(seedNativeInstallEpochObserveOnly()).resolves.toEqual({
      phase: nativeInstallEpochPhase,
      status: 'seeded'
    });

    expect(secureStorageMocks.getNativeSecureItem).toHaveBeenCalledWith(secureInstallEpochKey);
    expect(secureStorageMocks.setNativeSecureItem).toHaveBeenCalledWith(secureInstallEpochKey, nativeInstallEpochPhase);
    expect(window.localStorage.getItem(webInstallEpochKey)).toBe(nativeInstallEpochPhase);
    expect(secureStorageMocks).not.toHaveProperty('removeNativeSecureItem');
  });

  it('preserves a possible iOS reinstall session while observing a missing WebView marker', async () => {
    secureStorageMocks.getNativeSecureItem.mockResolvedValue(nativeInstallEpochPhase);

    await expect(seedNativeInstallEpochObserveOnly()).resolves.toEqual({
      phase: nativeInstallEpochPhase,
      status: 'observed-missing-web-marker'
    });

    expect(secureStorageMocks.setNativeSecureItem).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(webInstallEpochKey)).toBe(nativeInstallEpochPhase);
  });

  it('realigns a mismatched WebView marker without changing secure or auth records', async () => {
    secureStorageMocks.getNativeSecureItem.mockResolvedValue(nativeInstallEpochPhase);
    window.localStorage.setItem(webInstallEpochKey, 'unknown-older-phase');

    await expect(seedNativeInstallEpochObserveOnly()).resolves.toEqual({
      phase: nativeInstallEpochPhase,
      status: 'observed-mismatched-web-marker'
    });

    expect(secureStorageMocks.setNativeSecureItem).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(webInstallEpochKey)).toBe(nativeInstallEpochPhase);
  });

  it('repairs a missing secure seed from the WebView marker without touching sessions', async () => {
    window.localStorage.setItem(webInstallEpochKey, nativeInstallEpochPhase);

    await expect(seedNativeInstallEpochObserveOnly()).resolves.toEqual({
      phase: nativeInstallEpochPhase,
      status: 'seeded'
    });
    expect(secureStorageMocks.setNativeSecureItem).toHaveBeenCalledWith(secureInstallEpochKey, nativeInstallEpochPhase);
    expect(window.localStorage.getItem(webInstallEpochKey)).toBe(nativeInstallEpochPhase);
  });

  it('does not overwrite an unrecognized secure migration marker', async () => {
    secureStorageMocks.getNativeSecureItem.mockResolvedValue('future-phase-v2');
    window.localStorage.setItem(webInstallEpochKey, 'legacy-local-value');

    await expect(seedNativeInstallEpochObserveOnly()).resolves.toEqual({
      phase: nativeInstallEpochPhase,
      status: 'secure-marker-unrecognized'
    });

    expect(secureStorageMocks.setNativeSecureItem).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(webInstallEpochKey)).toBe('legacy-local-value');
  });

  it('never treats secure-storage failure as evidence of reinstall', async () => {
    secureStorageMocks.getNativeSecureItem.mockRejectedValue(new Error('keychain locked'));

    await expect(seedNativeInstallEpochObserveOnly()).resolves.toEqual({
      phase: nativeInstallEpochPhase,
      status: 'secure-storage-unavailable'
    });
    expect(secureStorageMocks.setNativeSecureItem).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(webInstallEpochKey)).toBeNull();
  });

  it('does not create a WebView marker when the secure seed write fails', async () => {
    secureStorageMocks.setNativeSecureItem.mockRejectedValue(new Error('write timed out'));

    await expect(seedNativeInstallEpochObserveOnly()).resolves.toEqual({
      phase: nativeInstallEpochPhase,
      status: 'secure-storage-unavailable'
    });
    expect(window.localStorage.getItem(webInstallEpochKey)).toBeNull();
  });

  it('records WebView storage failure without removing the secure marker', async () => {
    secureStorageMocks.getNativeSecureItem.mockResolvedValue(nativeInstallEpochPhase);
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('storage disabled');
      }
    });

    try {
      await expect(seedNativeInstallEpochObserveOnly()).resolves.toEqual({
        phase: nativeInstallEpochPhase,
        status: 'web-storage-unavailable'
      });
      expect(secureStorageMocks.setNativeSecureItem).not.toHaveBeenCalled();
    } finally {
      if (originalDescriptor) Object.defineProperty(window, 'localStorage', originalDescriptor);
    }
  });
});

function installLocalStorage() {
  const records = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => records.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => records.set(key, String(value))),
      removeItem: vi.fn((key: string) => records.delete(key)),
      clear: vi.fn(() => records.clear())
    }
  });
}
