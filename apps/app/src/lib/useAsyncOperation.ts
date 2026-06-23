import { useCallback, useRef, useState } from 'react';

type UseAsyncOperationRunOptions<T> = {
    clearError?: boolean;
    errorMessage?: string;
    getErrorMessage?: (error: unknown) => string;
    onSuccess?: (value: T) => void | Promise<void>;
    onError?: (error: unknown) => void | Promise<void>;
    onFinally?: () => void | Promise<void>;
    ignoreStale?: boolean;
    rethrow?: boolean;
};

function getDefaultErrorMessage(error: unknown) {
    if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && error.message.trim()) {
        return error.message;
    }
    return 'Something went wrong.';
}

export function useAsyncOperation() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const latestRunIdRef = useRef(0);

    const clearError = useCallback(() => {
        setError(null);
    }, []);

    const run = useCallback(async function runAsyncOperation<T>(
        operation: () => Promise<T>,
        {
            clearError: shouldClearError = true,
            errorMessage,
            getErrorMessage,
            onSuccess,
            onError,
            onFinally,
            ignoreStale = false,
            rethrow = true
        }: UseAsyncOperationRunOptions<T> = {}
    ) {
        const runId = latestRunIdRef.current + 1;
        latestRunIdRef.current = runId;
        const isCurrentRun = () => !ignoreStale || latestRunIdRef.current === runId;

        setLoading(true);
        if (shouldClearError) {
            setError(null);
        }

        try {
            const value = await operation();
            if (isCurrentRun()) {
                await onSuccess?.(value);
            }
            return value;
        } catch (error) {
            if (isCurrentRun()) {
                setError(errorMessage || getErrorMessage?.(error) || getDefaultErrorMessage(error));
                await onError?.(error);
            }
            if (rethrow) {
                throw error;
            }
            return null;
        } finally {
            if (isCurrentRun()) {
                setLoading(false);
                await onFinally?.();
            }
        }
    }, []);

    return {
        loading,
        error,
        clearError,
        setError,
        run
    };
}
