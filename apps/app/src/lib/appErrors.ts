export type AppServiceErrorType = 'network' | 'permission' | 'not_found' | 'validation' | 'unknown';

type AppServiceErrorOptions = {
    status?: number;
    cause?: unknown;
};

export class AppServiceError extends Error {
    type: AppServiceErrorType;
    status?: number;
    cause?: unknown;

    constructor(type: AppServiceErrorType, message: string, options: AppServiceErrorOptions = {}) {
        super(message);
        this.name = 'AppServiceError';
        this.type = type;
        this.status = options.status;
        this.cause = options.cause;
    }
}

export function isAppServiceError(error: unknown): error is AppServiceError {
    if (error instanceof AppServiceError) return true;
    if (!error || typeof error !== 'object') return false;
    return 'name' in error && (error as { name?: string }).name === 'AppServiceError' && 'type' in error;
}

export function getAppServiceErrorMessage(error: unknown, fallbackMessage: string) {
    if (error && typeof error === 'object' && 'message' in error) {
        const message = (error as { message?: unknown }).message;
        if (typeof message === 'string' && message.trim()) {
            return message.trim();
        }
    }
    return fallbackMessage;
}

function getStatus(error: unknown) {
    if (!error || typeof error !== 'object' || !('status' in error)) return undefined;
    const status = Number((error as { status?: unknown }).status);
    return Number.isFinite(status) ? status : undefined;
}

function inferAppServiceErrorType(error: unknown): AppServiceErrorType {
    const status = getStatus(error);
    const message = getAppServiceErrorMessage(error, '').toLowerCase();

    if (status === 401 || status === 403 || /(permission|forbidden|not allowed|unauthorized|denied)/.test(message)) {
        return 'permission';
    }
    if (status === 404 || /(not[_ -]?found|was not found|missing)/.test(message)) {
        return 'not_found';
    }
    if ([400, 409, 412, 422].includes(status || 0) || /(invalid|required|must |select |enter a valid|unsupported)/.test(message)) {
        return 'validation';
    }
    if (error instanceof TypeError || /(network|offline|failed to fetch|load failed|timed out|timeout|unavailable|unreachable|connection)/.test(message)) {
        return 'network';
    }
    return 'unknown';
}

export function toAppServiceError(error: unknown, fallbackMessage: string) {
    if (isAppServiceError(error)) {
        return error;
    }

    return new AppServiceError(
        inferAppServiceErrorType(error),
        getAppServiceErrorMessage(error, fallbackMessage),
        { status: getStatus(error), cause: error }
    );
}

export function isRetryableAppServiceError(error: unknown) {
    const appError = isAppServiceError(error) ? error : null;
    return appError?.type === 'network' || appError?.type === 'unknown';
}
