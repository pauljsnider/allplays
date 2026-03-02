import { describe, it, expect, vi } from 'vitest';
import { createInviteProcessor } from '../../js/accept-invite-flow.js';

describe('accept invite flow', () => {
    it('marks admin invite code as used after successful redemption', async () => {
        const calls = [];
        const deps = {
            validateAccessCode: vi.fn(async () => {
                calls.push('validate');
                return {
                    valid: true,
                    codeId: 'code-123',
                    type: 'admin_invite',
                    data: { teamId: 'team-1' }
                };
            }),
            redeemParentInvite: vi.fn(),
            updateUserProfile: vi.fn(async () => {
                calls.push('profile');
            }),
            getTeam: vi.fn(async () => ({ id: 'team-1', name: 'Tigers', adminEmails: [] })),
            getUserProfile: vi.fn(async () => ({ email: 'coach@example.com' })),
            updateTeam: vi.fn(async () => {
                calls.push('team');
            }),
            markAccessCodeAsUsed: vi.fn(async () => {
                calls.push('mark');
            })
        };

        const processInvite = createInviteProcessor(deps);
        const result = await processInvite('user-1', 'ABCD1234');

        expect(result.success).toBe(true);
        expect(result.redirectUrl).toBe('dashboard.html');
        expect(deps.updateTeam).toHaveBeenCalledWith('team-1', { adminEmails: ['coach@example.com'] });
        expect(deps.markAccessCodeAsUsed).toHaveBeenCalledWith('code-123', 'user-1');
        expect(calls).toEqual(['validate', 'team', 'profile', 'mark']);
    });

    it('merges coach team access instead of overwriting existing teams', async () => {
        const deps = {
            validateAccessCode: vi.fn(async () => ({
                valid: true,
                codeId: 'code-124',
                type: 'admin_invite',
                data: { teamId: 'team-2' }
            })),
            redeemParentInvite: vi.fn(),
            updateUserProfile: vi.fn(),
            getTeam: vi.fn(async () => ({ id: 'team-2', name: 'Sharks', adminEmails: ['other@example.com'] })),
            getUserProfile: vi.fn(async () => ({
                email: 'coach@example.com',
                coachOf: ['team-0', 'team-1'],
                roles: ['parent']
            })),
            updateTeam: vi.fn(),
            markAccessCodeAsUsed: vi.fn()
        };

        const processInvite = createInviteProcessor(deps);
        await processInvite('user-2', 'EFGH5678');

        expect(deps.updateUserProfile).toHaveBeenCalledWith('user-2', {
            coachOf: ['team-0', 'team-1', 'team-2'],
            roles: ['parent', 'coach']
        });
    });

    it('does not re-save adminEmails when user email is already a team admin', async () => {
        const deps = {
            validateAccessCode: vi.fn(async () => ({
                valid: true,
                codeId: 'code-125',
                type: 'admin_invite',
                data: { teamId: 'team-3' }
            })),
            redeemParentInvite: vi.fn(),
            updateUserProfile: vi.fn(),
            getTeam: vi.fn(async () => ({ id: 'team-3', name: 'Eagles', adminEmails: ['coach@example.com'] })),
            getUserProfile: vi.fn(async () => ({
                email: 'Coach@Example.com',
                coachOf: ['team-3'],
                roles: ['coach']
            })),
            updateTeam: vi.fn(),
            markAccessCodeAsUsed: vi.fn()
        };

        const processInvite = createInviteProcessor(deps);
        await processInvite('user-3', 'IJKL9012');

        expect(deps.updateTeam).not.toHaveBeenCalled();
        expect(deps.updateUserProfile).toHaveBeenCalledWith('user-3', {
            coachOf: ['team-3'],
            roles: ['coach']
        });
    });

    it('does not mark code when validation fails', async () => {
        const deps = {
            validateAccessCode: vi.fn(async () => ({ valid: false, message: 'Code already used' })),
            redeemParentInvite: vi.fn(),
            updateUserProfile: vi.fn(),
            getTeam: vi.fn(),
            getUserProfile: vi.fn(),
            updateTeam: vi.fn(),
            markAccessCodeAsUsed: vi.fn()
        };

        const processInvite = createInviteProcessor(deps);

        await expect(processInvite('user-2', 'ABCD1234')).rejects.toThrow('Code already used');
        expect(deps.markAccessCodeAsUsed).not.toHaveBeenCalled();
    });
});
