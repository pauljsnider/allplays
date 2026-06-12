const sensitiveKeys = new Set([
    'authorization',
    'accesstoken',
    'idtoken',
    'refreshtoken'
]);

const redactedValue = '[REDACTED]';

function redactBearerTokens(value: string) {
    return value.replace(/Bearer\s+[^\s"',}]+/gi, `Bearer ${redactedValue}`);
}

function isHeadersLike(value: unknown): value is Headers {
    return typeof Headers !== 'undefined' && value instanceof Headers;
}

function sanitizeValue(value: unknown, seen: WeakSet<object>, depth: number, keyHint = ''): unknown {
    if (value == null) return value;

    if (typeof value === 'string') {
        return sensitiveKeys.has(keyHint.toLowerCase()) ? redactedValue : redactBearerTokens(value);
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

    const error = value as Error & Record<string, unknown>;
    if (value instanceof Error) {
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
        acc[key] = sensitiveKeys.has(key.toLowerCase())
            ? redactedValue
            : sanitizeValue(entryValue, seen, depth + 1, key);
        return acc;
    }, {});
}

export function sanitizeErrorForLogging(error: unknown) {
    return sanitizeValue(error, new WeakSet<object>(), 0);
}
