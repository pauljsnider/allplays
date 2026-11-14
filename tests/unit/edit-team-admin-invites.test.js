import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { VOLUNTEER_SCREENING_BLOCK_MESSAGE } from '../../js/volunteer-screening-access.js';
import {
    processPendingAdminInvites,
    buildAdminInviteFollowUp,
    inviteExistingTeamAdmin,
    loadPendingAdminInviteEmails, loadPendingAdminInvites, resendPendingAdminInvite
} from '../../js/edit-team-admin-invites.js';

describe('edit team admin invite processing', () => {
    it('creates an existing-team admin invite without granting access before redemption', async () => {
        const inviteAdmin = vi.fn().mockResolvedValue({
            code: 'CODE1111',
            teamName: 'Tigers',
            existingUser: false
        });
        const addTeamAdminEmail = vi.fn().mockResolvedValue(undefined);
        const sendInviteEmail = vi.fn().mockResolvedValue({ success: true });

        const result = await inviteExistingTeamAdmin({
            teamId: 'team-123',
            email: 'Coach@Example.com',
            inviteAdmin,
            addTeamAdminEmail,
            sendInviteEmail
        });

        expect(inviteAdmin).toHaveBeenCalledWith('team-123', 'coach@example.com');
        expect(addTeamAdminEmail).not.toHaveBeenCalled();
        expect(sendInviteEmail).toHaveBeenCalledWith('coach@example.com', 'CODE1111', 'admin', { teamName: 'Tigers' });
        expect(result).toEqual({
            email: 'coach@example.com',
            status: 'sent',
            code: 'CODE1111',
            teamName: 'Tigers'
        });
    });

    it('emails existing users without granting access before redemption', async () => {
        const inviteAdmin = vi.fn().mockResolvedValue({
            code: 'EXIST111',
            teamName: 'Tigers',
            existingUser: true
        });
        const addTeamAdminEmail = vi.fn().mockResolvedValue(undefined);
        const sendInviteEmail = vi.fn();

        const result = await inviteExistingTeamAdmin({
            teamId: 'team-123',
            email: 'Coach@Example.com',
            inviteAdmin,
            addTeamAdminEmail,
            sendInviteEmail
        });

        expect(addTeamAdminEmail).not.toHaveBeenCalled();
        expect(sendInviteEmail).toHaveBeenCalledWith('coach@example.com', 'EXIST111', 'admin', { teamName: 'Tigers' });
        expect(result).toEqual({
            email: 'coach@example.com',
            status: 'sent',
            code: 'EXIST111',
            teamName: 'Tigers'
        });
    });

    it('does not persist admin access when invite creation fails or returns no valid code', async () => {
        const addTeamAdminEmail = vi.fn().mockResolvedValue(undefined);
        const sendInviteEmail = vi.fn();

        const malformedResult = await inviteExistingTeamAdmin({
            teamId: 'team-123',
            email: 'Coach@Example.com',
            inviteAdmin: vi.fn().mockResolvedValue(null),
            addTeamAdminEmail,
            sendInviteEmail
        });

        const missingCodeResult = await inviteExistingTeamAdmin({
            teamId: 'team-123',
            email: 'Coach@Example.com',
            inviteAdmin: vi.fn().mockResolvedValue({ code: '   ', teamName: 'Tigers', existingUser: false }),
            addTeamAdminEmail,
            sendInviteEmail
        });

        expect(addTeamAdminEmail).not.toHaveBeenCalled();
        expect(sendInviteEmail).not.toHaveBeenCalled();
        expect(malformedResult).toEqual({
            email: 'coach@example.com',
            status: 'fallback_code',
            code: null,
            teamName: null,
            reason: 'missing_invite_code'
        });
        expect(missingCodeResult).toEqual({
            email: 'coach@example.com',
            status: 'fallback_code',
            code: null,
            teamName: 'Tigers',
            reason: 'missing_invite_code'
        });
    });

    it('preserves screening enforcement errors on the admin invite path', async () => {
        const addTeamAdminEmail = vi.fn().mockResolvedValue(undefined);
        const sendInviteEmail = vi.fn();

        await expect(inviteExistingTeamAdmin({
            teamId: 'team-123',
            email: 'Coach@Example.com',
            inviteAdmin: vi.fn().mockRejectedValue(new Error(VOLUNTEER_SCREENING_BLOCK_MESSAGE)),
            addTeamAdminEmail,
            sendInviteEmail
        })).rejects.toThrow(VOLUNTEER_SCREENING_BLOCK_MESSAGE);

        expect(addTeamAdminEmail).not.toHaveBeenCalled();
        expect(sendInviteEmail).not.toHaveBeenCalled();
    });

    it('hydrates pending invite emails from active team access codes', async () => {
        const future = Date.now() + 60_000;
        const getTeamAccessCodes = vi.fn().mockResolvedValue([
            { email: 'pending@example.com', teamId: 'team-123', type: 'admin_invite', used: false, expiresAt: { toMillis: () => future } },
            { email: 'PENDING@example.com ', teamId: 'team-123', type: 'admin_invite', used: false, status: 'active', expiresAt: { toMillis: () => future } },
            { email: 'expired@example.com', teamId: 'team-123', type: 'admin_invite', used: false, expiresAt: { toMillis: () => future - 120_000 } },
            { email: 'used@example.com', teamId: 'team-123', type: 'admin_invite', used: true, expiresAt: { toMillis: () => future } },
            { email: 'inactive@example.com', teamId: 'team-123', type: 'admin_invite', used: false, active: false, expiresAt: { toMillis: () => future } },
            { email: 'wrongtype@example.com', teamId: 'team-123', type: 'standard', used: false, expiresAt: { toMillis: () => future } }
        ]);

        const emails = await loadPendingAdminInviteEmails({
            teamId: 'team-123',
            getTeamAccessCodes
        });

        expect(getTeamAccessCodes).toHaveBeenCalledWith('team-123');
        expect(emails).toEqual(['pending@example.com']);
    });

    it('processes each pending invite after team creation', async () => {
        const inviteAdmin = vi.fn()
            .mockResolvedValueOnce({ code: 'CODE1111', teamName: 'Tigers', existingUser: false })
            .mockResolvedValueOnce({ code: 'CODE2222', teamName: 'Tigers', existingUser: true });
        const sendInviteEmail = vi.fn().mockResolvedValue({ success: true });

        const result = await processPendingAdminInvites({
            teamId: 'team-123',
            pendingEmails: ['a@example.com', 'b@example.com'],
            inviteAdmin,
            sendInviteEmail
        });

        expect(inviteAdmin).toHaveBeenCalledTimes(2);
        expect(inviteAdmin).toHaveBeenNthCalledWith(1, 'team-123', 'a@example.com');
        expect(inviteAdmin).toHaveBeenNthCalledWith(2, 'team-123', 'b@example.com');
        expect(sendInviteEmail).toHaveBeenCalledTimes(2);
        expect(sendInviteEmail).toHaveBeenCalledWith('a@example.com', 'CODE1111', 'admin', { teamName: 'Tigers' });
        expect(result).toEqual({
            sentCount: 2,
            existingUserCount: 0,
            fallbackCodeCount: 0,
            failedCount: 0,
            results: [
                { email: 'a@example.com', status: 'sent', code: 'CODE1111' },
                { email: 'b@example.com', status: 'sent', code: 'CODE2222' }
            ]
        });
    });

    it('marks fallback when email delivery fails', async () => {
        const inviteAdmin = vi.fn().mockResolvedValue({ code: 'CODE9999', teamName: 'Lions', existingUser: false });
        const sendInviteEmail = vi.fn().mockRejectedValue(new Error('SMTP offline'));

        const result = await processPendingAdminInvites({
            teamId: 'team-456',
            pendingEmails: ['coach@example.com'],
            inviteAdmin,
            sendInviteEmail
        });

        expect(result.fallbackCodeCount).toBe(1);
        expect(result.results).toEqual([
            { email: 'coach@example.com', status: 'fallback_code', code: 'CODE9999' }
        ]);
    });

    it('does not send invite email when code is missing', async () => {
        const inviteAdmin = vi.fn().mockResolvedValue({ code: '   ', teamName: 'Lions', existingUser: false });
        const sendInviteEmail = vi.fn();

        const result = await processPendingAdminInvites({
            teamId: 'team-789',
            pendingEmails: ['coach@example.com'],
            inviteAdmin,
            sendInviteEmail
        });

        expect(sendInviteEmail).not.toHaveBeenCalled();
        expect(result).toEqual({
            sentCount: 0,
            existingUserCount: 0,
            fallbackCodeCount: 1,
            failedCount: 0,
            results: [
                {
                    email: 'coach@example.com',
                    status: 'fallback_code',
                    code: null,
                    reason: 'missing_invite_code'
                }
            ]
        });
    });

    it('handles malformed invite responses without throwing', async () => {
        const inviteAdmin = vi.fn().mockResolvedValue(null);
        const sendInviteEmail = vi.fn();

        const result = await processPendingAdminInvites({
            teamId: 'team-790',
            pendingEmails: ['coach@example.com'],
            inviteAdmin,
            sendInviteEmail
        });

        expect(sendInviteEmail).not.toHaveBeenCalled();
        expect(result.fallbackCodeCount).toBe(1);
        expect(result.results).toEqual([
            {
                email: 'coach@example.com',
                status: 'fallback_code',
                code: null,
                reason: 'missing_invite_code'
            }
        ]);
    });

    it('returns empty summary when there are no pending invites', async () => {
        const inviteAdmin = vi.fn();
        const sendInviteEmail = vi.fn();

        const result = await processPendingAdminInvites({
            teamId: 'team-000',
            pendingEmails: [],
            inviteAdmin,
            sendInviteEmail
        });

        expect(inviteAdmin).not.toHaveBeenCalled();
        expect(sendInviteEmail).not.toHaveBeenCalled();
        expect(result).toEqual({
            sentCount: 0,
            existingUserCount: 0,
            fallbackCodeCount: 0,
            failedCount: 0,
            results: []
        });
    });

    it('builds shareable follow-up details for existing users and fallback codes', () => {
        const followUp = buildAdminInviteFollowUp({
            results: [
                { email: 'coach1@example.com', status: 'existing_user', code: 'EXIST111' },
                { email: 'coach2@example.com', status: 'fallback_code', code: 'FALL2222' },
                { email: 'coach3@example.com', status: 'sent', code: 'SENT333' }
            ]
        }, 'https://allplays.ai');

        expect(followUp.shareableCount).toBe(2);
        expect(followUp.unresolvedCount).toBe(0);
        expect(followUp.shareableInvites).toEqual([
            {
                email: 'coach1@example.com',
                code: 'EXIST111',
                acceptInviteUrl: 'https://allplays.ai/app/#/accept-invite?code=EXIST111&type=admin'
            },
            {
                email: 'coach2@example.com',
                code: 'FALL2222',
                acceptInviteUrl: 'https://allplays.ai/app/#/accept-invite?code=FALL2222&type=admin'
            }
        ]);
        expect(followUp.shareableDetails).toContain('coach1@example.com | code: EXIST111 | https://allplays.ai/app/#/accept-invite?code=EXIST111&type=admin');
        expect(followUp.shareableDetails).toContain('coach2@example.com | code: FALL2222 | https://allplays.ai/app/#/accept-invite?code=FALL2222&type=admin');
    });

    it('counts unresolved follow-up entries when no code is available or processing failed', () => {
        const followUp = buildAdminInviteFollowUp({
            results: [
                { email: 'coach1@example.com', status: 'existing_user', code: null },
                { email: 'coach2@example.com', status: 'fallback_code', code: '' },
                { email: 'coach3@example.com', status: 'failed', error: 'invite error' }
            ]
        }, 'https://allplays.ai');

        expect(followUp.shareableCount).toBe(0);
        expect(followUp.unresolvedCount).toBe(3);
        expect(followUp.shareableDetails).toBe('');
    });

    it('wires existing-team invite persistence through edit-team page', () => {
        const html = readFileSync(new URL('../../edit-team.html', import.meta.url), 'utf8');

        expect(html).toContain('inviteExistingTeamAdmin');
        expect(html).toContain('addTeamAdminEmail');
    });
});

