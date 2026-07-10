import { useCallback, useRef, useState } from 'react';
import { toAppServiceError, type AppServiceError } from './appErrors';

type UseAsyncOperationRunOptions<T> = {
    clearError?: boolean;
    errorMessage?: string;
    getErrorMessage?: (error: unknown) => string;
    onSuccess?: (value: T) => void | Promise<void>;
    onError?: (error: unknown) => void | Promise<void>;
    onFinally?: () => void | Promise<void>;
    ignoreStale?: boolean;
    shouldHandleError?: (error: unknown) => boolean;
    rethrow?: boolean;
};

function getDefaultErrorMessage(error: unknown) {
    if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && error.message.trim()) {
        return error.message;
    }
    return 'Something went wrong.';
}

type UseAppAsyncOperationRunOptions<T> = Omit<UseAsyncOperationRunOptions<T>, 'errorMessage' | 'getErrorMessage' | 'onError'> & {
    fallbackMessage: string;
    onError?: (error: AppServiceError) => void | Promise<void>;
};

export function useAsyncOperation() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const latestRunIdRef = useRef(0);

    const clearError = useCallback(() => {
        setError(null);
    }, []);

    const invalidate = useCallback(() => {
        latestRunIdRef.current += 1;
        setLoading(false);
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
            shouldHandleError,
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
            if (isCurrentRun() && (shouldHandleError?.(error) ?? true)) {
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
        invalidate,
        setError,
        run
    };
}

export function useAppAsyncOperation() {
    const {
        loading,
        clearError: clearAsyncError,
        run: runAsyncOperation
    } = useAsyncOperation();
    const [error, setError] = useState<AppServiceError | null>(null);

    const clearError = useCallback(() => {
        setError(null);
        clearAsyncError();
    }, [clearAsyncError]);

    const run = useCallback(async function runAppAsyncOperation<T>(
        operation: () => Promise<T>,
        {
            fallbackMessage,
            clearError: shouldClearError = true,
            onSuccess,
            onError,
            onFinally,
            ignoreStale,
            shouldHandleError,
            rethrow = false
        }: UseAppAsyncOperationRunOptions<T>
    ) {
        if (shouldClearError) {
            setError(null);
            clearAsyncError();
        }

        return runAsyncOperation(operation, {
            clearError: false,
            ignoreStale,
            onFinally,
            onSuccess: async (value) => {
                setError(null);
                await onSuccess?.(value);
            },
            onError: async (operationError) => {
                const appError = toAppServiceError(operationError, fallbackMessage);
                setError(appError);
                await onError?.(appError);
            },
            shouldHandleError,
            getErrorMessage: (operationError) => toAppServiceError(operationError, fallbackMessage).message,
            rethrow
        });
    }, [clearAsyncError, runAsyncOperation]);

    return {
        loading,
        error,
        clearError,
        setError,
        run
    };
}
