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

const redactedValue = '[REDACTED]';

function normalizeSensitiveKey(key: string) {
    return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSensitiveKey(key: string) {
    const lowerKey = key.toLowerCase();
    return sensitiveKeys.has(lowerKey) || sensitiveKeys.has(normalizeSensitiveKey(lowerKey));
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogContext = Record<string, unknown>;

function redactBearerTokens(value: string) {
    return value.replace(/Bearer\s+[^\s"',}]+/gi, `Bearer ${redactedValue}`);
}

function redactSensitiveQueryParams(value: string) {
    return value.replace(
        /([?&#](?:access[_-]?token|id[_-]?token|refresh[_-]?token|auth[_-]?token|api[_-]?key|client[_-]?secret|token|password|secret)=)[^&#\s"',}]+/gi,
        `$1${redactedValue}`
    );
}

function isHeadersLike(value: unknown): value is Headers {
    return typeof Headers !== 'undefined' && value instanceof Headers;
}

function sanitizeValue(value: unknown, seen: WeakSet<object>, depth: number, keyHint = ''): unknown {
    if (value == null) return value;

    if (typeof value === 'string') {
        return isSensitiveKey(keyHint) ? redactedValue : redactSensitiveQueryParams(redactBearerTokens(value));
    }

    if (typeof value !== 'object') {
        return value;
    }

    if (isHeadersLike(value)) {
        return sanitizeValue(Object.fromEntries(value.entries()), seen, depth + 1, keyHint);
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

    if (value instanceof Error) {
        const error = value as Error & Record<string, unknown>;
        const sanitizedError: Record<string, unknown> = {
            name: sanitizeValue(error.name || 'Error', seen, depth + 1, 'name'),
            message: sanitizeValue(error.message || 'Unknown error', seen, depth + 1, 'message')
        };

        ['status', 'code', 'cause', 'details', 'request', 'response', 'config', 'headers', 'init'].forEach((key) => {
            if (error[key] !== undefined) {
                sanitizedError[key] = sanitizeValue(error[key], seen, depth + 1, key);
            }
        });
        return sanitizedError;
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
