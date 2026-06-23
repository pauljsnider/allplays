const sensitiveKeys = new Set([
    'authorization',
    'proxy-authorization',
    'cookie',
    'set-cookie',
    'accesstoken',
    'idtoken',
    'refreshtoken',
    'token',
    'apikey',
    'api-key',
    'secret',
    'password'
]);

const sensitiveKeyFragments = [
    'authorization',
    'proxyauthorization',
    'cookie',
    'setcookie',
    'token',
    'apikey',
    'secret',
    'password'
];

const redactedValue = '[REDACTED]';

function normalizeSensitiveKey(key: string) {
    return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSensitiveKey(key: string) {
    const lowerKey = key.toLowerCase();
    const normalizedKey = normalizeSensitiveKey(lowerKey);
    return sensitiveKeys.has(lowerKey)
        || sensitiveKeys.has(normalizedKey)
        || sensitiveKeyFragments.some((fragment) => normalizedKey.includes(fragment));
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogContext = Record<string, unknown>;
export type NormalizedLogError = {
    name: string;
    message: string;
    [key: string]: unknown;
};

const errorMetadataKeys = [
    'status',
    'code',
    'type',
    'cause',
    'details',
    'request',
    'response',
    'config',
    'headers',
    'init'
] as const;

function redactBearerTokens(value: string) {
    return value.replace(/Bearer\s+[^\s"',}]+/gi, `Bearer ${redactedValue}`);
}

function redactSensitiveQueryParams(value: string) {
    return value.replace(
        /([?&#](?:access[_-]?token|id[_-]?token|refresh[_-]?token|auth|auth[_-]?token|api[_-]?key|client[_-]?secret|token|password|secret)=)[^&#\s"',}]+/gi,
        `$1${redactedValue}`
    );
}

function redactSensitiveAssignments(value: string) {
    return value.replace(
        /\b((?:access|id|refresh|auth)[_-]?token|authorization|token|api[_-]?key|client[_-]?secret|secret|password)\s*=\s*[^&#\s"',}]+/gi,
        `$1=${redactedValue}`
    );
}

function isHeadersLike(value: unknown): value is Headers {
    return typeof Headers !== 'undefined' && value instanceof Headers;
}

function sanitizeValue(value: unknown, seen: WeakSet<object>, depth: number, keyHint = ''): unknown {
    if (value == null) return value;

    if (typeof value === 'string') {
        return isSensitiveKey(keyHint)
            ? redactedValue
            : redactSensitiveAssignments(redactSensitiveQueryParams(redactBearerTokens(value)));
    }

    if (typeof value !== 'object') {
        return value;
    }

    if (isHeadersLike(value)) {
        return sanitizeValue(Object.fromEntries(value.entries()), seen, depth + 1, keyHint);
    }

    if (value instanceof Error) {
        return normalizeErrorValue(value, seen, depth, 'Unknown error');
    }

    if (seen.has(value)) {
        return '[Circular]';
    }

    if (depth >= 5) {
        return '[Truncated]';
    }

    seen.add(value);

    if (Array.isArray(value)) {
        return value.map((entry) => sanitizeValue(entry, seen, depth + 1, keyHint));
    }

    return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [key, entryValue]) => {
        acc[key] = isSensitiveKey(key)
            ? redactedValue
            : sanitizeValue(entryValue, seen, depth + 1, key);
        return acc;
    }, {});
}

export function sanitizeForLogging(value: unknown) {
    return sanitizeValue(value, new WeakSet<object>(), 0);
}

export function normalizeErrorForLogging(error: unknown, fallbackMessage = 'Unknown error') {
    return normalizeErrorValue(error, new WeakSet<object>(), 0, fallbackMessage);
}

export function isSensitiveLogKey(key: string) {
    return isSensitiveKey(key);
}

function normalizeErrorValue(
    error: unknown,
    seen: WeakSet<object>,
    depth: number,
    fallbackMessage: string
): NormalizedLogError {
    if (error && typeof error === 'object') {
        if (seen.has(error)) {
            return { name: 'Error', message: '[Circular]' };
        }
        seen.add(error);
    }

    const normalizedError: NormalizedLogError = {
        name: String(sanitizeValue(getErrorName(error), seen, depth + 1, 'name') || 'Error'),
        message: String(sanitizeValue(getErrorMessage(error, fallbackMessage), seen, depth + 1, 'message') || fallbackMessage)
    };

    if (error && typeof error === 'object') {
        const errorRecord = error as Record<string, unknown>;
        errorMetadataKeys.forEach((key) => {
            if (errorRecord[key] !== undefined) {
                normalizedError[key] = sanitizeValue(errorRecord[key], seen, depth + 1, key);
            }
        });

        if (!(error instanceof Error) && !errorMetadataKeys.some((key) => errorRecord[key] !== undefined)) {
            normalizedError.value = Object.entries(errorRecord).reduce<Record<string, unknown>>((acc, [key, entryValue]) => {
                acc[key] = isSensitiveKey(key)
                    ? redactedValue
                    : sanitizeValue(entryValue, seen, depth + 1, key);
                return acc;
            }, {});
        }
    } else if (typeof error !== 'string' && error !== undefined) {
        normalizedError.value = sanitizeValue(error, seen, depth + 1);
    }

    return normalizedError;
}

function getErrorName(error: unknown) {
    if (error instanceof Error && error.name) {
        return error.name;
    }
    if (error && typeof error === 'object' && 'name' in error && typeof (error as { name?: unknown }).name === 'string') {
        return (error as { name: string }).name;
    }
    return 'Error';
}

function getErrorMessage(error: unknown, fallbackMessage: string) {
    if (typeof error === 'string') {
        return error;
    }
    if (error instanceof Error && error.message) {
        return error.message;
    }
    if (error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
        return (error as { message: string }).message;
    }
    return fallbackMessage;
}

function getConsoleMethod(level: LogLevel) {
    if (level === 'debug') return console.debug?.bind(console) || console.log.bind(console);
    if (level === 'info') return console.info?.bind(console) || console.log.bind(console);
    if (level === 'warn') return console.warn.bind(console);
    return console.error.bind(console);
}

function writeLog(scope: string, level: LogLevel, message: string, context?: LogContext) {
    const method = getConsoleMethod(level);
    const prefix = `[${scope}] ${sanitizeForLogging(message)}`;
    if (!context || !Object.keys(context).length) {
        method(prefix);
        return;
    }
    method(prefix, sanitizeForLogging(context));
}

export function createLogger(scope: string) {
    return {
        debug(message: string, context?: LogContext) {
            writeLog(scope, 'debug', message, context);
        },
        info(message: string, context?: LogContext) {
            writeLog(scope, 'info', message, context);
        },
        warn(message: string, context?: LogContext) {
            writeLog(scope, 'warn', message, context);
        },
        error(message: string, context?: LogContext) {
            writeLog(scope, 'error', message, context);
        }
    };
}

export { redactedValue };
