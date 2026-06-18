import { useCallback, useState } from 'react';

type UseAsyncOperationRunOptions<T> = {
    clearError?: boolean;
    errorMessage?: string;
    getErrorMessage?: (error: unknown) => string;
    onSuccess?: (value: T) => void | Promise<void>;
    onError?: (error: unknown) => void | Promise<void>;
    onFinally?: () => void | Promise<void>;
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
            rethrow = true
        }: UseAsyncOperationRunOptions<T> = {}
    ) {
        setLoading(true);
        if (shouldClearError) {
            setError(null);
        }

        try {
            const value = await operation();
            await onSuccess?.(value);
            return value;
        } catch (error) {
            setError(errorMessage || getErrorMessage?.(error) || getDefaultErrorMessage(error));
            await onError?.(error);
            if (rethrow) {
                throw error;
            }
            return null;
        } finally {
            setLoading(false);
            await onFinally?.();
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
