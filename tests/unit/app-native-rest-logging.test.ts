import { describe, expect, it } from 'vitest';

import { sanitizeErrorForLogging } from '../../apps/app/src/lib/nativeRestLogging.ts';

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
});
