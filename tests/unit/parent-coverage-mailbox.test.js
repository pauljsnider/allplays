import { describe, expect, it, vi } from 'vitest';
import {
    auditParentCoverageMailboxAccess,
    findLatestParentMailboxActionLink
} from '../../scripts/parent-coverage-mailbox.mjs';

function response(body, status = 200) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function encodedMessage(text) {
    return Buffer.from(text).toString('base64url');
}

describe('parent coverage protected mailbox boundary', () => {
    it('returns only an allowlisted matching Firebase action link', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(response({ access_token: 'temporary-token' }))
            .mockResolvedValueOnce(response({ messages: [{ id: 'mail-1' }] }))
            .mockResolvedValueOnce(response({
                payload: {
                    mimeType: 'text/html',
                    body: {
                        data: encodedMessage(
                            '<a href="https://attacker.example/?oobCode=bad">bad</a>' +
                            '<a href="https://game-flow-c6311.firebaseapp.com/__/auth/action?mode=verifyEmail&amp;oobCode=good">verify</a>'
                        )
                    }
                }
            }));
        const url = await findLatestParentMailboxActionLink({
            action: 'verifyEmail',
            recipient: 'fixture@example.com',
            clientId: 'client',
            clientSecret: 'secret',
            refreshToken: 'refresh',
            afterEpoch: 100,
            maxAttempts: 1,
            fetchImpl
        });
        expect(url).toContain('game-flow-c6311.firebaseapp.com');
        expect(url).toContain('oobCode=good');
        expect(url).not.toContain('attacker');
        expect(String(fetchImpl.mock.calls[1][0])).toContain('to%3Afixture%40example.com');
    });

    it('fails closed when credentials or a matching message are absent', async () => {
        await expect(findLatestParentMailboxActionLink({
            action: 'verifyEmail',
            recipient: '',
            clientId: '',
            clientSecret: '',
            refreshToken: '',
            afterEpoch: 0
        })).rejects.toThrow(/configuration is incomplete/);
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(response({ access_token: 'temporary-token' }))
            .mockResolvedValueOnce(response({ messages: [] }));
        await expect(findLatestParentMailboxActionLink({
            action: 'resetPassword',
            recipient: 'fixture@example.com',
            clientId: 'client',
            clientSecret: 'secret',
            refreshToken: 'refresh',
            afterEpoch: 100,
            maxAttempts: 1,
            fetchImpl
        })).rejects.toThrow(/no recent resetPassword message/);
    });

    it('audits OAuth access without exposing the mailbox identity', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(response({ access_token: 'temporary-token' }))
            .mockResolvedValueOnce(response({ emailAddress: 'private@example.com' }));
        await expect(auditParentCoverageMailboxAccess({
            clientId: 'client',
            clientSecret: 'secret',
            refreshToken: 'refresh',
            fetchImpl
        })).resolves.toBe(true);
    });
});
