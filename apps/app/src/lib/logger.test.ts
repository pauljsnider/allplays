import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createLogger, sanitizeForLogging } from './logger';

describe('logger', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('redacts token-like fields from structured payloads', () => {
        const sanitized = sanitizeForLogging({
            Authorization: 'Bearer abc123',
            token: 'plain-token',
            nested: {
                refreshToken: 'refresh-token',
                message: 'Bearer nested-token-456 failed'
            }
        });

        expect(sanitized).toEqual({
            Authorization: '[REDACTED]',
            token: '[REDACTED]',
            nested: {
                refreshToken: '[REDACTED]',
                message: 'Bearer [REDACTED] failed'
            }
        });
    });

    it('emits sanitized structured warnings through level helpers', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const logger = createLogger('schedule-service');

        logger.warn('Falling back to REST profile load.', {
            operation: 'profile-load',
            fallback: 'rest',
            error: {
                Authorization: 'Bearer secret-token',
                accessToken: 'another-secret'
            }
        });

        expect(warnSpy).toHaveBeenCalledWith(
            '[schedule-service] Falling back to REST profile load.',
            {
                operation: 'profile-load',
                fallback: 'rest',
                error: {
                    Authorization: '[REDACTED]',
                    accessToken: '[REDACTED]'
                }
            }
        );
    });
});
