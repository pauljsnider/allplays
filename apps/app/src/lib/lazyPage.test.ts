// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleLazyPageLoadError, isLazyChunkLoadError, shouldAttemptLazyChunkReload } from './lazyPage';

describe('lazy page chunk recovery', () => {
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

  it('rejects non-chunk lazy route errors without reloading', async () => {
    const error = new Error('Home page render failed');

    await expect(handleLazyPageLoadError(error)).rejects.toBe(error);
  });
});
