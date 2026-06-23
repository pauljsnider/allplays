import { useCallback, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { toAppServiceError, type AppServiceError } from '../../lib/appErrors';
import { useAsyncOperation } from '../../lib/useAsyncOperation';

type ParentToolAsyncOptions<T> = {
    onSuccess?: (value: T) => void | Promise<void>;
    onError?: (error: AppServiceError) => void | Promise<void>;
    onFinally?: () => void | Promise<void>;
    clearError?: boolean;
};

export function useParentToolAsyncOperation() {
    const { loading, clearError: clearOperationError, run: runOperation } = useAsyncOperation();
    const [error, setError] = useState<AppServiceError | null>(null);

    const clearError = useCallback(() => {
        setError(null);
        clearOperationError();
    }, [clearOperationError]);

    const run = useCallback(async function runParentToolAsyncOperation<T>(
        task: () => Promise<T>,
        fallbackMessage: string,
        options: ParentToolAsyncOptions<T> = {}
    ) {
        if (options.clearError ?? true) {
            setError(null);
            clearOperationError();
        }

        return runOperation(task, {
            rethrow: false,
            getErrorMessage: (taskError) => getParentToolErrorMessage(toAppServiceError(taskError, fallbackMessage), fallbackMessage),
            onSuccess: async (value) => {
                setError(null);
                await options.onSuccess?.(value);
            },
            onError: async (taskError) => {
                const appError = toAppServiceError(taskError, fallbackMessage);
                setError(appError);
                await options.onError?.(appError);
            },
            onFinally: async () => {
                await options.onFinally?.();
            }
        });
    }, [clearOperationError, runOperation]);

    return {
        loading,
        error,
        setError,
        clearError,
        run
    };
}

export function ToolHeader({ icon: Icon, title, detail, action }: { icon: LucideIcon; title: string; detail: string; action?: ReactNode }) {
    return (
        <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                    <h2 className="text-sm font-black text-gray-950">{title}</h2>
                    <p className="mt-0.5 text-xs font-semibold leading-5 text-gray-500">{detail}</p>
                </div>
            </div>
            {action ? <div className="flex-none">{action}</div> : null}
        </div>
    );
}

export function MetricCard({ label, value, urgent = false }: { label: string; value: string; urgent?: boolean }) {
    return (
        <div className={`rounded-xl border p-2 ${urgent ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
            <div className={`text-[10px] font-black uppercase tracking-[0.04em] ${urgent ? 'text-amber-700' : 'text-gray-500'}`}>{label}</div>
            <div className="mt-1 truncate text-sm font-black text-gray-950">{value}</div>
        </div>
    );
}

export function Status({ tone, message }: { tone: 'error' | 'success'; message: string }) {
    const Icon = tone === 'error' ? AlertCircle : CheckCircle2;
    return (
        <div className={`mt-3 flex items-start gap-2 rounded-xl border p-3 text-sm font-semibold ${tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
            <Icon className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
            <span>{message}</span>
        </div>
    );
}

export function RetryableStatus({
    error,
    fallbackMessage,
    onRetry,
    retrying,
    buttonLabel = 'Retry'
}: {
    error: AppServiceError | null;
    fallbackMessage: string;
    onRetry?: () => void;
    retrying?: boolean;
    buttonLabel?: string;
}) {
    return (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">
            <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
                <div className="min-w-0 flex-1">{getParentToolErrorMessage(error, fallbackMessage)}</div>
                {onRetry ? (
                    <button type="button" className="ghost-button !min-h-8 !px-2 text-xs" onClick={onRetry} disabled={retrying}>
                        <RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} aria-hidden="true" />
                        {buttonLabel}
                    </button>
                ) : null}
            </div>
        </div>
    );
}

export function getParentToolErrorMessage(error: AppServiceError | null, fallbackMessage: string) {
    if (!error) return fallbackMessage;
    return String(error.message || '').trim() || fallbackMessage;
}

export function LoadingBlock({ label }: { label: string }) {
    return (
        <section className="app-card p-6 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary-600" aria-hidden="true" />
            <div className="mt-3 text-sm font-black text-gray-900">{label}</div>
        </section>
    );
}

export function EmptyState({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail: string }) {
    return (
        <div className="app-card p-5 text-center">
            <Icon className="mx-auto h-8 w-8 text-gray-400" aria-hidden="true" />
            <div className="mt-3 text-sm font-black text-gray-950">{title}</div>
            <div className="mt-1 text-xs font-semibold text-gray-500">{detail}</div>
        </div>
    );
}

export async function copyText(value: string, setMessage: (message: string) => void) {
    try {
        await navigator.clipboard.writeText(value);
        setMessage('Copied.');
    } catch {
        setMessage('Copy is not available in this browser.');
    }
}

export function splitLines(value: string) {
    return String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function formatMoney(cents: number) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((Number(cents) || 0) / 100);
}

export function formatDetailAmount(row: Record<string, any>) {
    const cents = row.amountCents ?? row.balanceDueCents ?? row.paidAmountCents ?? row.adjustmentCents ?? row.totalCents;
    if (typeof cents === 'number') return formatMoney(cents);
    if (row.amount) return String(row.amount);
    if (row.dueDate) return String(row.dueDate);
    if (row.createdAt) return 'Recorded';
    return '';
}
