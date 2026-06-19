import { redactedValue, sanitizeForLogging } from './logger';

export function sanitizeErrorForLogging(error: unknown) {
    return sanitizeForLogging(error);
}

export type SanitizedRequestInitForLogging = Record<string, unknown>;

export function sanitizeRequestInitForLogging(init: RequestInit): SanitizedRequestInitForLogging {
    const sanitized = sanitizeForLogging(init);

    return {
        ...(sanitized as Record<string, unknown>),
        headers: redactedValue
    };
}
