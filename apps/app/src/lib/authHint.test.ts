// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearAuthHint, hasAuthHint, readAuthHint, writeAuthHint } from './authHint';

// The test runtime's built-in localStorage isn't a full implementation, so install
// a deterministic Map-backed stub for these tests.
function installMemoryLocalStorage() {
  const store = new Map<string, string>();
  const memoryStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() { return store.size; }
  };
  Object.defineProperty(window, 'localStorage', { value: memoryStorage, configurable: true, writable: true });
}

beforeEach(() => {
  installMemoryLocalStorage();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('authHint', () => {
  it('round-trips a uid hint', () => {
    expect(readAuthHint()).toBeNull();
    expect(hasAuthHint()).toBe(false);

    writeAuthHint('user-123');
    expect(readAuthHint()).toEqual({ uid: 'user-123' });
    expect(hasAuthHint()).toBe(true);
  });

  it('clears the hint', () => {
    writeAuthHint('user-123');
    clearAuthHint();
    expect(readAuthHint()).toBeNull();
    expect(hasAuthHint()).toBe(false);
  });

  it('ignores empty uids and malformed storage', () => {
    writeAuthHint('');
    expect(readAuthHint()).toBeNull();

    window.localStorage.setItem('allplays:auth-hint', 'not json');
    expect(readAuthHint()).toBeNull();

    window.localStorage.setItem('allplays:auth-hint', JSON.stringify({ uid: '' }));
    expect(readAuthHint()).toBeNull();
  });
});
