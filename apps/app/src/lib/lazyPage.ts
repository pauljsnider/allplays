import { lazy, type ComponentType } from 'react';

const lazyChunkReloadKey = 'allplays:lazy-chunk-reload-attempted';

export function isLazyChunkLoadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Loading chunk \d+ failed|ChunkLoadError|Importing a module script failed/i.test(message);
}

export function shouldAttemptLazyChunkReload(error: unknown) {
  if (!isLazyChunkLoadError(error)) return false;
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage?.getItem(lazyChunkReloadKey) !== '1';
  } catch {
    return true;
  }
}

export function handleLazyPageLoadError(error: unknown): Promise<{ default: ComponentType<any> }> {
  if (!shouldAttemptLazyChunkReload(error)) {
    return Promise.reject(error);
  }

  try {
    window.sessionStorage?.setItem(lazyChunkReloadKey, '1');
  } catch {
    // Continue with the reload even when storage is unavailable.
  }
  window.location.reload();
  return new Promise(() => {});
}

export function clearLazyChunkReloadAttempt() {
  try {
    window.sessionStorage?.removeItem(lazyChunkReloadKey);
  } catch {
    // Session storage is best-effort only.
  }
}

export function lazyNamedPage<TModule extends Record<string, unknown>, TExport extends keyof TModule>(
  loadModule: () => Promise<TModule>,
  exportName: TExport
) {
  return lazy(() => loadModule()
    .then((module) => {
      clearLazyChunkReloadAttempt();
      return { default: module[exportName] as ComponentType<any> };
    })
    .catch(handleLazyPageLoadError));
}
