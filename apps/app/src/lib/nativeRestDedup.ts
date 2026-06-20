type NativeRestDedupEntry<T> = {
  promise: Promise<T>;
  expiresAt: number;
};

const defaultDedupWindowMs = 5 * 1000;
const nativeRestDedupCache = new Map<string, NativeRestDedupEntry<unknown>>();

export function shouldDedupNativeRestRequest(path: string, init: RequestInit = {}) {
  const method = String(init.method || 'GET').toUpperCase();
  return method === 'GET' || (method === 'POST' && path.endsWith(':runQuery'));
}

export function getNativeRestDedupKey(url: string, init: RequestInit = {}) {
  const method = String(init.method || 'GET').toUpperCase();
  const body = typeof init.body === 'string' ? init.body : '';
  return `${method}:${url}:${body}`;
}

export function loadDedupedNativeRestRequest<T>(
  key: string,
  loader: () => Promise<T>,
  { dedupWindowMs = defaultDedupWindowMs }: { dedupWindowMs?: number } = {}
): Promise<T> {
  const now = Date.now();
  const existing = nativeRestDedupCache.get(key) as NativeRestDedupEntry<T> | undefined;
  if (existing && existing.expiresAt > now) {
    return existing.promise;
  }

  const promise = loader().catch((error) => {
    if (nativeRestDedupCache.get(key)?.promise === promise) {
      nativeRestDedupCache.delete(key);
    }
    throw error;
  });
  nativeRestDedupCache.set(key, {
    promise,
    expiresAt: now + dedupWindowMs
  });
  return promise;
}

export function clearNativeRestDedup(prefix = '') {
  [...nativeRestDedupCache.keys()].forEach((key) => {
    if (!prefix || key.startsWith(prefix)) {
      nativeRestDedupCache.delete(key);
    }
  });
}
