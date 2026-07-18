export const nativeAuthMutationQueueWaitTimeoutMs = 15_000;

let nativeAuthMutationTail = Promise.resolve();
let activeMutationBarriers: Promise<unknown>[] | null = null;

/**
 * Keeps the current serialized mutation closed until an uncancellable native
 * operation settles, even if its caller-facing timeout has already returned.
 */
export function holdNativeAuthMutationQueueUntil(operation: Promise<unknown>) {
  activeMutationBarriers?.push(operation);
}

/**
 * Serializes native auth mutations so cleanup for one account cannot overlap
 * persistence writes or token refreshes for the next account. A rejected
 * operation never poisons the queue; the next explicit attempt may recover.
 */
export function runSerializedNativeAuthMutation<T>(operation: () => Promise<T>): Promise<T> {
  const previousTail = nativeAuthMutationTail;
  const barriers: Promise<unknown>[] = [];
  let started = false;
  let cancelled = false;
  let waitTimeoutId: ReturnType<typeof setTimeout> | undefined;

  const result = previousTail.then(async () => {
    if (cancelled) {
      throw new Error('Native authentication operation was cancelled after waiting for cleanup.');
    }
    started = true;
    if (waitTimeoutId) clearTimeout(waitTimeoutId);
    const previousBarriers = activeMutationBarriers;
    activeMutationBarriers = barriers;
    try {
      return await operation();
    } finally {
      activeMutationBarriers = previousBarriers;
    }
  });

  nativeAuthMutationTail = result.then(
    async () => {
      await Promise.allSettled(barriers);
    },
    async () => {
      await Promise.allSettled(barriers);
    }
  );

  const waitTimeout = new Promise<T>((_, reject) => {
    waitTimeoutId = setTimeout(() => {
      if (started) return;
      cancelled = true;
      reject(new Error('Authentication is still finishing prior account cleanup. Try again.'));
    }, nativeAuthMutationQueueWaitTimeoutMs);
  });
  return Promise.race([result, waitTimeout]);
}
