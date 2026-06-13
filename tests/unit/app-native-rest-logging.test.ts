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
                refreshToken: 'refresh-token-999'
            }
        });

        const sanitized = sanitizeErrorForLogging(error);
        const serialized = JSON.stringify(sanitized);

        expect(serialized).not.toContain('test-token-123');
        expect(serialized).not.toContain('second-token-456');
        expect(serialized).not.toContain('id-token-789');
        expect(serialized).not.toContain('refresh-token-999');
        expect(serialized).toContain('Bearer [REDACTED]');
        expect(serialized).toContain('[REDACTED]');
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

    it('sanitizeRequestInitForLogging replaces headers with [REDACTED]', () => {
        const init: RequestInit = {
            method: 'POST',
            headers: { Authorization: 'Bearer abc123', 'Content-Type': 'application/json' },
            body: JSON.stringify({ foo: 'bar' })
        };
        const sanitized = sanitizeRequestInitForLogging(init);
        expect(sanitized.headers).toBe('[REDACTED]');
        expect(sanitized.method).toBe('POST');
        expect(sanitized.body).toBe(JSON.stringify({ foo: 'bar' }));
        expect(JSON.stringify(sanitized)).not.toContain('abc123');
        expect(JSON.stringify(sanitized)).not.toContain('Authorization');
    });
});
