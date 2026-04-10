import { describe, it, expect, vi } from 'vitest';
import { createInviteProcessor } from '../../js/accept-invite-flow.js';
import { hasFullTeamAccess } from '../../js/team-access.js';

describe('accept invite flow', () => {
    it('redeems admin invite codes via atomic redemption when available', async () => {
        const deps = {
            validateAccessCode: vi.fn(async () => ({
                valid: true,
                codeId: 'code-123',
                type: 'admin_invite',
                data: { teamId: 'team-1' }
            })),
            redeemParentInvite: vi.fn(),
            getTeam: vi.fn(async () => ({
                id: 'team-1',
                name: 'Tigers',
                ownerId: 'owner-1',
                adminEmails: ['coach@example.com']
            })),
            getUserProfile: vi.fn(async () => ({
                email: 'coach@example.com'
            })),
            redeemAdminInviteAtomically: vi.fn().mockResolvedValue({
                success: true,
                teamId: 'team-1',
                teamName: 'Tigers'
            })
        };

        const processInvite = createInviteProcessor(deps);
        const result = await processInvite('user-1', 'ABCD1234', 'Coach@Example.com');

        expect(result.success).toBe(true);
        expect(result.redirectUrl).toBe('dashboard.html');
        expect(result.message).toContain('Tigers');
        expect(deps.redeemAdminInviteAtomically).toHaveBeenCalledWith('code-123', 'user-1', 'Coach@Example.com');
    });

    it('verifies admin invite acceptance leaves the invited user with edit-team access', async () => {
        const team = {
            id: 'team-7',
            ownerId: 'owner-1',
            name: 'Falcons',
            adminEmails: ['newadmin@example.com']
        };
        const deps = {
            validateAccessCode: vi.fn(async () => ({
                valid: true,
                codeId: 'code-127',
                type: 'admin_invite',
                data: { teamId: 'team-7' }
            })),
            redeemParentInvite: vi.fn(),
            getTeam: vi.fn(async () => team),
            getUserProfile: vi.fn(async () => ({
                email: 'newadmin@example.com',
                coachOf: ['team-7'],
                roles: ['coach']
            })),
            redeemAdminInviteAtomically: vi.fn().mockResolvedValue({
                success: true,
                teamId: 'team-7',
                teamName: 'Falcons'
            })
        };

        const processInvite = createInviteProcessor(deps);
        const result = await processInvite('user-7', 'ABCD7777', 'NewAdmin@Example.com');

        expect(result).toEqual({
            success: true,
            message: "You've been added as an admin of Falcons!",
            redirectUrl: 'dashboard.html'
        });
        expect(hasFullTeamAccess(
            { uid: 'user-7', email: 'NewAdmin@Example.com', coachOf: ['team-7'], roles: ['coach'] },
            team
        )).toBe(true);
    });

    it('bubbles atomic admin redemption errors', async () => {
        const deps = {
            validateAccessCode: vi.fn(async () => ({
                valid: true,
                codeId: 'code-124',
                type: 'admin_invite',
                data: { teamId: 'team-2' }
            })),
            redeemParentInvite: vi.fn(),
            getTeam: vi.fn(),
            redeemAdminInviteAtomically: vi.fn().mockRejectedValue(new Error('Code already used'))
        };

        const processInvite = createInviteProcessor(deps);

        await expect(processInvite('user-1', 'ABCD1234')).rejects.toThrow('Code already used');
    });

    it('fails when atomic admin redemption returns an invalid result', async () => {
        const deps = {
            validateAccessCode: vi.fn(async () => ({
                valid: true,
                codeId: 'code-126',
                type: 'admin_invite',
                data: { teamId: 'team-4' }
            })),
            redeemParentInvite: vi.fn(),
            getTeam: vi.fn(),
            redeemAdminInviteAtomically: vi.fn().mockResolvedValue({})
        };

        const processInvite = createInviteProcessor(deps);

        await expect(processInvite('user-4', 'MNOP3456')).rejects.toThrow(
            'Failed to redeem admin invite atomically'
        );
    });

    it('rejects false-success admin invite redemption when team admin access was not actually granted', async () => {
        const deps = {
            validateAccessCode: vi.fn(async () => ({
                valid: true,
                codeId: 'code-128',
                type: 'admin_invite',
                data: { teamId: 'team-8' }
            })),
            redeemParentInvite: vi.fn(),
            getTeam: vi.fn(async () => ({
                id: 'team-8',
                ownerId: 'owner-1',
                name: 'Owls',
                adminEmails: ['owner@example.com']
            })),
            getUserProfile: vi.fn(async () => ({
                email: 'newadmin@example.com',
                coachOf: ['team-8'],
                roles: ['coach']
            })),
            redeemAdminInviteAtomically: vi.fn().mockResolvedValue({
                success: true,
                teamId: 'team-8',
                teamName: 'Owls'
            })
        };

        const processInvite = createInviteProcessor(deps);

        await expect(processInvite('user-8', 'WXYZ8888', 'newadmin@example.com')).rejects.toThrow(
            'Admin invite did not grant team management access'
        );
    });

    it('fails closed when atomic admin redemption is unavailable', async () => {
        const deps = {
            validateAccessCode: vi.fn(async () => ({
                valid: true,
                codeId: 'code-125',
                type: 'admin_invite',
                data: { teamId: 'team-3' }
            })),
            redeemParentInvite: vi.fn(),
            updateUserProfile: vi.fn(),
            updateTeam: vi.fn(),
            getTeam: vi.fn(async () => ({ id: 'team-3', name: 'Eagles', adminEmails: ['other@example.com'] })),
            getUserProfile: vi.fn(async () => ({
                email: 'Coach@Example.com',
                coachOf: ['team-1'],
                roles: ['parent']
            })),
            markAccessCodeAsUsed: vi.fn()
        };

        const processInvite = createInviteProcessor(deps);
        await expect(processInvite('user-3', 'IJKL9012')).rejects.toThrow(
            'Missing atomic admin invite redemption handler'
        );

        expect(deps.updateTeam).not.toHaveBeenCalled();
        expect(deps.updateUserProfile).not.toHaveBeenCalled();
        expect(deps.markAccessCodeAsUsed).not.toHaveBeenCalled();
    });

    it('does not mark code when validation fails', async () => {
        const deps = {
            validateAccessCode: vi.fn(async () => ({ valid: false, message: 'Code already used' })),
            redeemParentInvite: vi.fn(),
            markAccessCodeAsUsed: vi.fn()
        };

        const processInvite = createInviteProcessor(deps);

        await expect(processInvite('user-2', 'ABCD1234')).rejects.toThrow('Code already used');
        expect(deps.markAccessCodeAsUsed).not.toHaveBeenCalled();
    });
});
