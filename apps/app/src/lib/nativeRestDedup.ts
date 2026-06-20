type NativeRestDedupEntry<T> = {
  promise: Promise<T>;
  expiresAt: number;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
};

const defaultDedupWindowMs = 5 * 1000;
const nativeRestDedupCache = new Map<string, NativeRestDedupEntry<unknown>>();

function deleteNativeRestDedupEntry(key: string, promise?: Promise<unknown>) {
  const entry = nativeRestDedupCache.get(key);
  if (!entry) return;
  if (promise && entry.promise !== promise) return;
  if (entry.cleanupTimer) {
    clearTimeout(entry.cleanupTimer);
  }
  nativeRestDedupCache.delete(key);
}

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
  if (existing) {
    deleteNativeRestDedupEntry(key, existing.promise);
  }

  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const entry: NativeRestDedupEntry<T> = {
    promise,
    expiresAt: now + dedupWindowMs,
    cleanupTimer: null
  };
  entry.cleanupTimer = setTimeout(() => {
    deleteNativeRestDedupEntry(key, promise);
  }, Math.max(0, dedupWindowMs));
  nativeRestDedupCache.set(key, entry);

  Promise.resolve()
    .then(loader)
    .then((result) => {
      deleteNativeRestDedupEntry(key, promise);
      resolvePromise(result);
    })
    .catch((error) => {
      deleteNativeRestDedupEntry(key, promise);
      rejectPromise(error);
    });

  return promise;
}

export function clearNativeRestDedup(prefix = '') {
  [...nativeRestDedupCache.keys()].forEach((key) => {
    if (!prefix || key.startsWith(prefix)) {
      deleteNativeRestDedupEntry(key);
    }
  });
}
