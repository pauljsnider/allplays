import { describe, expect, it } from 'vitest';

import { sanitizeErrorForLogging, sanitizeRequestInitForLogging } from '../../apps/app/src/lib/nativeRestLogging.ts';

describe('native REST logging sanitizer', () => {
    it('redacts bearer auth and token fields from nested log payloads', () => {
        const error = new Error('Firestore request failed for Bearer test-token-123');
        Object.assign(error, {
            status: 401,
            request: {
                headers: {
                    Authorization: 'Bearer test-token-123',
                    authorization: 'Bearer second-token-456'
                }
            },
            details: {
                idToken: 'id-token-789',
                refreshToken: 'refresh-token-999',
                access_token: 'access-token-abc',
                auth_token: 'auth-token-def'
            },
            init: {
                headers: new Headers({
                    Authorization: 'Bearer third-token-000'
                }),
                url: 'https://example.test/path?access_token=query-token-111&safe=value'
            }
        });

        const sanitized = sanitizeErrorForLogging(error);
        const serialized = JSON.stringify(sanitized);

        expect(serialized).not.toContain('test-token-123');
        expect(serialized).not.toContain('second-token-456');
        expect(serialized).not.toContain('id-token-789');
        expect(serialized).not.toContain('refresh-token-999');
        expect(serialized).not.toContain('access-token-abc');
        expect(serialized).not.toContain('auth-token-def');
        expect(serialized).not.toContain('third-token-000');
        expect(serialized).not.toContain('query-token-111');
        expect(serialized).toContain('Bearer [REDACTED]');
        expect(serialized).toContain('[REDACTED]');
        expect(serialized).toContain('access_token=[REDACTED]');
        expect(sanitized).toMatchObject({
            status: 401,
            request: {
                headers: {
                    Authorization: '[REDACTED]',
                    authorization: '[REDACTED]'
                }
            }
        });
    });

    it('redacts bearer token appearing in an error message string', () => {
        const error = new Error('Request failed: Bearer sometoken123 was rejected');
        const sanitized = sanitizeErrorForLogging(error) as { message: string };
        expect(sanitized.message).not.toContain('sometoken123');
        expect(sanitized.message).toContain('Bearer [REDACTED]');
    });

    it('sanitizeRequestInitForLogging redacts headers and nested body secrets', () => {
        const init = {
            method: 'POST',
            headers: { Authorization: 'Bearer abc123', 'Content-Type': 'application/json' },
            body: {
                idToken: 'id-token-123',
                refreshToken: 'refresh-token-456',
                nested: {
                    authorization: 'Bearer nested-token-789'
                }
            } as unknown as BodyInit
        } as RequestInit;

        const sanitized = sanitizeRequestInitForLogging(init);
        const serialized = JSON.stringify(sanitized);

        expect(sanitized.headers).toBe('[REDACTED]');
        expect(sanitized.method).toBe('POST');
        expect(serialized).not.toContain('abc123');
        expect(serialized).not.toContain('Authorization');
        expect(serialized).not.toContain('id-token-123');
        expect(serialized).not.toContain('refresh-token-456');
        expect(serialized).not.toContain('nested-token-789');
        expect(sanitized.body).toEqual({
            idToken: '[REDACTED]',
            refreshToken: '[REDACTED]',
            nested: {
                authorization: '[REDACTED]'
            }
        });
    });
});
