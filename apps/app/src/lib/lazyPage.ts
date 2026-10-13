import { lazy, type ComponentType } from 'react';
import { createLogger } from './logger';
import { isNativeRuntime } from './nativeRuntime';

const logger = createLogger('lazy-page');

const lazyChunkReloadKey = 'allplays:lazy-chunk-reload-attempted';

export function isLazyChunkLoadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Loading chunk \d+ failed|ChunkLoadError|Importing a module script failed/i.test(message);
}

// A rejected module fetch can remain in the browser's module map. Retry only
// versioned bundles from this web app, with one stable alternate module URL.
export function getLazyChunkRetryUrl(error: unknown): string | null {
  if (!isLazyChunkLoadError(error) || typeof window === 'undefined' || isNativeRuntime()) return null;
  const message = error instanceof Error ? error.message : String(error || '');
  const match = message.match(/(?:Failed to fetch dynamically imported module|error loading dynamically imported module):\s*(https?:\/\/\S+)$/i);
  if (!match) return null;
  try {
    const url = new URL(match[1]);
    const assets = new URL('./assets/', window.location.href);
    if (!/^https?:$/.test(window.location.protocol) || url.origin !== window.location.origin
      || url.username || url.password || url.search || url.hash
      || !url.pathname.startsWith(assets.pathname)) return null;
    const filename = url.pathname.slice(assets.pathname.length);
    if (!/^[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8,}\.js$/.test(filename)) return null;
    url.searchParams.set('allplays-chunk-retry', '1');
    return url.href;
  } catch {
    return null;
  }
}

export async function retryLazyPageModule(
  error: unknown,
  importModule: (url: string) => Promise<Record<string, unknown>> = (url) => import(/* @vite-ignore */ url)
): Promise<Record<string, unknown>> {
  const url = getLazyChunkRetryUrl(error);
  if (!url) throw error;
  logger.warn('Retrying a failed route chunk once.');
  await new Promise((resolve) => setTimeout(resolve, 250));
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      importModule(url),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(error), 5000);
      })
    ]);
  } catch {
    // Keep the original browser failure for the existing reload/error boundary.
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function shouldAttemptLazyChunkReload(error: unknown) {
  if (!isLazyChunkLoadError(error)) return false;
  if (typeof window === 'undefined') return false;
  try {
    return Boolean(window.sessionStorage) && window.sessionStorage.getItem(lazyChunkReloadKey) !== '1';
  } catch {
    return false;
  }
}

export function handleLazyPageLoadError(error: unknown): Promise<{ default: ComponentType<any> }> {
  if (!shouldAttemptLazyChunkReload(error)) {
    return Promise.reject(error);
  }

  try {
    window.sessionStorage.setItem(lazyChunkReloadKey, '1');
    if (window.sessionStorage.getItem(lazyChunkReloadKey) !== '1') return Promise.reject(error);
  } catch {
    // Without durable tab state a new document could reload forever.
    return Promise.reject(error);
  }
  window.location.reload();
  return new Promise(() => {});
}

export function lazyNamedPage<TModule extends Record<string, unknown>, TExport extends keyof TModule>(
  loadModule: () => Promise<TModule>,
  exportName: TExport
) {
  return lazy(() => loadModule()
    .catch(async (error: unknown) => {
      const module = await retryLazyPageModule(error);
      // The failed URL could name a dependency rather than this route. Never
      // render a different module or retry recursively in that case.
      if (!(exportName in module)) throw error;
      return module as TModule;
    })
    .then((module) => {
      // Keep the tab reload budget: another successful chunk must not rearm it.
      return { default: module[exportName] as ComponentType<any> };
    })
    .catch(handleLazyPageLoadError));
}
