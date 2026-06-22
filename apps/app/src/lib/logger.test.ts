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
            access_token: 'underscored-token',
            api_key: 'underscored-api-key',
            nested: {
                refreshToken: 'refresh-token',
                id_token: 'nested-id-token',
                message: 'Bearer nested-token-456 failed'
            }
        });

        expect(sanitized).toEqual({
            Authorization: '[REDACTED]',
            token: '[REDACTED]',
            access_token: '[REDACTED]',
            api_key: '[REDACTED]',
            nested: {
                refreshToken: '[REDACTED]',
                id_token: '[REDACTED]',
                message: 'Bearer [REDACTED] failed'
            }
        });
    });

    it('redacts secret URL parameters inside free-form strings', () => {
        const sanitized = sanitizeForLogging({
            message: 'Fetch failed for https://example.test/callback?access_token=abc123&teamId=team-1#id_token=jwt456',
            retryUrl: 'https://example.test/retry?client_secret=client-secret&status=pending',
            nested: [
                'https://example.test/session?auth-token=native-secret&view=home',
                'Bearer message-token'
            ]
        });

        expect(sanitized).toEqual({
            message: 'Fetch failed for https://example.test/callback?access_token=[REDACTED]&teamId=team-1#id_token=[REDACTED]',
            retryUrl: 'https://example.test/retry?client_secret=[REDACTED]&status=pending',
            nested: [
                'https://example.test/session?auth-token=[REDACTED]&view=home',
                'Bearer [REDACTED]'
            ]
        });
    });

    it('sanitizes Error objects with nested headers and circular request context', () => {
        const request: Record<string, unknown> = {
            headers: new Headers({
                Authorization: 'Bearer request-secret',
                'X-Team': 'team-1'
            })
        };
        request.self = request;

        const error = Object.assign(new Error('Request failed'), {
            status: 503,
            request,
            config: {
                apiKey: 'config-secret',
                nested: {
                    password: 'unsafe-password'
                }
            }
        });

        expect(sanitizeForLogging(error)).toEqual({
            name: 'Error',
            message: 'Request failed',
            status: 503,
            request: {
                headers: {
                    authorization: '[REDACTED]',
                    'x-team': 'team-1'
                },
                self: '[Circular]'
            },
            config: {
                apiKey: '[REDACTED]',
                nested: {
                    password: '[REDACTED]'
                }
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

    it('redacts secrets from free-form log messages before writing to console', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const logger = createLogger('schedule-service');

        logger.warn('Fetch failed for https://example.test/callback?access_token=abc123&teamId=team-1#id_token=jwt456');

        expect(warnSpy).toHaveBeenCalledWith(
            '[schedule-service] Fetch failed for https://example.test/callback?access_token=[REDACTED]&teamId=team-1#id_token=[REDACTED]'
        );
    });
});
