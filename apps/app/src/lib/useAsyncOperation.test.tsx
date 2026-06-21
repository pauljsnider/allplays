// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAsyncOperation } from './useAsyncOperation';

function createDeferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });

    return { promise, resolve, reject };
}

function AsyncOperationHarness({
    operation,
    getErrorMessage,
    onError,
    onFinally
}: {
    operation: () => Promise<string>;
    getErrorMessage?: (error: unknown) => string;
    onError?: (error: unknown) => void | Promise<void>;
    onFinally?: () => void | Promise<void>;
}) {
    const { loading, error, setError, run } = useAsyncOperation();

    return (
        <div>
            <div data-testid="loading">{String(loading)}</div>
            <div data-testid="error">{error || ''}</div>
            <button type="button" onClick={() => setError('stale error')}>Seed error</button>
            <button
                type="button"
                onClick={() => {
                    void run(operation, {
                        getErrorMessage,
                        onError,
                        onFinally,
                        rethrow: false
                    });
                }}
            >
                Run
            </button>
        </div>
    );
}

describe('useAsyncOperation', () => {
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('clears stale errors and surfaces mapped failures without rethrowing', async () => {
        const deferred = createDeferred<string>();
        const operation = vi.fn(() => deferred.promise);
        const onError = vi.fn();
        const onFinally = vi.fn();

        render(
            <AsyncOperationHarness
                operation={operation}
                getErrorMessage={(error) => error instanceof Error ? `Mapped: ${error.message}` : 'Mapped failure'}
                onError={onError}
                onFinally={onFinally}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Seed error' }));
        expect(screen.getByTestId('error').textContent).toBe('stale error');

        fireEvent.click(screen.getByRole('button', { name: 'Run' }));

        await waitFor(() => {
            expect(screen.getByTestId('loading').textContent).toBe('true');
            expect(screen.getByTestId('error').textContent).toBe('');
        });

        deferred.reject(new Error('raw async failure'));

        await waitFor(() => {
            expect(screen.getByTestId('error').textContent).toBe('Mapped: raw async failure');
        });
        expect(screen.getByTestId('loading').textContent).toBe('false');
        expect(operation).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledWith(expect.any(Error));
        expect(onFinally).toHaveBeenCalledTimes(1);
    });
});
