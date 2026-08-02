import { describe, expect, it, vi } from 'vitest';
import {
    auditParentCoverageMailboxAccess,
    findLatestParentMailboxActionLink,
    validateParentMailboxActionUrl
} from '../../scripts/parent-coverage-mailbox.mjs';

function response(body, status = 200) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function mailboxMessage(text, {
    from = 'ALL PLAYS <noreply@mail.allplays.ai>',
    authentication = 'mx.google.com; dkim=pass header.i=@mail.allplays.ai header.from=mail.allplays.ai'
} = {}) {
    return {
        headers: [
            { name: 'From', value: from },
            { name: 'Authentication-Results', value: authentication }
        ],
        mimeType: 'text/html',
        body: { data: Buffer.from(text).toString('base64url') }
    };
}

describe('parent coverage protected mailbox boundary', () => {
    it('returns only an allowlisted matching Firebase action link', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(response({ access_token: 'temporary-token' }))
            .mockResolvedValueOnce(response({ messages: [{ id: 'mail-1' }] }))
            .mockResolvedValueOnce(response({
                payload: mailboxMessage(
                    '<a href="https://attacker.example/?oobCode=bad">bad</a>' +
                    '<a href="https://game-flow-c6311.firebaseapp.com/__/auth/action?mode=verifyEmail&amp;oobCode=good">verify</a>'
                )
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
        expect(String(fetchImpl.mock.calls[1][0])).toContain('from%3Anoreply%40mail.allplays.ai');
    });

    it('rejects spoofed senders and wrong paths even when their query parameters look valid', async () => {
        const validLookingLink = 'https://game-flow-c6311.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=spoofed';
        const wrongPath = 'https://allplays.ai/app/#/home?mode=verifyEmail&oobCode=wrong-path';
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(response({ access_token: 'temporary-token' }))
            .mockResolvedValueOnce(response({ messages: [{ id: 'mail-1' }, { id: 'mail-2' }] }))
            .mockResolvedValueOnce(response({
                payload: mailboxMessage(`<a href="${validLookingLink}">verify</a>`, {
                    from: 'ALL PLAYS <attacker@example.com>',
                    authentication: 'mx.google.com; dkim=pass header.i=@example.com header.from=example.com'
                })
            }))
            .mockResolvedValueOnce(response({ payload: mailboxMessage(`<a href="${wrongPath}">verify</a>`) }));
        await expect(findLatestParentMailboxActionLink({
            action: 'verifyEmail',
            recipient: 'fixture@example.com',
            clientId: 'client',
            clientSecret: 'secret',
            refreshToken: 'refresh',
            afterEpoch: 100,
            maxAttempts: 1,
            fetchImpl
        })).rejects.toThrow(/no recent verifyEmail message/);
    });

    it('accepts only exact post-navigation routes for each mailbox action', () => {
        expect(() => validateParentMailboxActionUrl(
            'https://allplays.ai/app/#/reset-password',
            'resetPassword',
            { allowConsumed: true }
        )).not.toThrow();
        expect(() => validateParentMailboxActionUrl(
            'https://allplays.ai/app/#/accept-invite?code=HOME5678&type=household',
            'invite'
        )).not.toThrow();
        expect(() => validateParentMailboxActionUrl(
            'https://allplays.ai/app/#/home?mode=resetPassword&oobCode=secret',
            'resetPassword',
            { allowConsumed: true }
        )).toThrow(/expected app route/);
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

    it('keeps OAuth credentials out of authorization failures', async () => {
        const fetchImpl = vi.fn().mockResolvedValueOnce(response({}, 401));
        const clientId = 'sensitive-client-id';
        const clientSecret = 'sensitive-client-secret';
        const refreshToken = 'sensitive-refresh-token';
        let message = '';
        try {
            await auditParentCoverageMailboxAccess({ clientId, clientSecret, refreshToken, fetchImpl });
        } catch (error) {
            message = String(error?.message || error);
        }
        expect(message).toBe('mailbox authorization failed with status 401');
        expect(message).not.toContain(clientId);
        expect(message).not.toContain(clientSecret);
        expect(message).not.toContain(refreshToken);
    });
});
