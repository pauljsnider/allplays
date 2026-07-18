import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  holdNativeAuthMutationQueueUntil,
  nativeAuthMutationQueueWaitTimeoutMs,
  runSerializedNativeAuthMutation
} from './nativeAuthMutationQueue';

describe('nativeAuthMutationQueue', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not start a second auth mutation until the first finishes', async () => {
    const first = createDeferred<void>();
    const secondOperation = vi.fn(async () => 'user-b');

    const firstResult = runSerializedNativeAuthMutation(() => first.promise);
    const secondResult = runSerializedNativeAuthMutation(secondOperation);
    await Promise.resolve();
    expect(secondOperation).not.toHaveBeenCalled();

    first.resolve();
    await expect(firstResult).resolves.toBeUndefined();
    await expect(secondResult).resolves.toBe('user-b');
  });

  it('recovers after a failed mutation without allowing overlap', async () => {
    const failedOperation = runSerializedNativeAuthMutation(async () => {
      throw new Error('cleanup failed');
    });
    const recoveryOperation = vi.fn(async () => 'recovered');
    const recovery = runSerializedNativeAuthMutation(recoveryOperation);

    await expect(failedOperation).rejects.toThrow('cleanup failed');
    await expect(recovery).resolves.toBe('recovered');
    expect(recoveryOperation).toHaveBeenCalledTimes(1);
  });

  it('cancels queued work after a wait timeout while an uncancellable cleanup finishes late', async () => {
    vi.useFakeTimers();
    const lateCleanup = createDeferred<void>();
    await expect(runSerializedNativeAuthMutation(async () => {
      holdNativeAuthMutationQueueUntil(lateCleanup.promise);
      return 'signed-out';
    })).resolves.toBe('signed-out');

    const staleReplacement = vi.fn(async () => 'user-b');
    const timedOutResult = runSerializedNativeAuthMutation(staleReplacement);
    const timedOutRejection = expect(timedOutResult).rejects.toThrow(
      'still finishing prior account cleanup'
    );
    await vi.advanceTimersByTimeAsync(nativeAuthMutationQueueWaitTimeoutMs);
    await timedOutRejection;
    expect(staleReplacement).not.toHaveBeenCalled();

    lateCleanup.resolve();
    await vi.runAllTimersAsync();
    expect(staleReplacement).not.toHaveBeenCalled();

    await expect(runSerializedNativeAuthMutation(async () => 'retry-user-b'))
      .resolves.toBe('retry-user-b');
  });
});

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
