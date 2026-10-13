// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLazyChunkRetryUrl, retryLazyPageModule, handleLazyPageLoadError, isLazyChunkLoadError, shouldAttemptLazyChunkReload } from './lazyPage';

describe('lazy page chunk recovery', () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('detects stale dynamic import chunk failures', () => {
    expect(isLazyChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://allplays.ai/app/assets/PlayerDetail-Cagh9kMr.js'))).toBe(true);
    expect(isLazyChunkLoadError(new TypeError('error loading dynamically imported module: https://allplays.ai/app/assets/PlayerDetail-Cagh9kMr.js'))).toBe(true);
    expect(isLazyChunkLoadError(new Error('Loading chunk 42 failed.'))).toBe(true);
    expect(isLazyChunkLoadError(new Error('Player detail render failed'))).toBe(false);
  });

  it('attempts one reload for a stale lazy route chunk', () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload }
    });
    const error = new TypeError('Failed to fetch dynamically imported module: https://allplays.ai/app/assets/PlayerDetail-Cagh9kMr.js');

    const pending = handleLazyPageLoadError(error);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem('allplays:lazy-chunk-reload-attempted')).toBe('1');
    expect(shouldAttemptLazyChunkReload(error)).toBe(false);
    expect(pending).toBeInstanceOf(Promise);
  });

  it.each(['throw', 'ignore'])('does not reload if the reload marker write is %s', async (mode) => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      if (mode === 'throw') throw new Error('Storage denied');
    });
    const error = new TypeError('Failed to fetch dynamically imported module: https://allplays.ai/app/assets/PlayerDetail-Abcd1234.js');
    await expect(handleLazyPageLoadError(error)).rejects.toBe(error);
    expect(reload).not.toHaveBeenCalled();
  });

  it('rejects non-chunk lazy route errors without reloading', async () => {
    const error = new Error('Home page render failed');

    await expect(handleLazyPageLoadError(error)).rejects.toBe(error);
  });
});

describe('bounded in-page route retry', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: 'https://allplays.ai/app/#/players/team/player', origin: 'https://allplays.ai', protocol: 'https:' }
    });
  });

  it.each([
    'https://attacker.example/app/assets/PlayerDetail-Abcd1234.js',
    'https://allplays.ai/other/assets/PlayerDetail-Abcd1234.js',
    'https://allplays.ai/app/assets/nested/PlayerDetail-Abcd1234.js',
    'https://allplays.ai/app/assets/PlayerDetail.js',
    'https://allplays.ai/app/assets/PlayerDetail-Abcd1234.js?token=secret',
    'https://allplays.ai/app/assets/PlayerDetail-Abcd1234.js#fragment',
    'https://user:secret@allplays.ai/app/assets/PlayerDetail-Abcd1234.js'
  ])('never retries an untrusted or unversioned module URL: %s', async (url) => {
    const error = new TypeError(`Failed to fetch dynamically imported module: ${url}`);
    const importer = vi.fn();
    await expect(retryLazyPageModule(error, importer)).rejects.toBe(error);
    expect(importer).not.toHaveBeenCalled();
  });

  it.each(['capacitor:', 'https:'])('does not introduce retries into native %s shells', (protocol) => {
    Object.defineProperty(window, 'location', { configurable: true, value: { href: `${protocol}//localhost/app/`, origin: `${protocol}//localhost`, protocol, hostname: 'localhost' } });
    expect(getLazyChunkRetryUrl(new Error(`Failed to fetch dynamically imported module: ${protocol}//localhost/app/assets/PlayerDetail-Abcd1234.js`))).toBeNull();
  });

  it('uses one stable retry URL and preserves the original failure on timeout', async () => {
    vi.useFakeTimers();
    try {
      const error = new Error('Failed to fetch dynamically imported module: https://allplays.ai/app/assets/PlayerDetail-Abcd1234.js');
      const importer = vi.fn(() => new Promise<Record<string, unknown>>(() => {}));
      const result = retryLazyPageModule(error, importer);
      const assertion = expect(result).rejects.toBe(error);
      await vi.advanceTimersByTimeAsync(249);
      expect(importer).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5001);
      await assertion;
      expect(importer).toHaveBeenCalledExactlyOnceWith('https://allplays.ai/app/assets/PlayerDetail-Abcd1234.js?allplays-chunk-retry=1');
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