describe('pending admin invite recovery', () => {
    const invite = { id: 'CODE1', code: 'CODE1', teamId: 't1', type: 'admin_invite', email: 'Coach@Example.com', generatedBy: 'sender', expiresAt: new Date(Date.now() + 60000) };
    it('retains link and sender after reload while excluding other teams and spent codes', async () => {
        const result = await loadPendingAdminInvites({ teamId: 't1', getTeamAccessCodes: async () => [invite, {...invite, teamId: 'other'}, {...invite, used: true}, {...invite, revoked: true}] });
        expect(result).toEqual([{id: 'CODE1', code: 'CODE1', email: 'coach@example.com', generatedBy: 'sender', teamName: null}]);
    });
    it('resends the same valid code without creating an invite or granting access', async () => {
        const sendInviteEmail = vi.fn().mockResolvedValue({emailSent:true});
        await resendPendingAdminInvite({teamId:'t1', inviteId:'CODE1', userId:'sender', getTeamAccessCodes:async()=>[invite], sendInviteEmail});
        expect(sendInviteEmail).toHaveBeenCalledExactlyOnceWith('coach@example.com','CODE1','admin',{teamName:null});
    });
    it('denies resend by another admin and after expiry or redemption', async () => {
        const sendInviteEmail = vi.fn();
        for (const [userId, record] of [['other',invite],['sender',{...invite,used:true}],['sender',{...invite,expiresAt:new Date(0)}]]) {
            await expect(resendPendingAdminInvite({teamId:'t1',inviteId:'CODE1',userId,getTeamAccessCodes:async()=>[record],sendInviteEmail})).rejects.toThrow();
        }
        expect(sendInviteEmail).not.toHaveBeenCalled();
    });
    it('preserves a recovery code on email cooldown instead of claiming sent', async () => {
        const result = await inviteExistingTeamAdmin({teamId:'t1',email:'coach@example.com',inviteAdmin:async()=>({code:'CODE1',existingUser:true}),sendInviteEmail:async()=>{throw Object.assign(new Error('wait'),{code:'auth/invite-email-rate-limited'});}});
        expect(result.status).toBe('fallback_code');
        expect(result.reason).toBe('rate_limited');
        expect(result.code).toBe('CODE1');
        expect(buildAdminInviteFollowUp({results:[result]},'https://example.com').shareableCount).toBe(1);
    });
});
