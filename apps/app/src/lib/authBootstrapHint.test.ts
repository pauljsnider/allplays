// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAuthBootstrapHint, readAuthBootstrapHint, writeAuthBootstrapHint } from './authBootstrapHint';

describe('authBootstrapHint', () => {
  beforeEach(() => {
    vi.useRealTimers();
    installStorage();
  });

  it('stores only a short-lived non-authoritative boolean hint with no identity or role data', () => {
    writeAuthBootstrapHint({
      uid: 'user-1',
      email: 'parent@example.com',
      displayName: 'Pat Parent',
      roles: ['admin'],
      isAdmin: true,
      emailVerified: true
    });

    const raw = window.localStorage.getItem('allplays:auth-bootstrap-hint:v2') || '';
    expect(JSON.parse(raw)).toEqual({ authenticatedRecently: true, updatedAt: expect.any(Number) });
    expect(raw).not.toContain('user-1');
    expect(raw).not.toContain('parent@example.com');
    expect(raw).not.toContain('admin');
    expect(readAuthBootstrapHint()?.authenticatedRecently).toBe(true);
  });

  it('expires the loading hint and cannot keep a signed-out route waiting indefinitely', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T12:00:00Z'));
    writeAuthBootstrapHint({ uid: 'user-1' } as never);
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    expect(readAuthBootstrapHint()).toBeNull();
    expect(window.localStorage.getItem('allplays:auth-bootstrap-hint:v2')).toBeNull();
  });

  it('deletes the legacy identity-bearing hint instead of trusting or migrating it', () => {
    window.localStorage.setItem('allplays:auth-bootstrap-hint:v1', JSON.stringify({
      uid: 'attacker',
      email: 'attacker@example.com',
      roles: ['platformAdmin'],
      updatedAt: Date.now()
    }));

    expect(readAuthBootstrapHint()).toBeNull();
    expect(window.localStorage.getItem('allplays:auth-bootstrap-hint:v1')).toBeNull();
  });

  it('returns null when reading storage throws a SecurityError', () => {
    installThrowingLocalStorageGetter();
    expect(readAuthBootstrapHint()).toBeNull();
  });

  it('swallows SecurityError when writing storage', () => {
    installThrowingLocalStorageGetter();
    expect(() => writeAuthBootstrapHint({ uid: 'user-1' } as never)).not.toThrow();
  });

  it('swallows SecurityError when clearing storage', () => {
    installThrowingLocalStorageGetter();
    expect(() => clearAuthBootstrapHint()).not.toThrow();
  });
});

function installStorage() {
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

function installThrowingLocalStorageGetter() {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('Access denied', 'SecurityError');
    }
  });
}
