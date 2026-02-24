import { describe, it, expect, vi } from 'vitest';
import { acceptAdminInvite } from '../../js/admin-invite-helpers.js';

describe('admin invite helpers', () => {
    it('persists invited admin email on team and preserves existing coach roles', async () => {
        const getTeam = vi.fn().mockResolvedValue({
            id: 'team-1',
            name: 'Falcons',
            adminEmails: ['owner@example.com']
        });
        const getUserProfile = vi.fn().mockResolvedValue({
            email: 'NewAdmin@Example.com',
            coachOf: ['team-9'],
            roles: ['parent']
        });
        const updateTeam = vi.fn().mockResolvedValue(undefined);
        const updateUserProfile = vi.fn().mockResolvedValue(undefined);

        const team = await acceptAdminInvite({
            userId: 'user-1',
            teamId: 'team-1',
            getTeam,
            getUserProfile,
            updateTeam,
            updateUserProfile
        });

        expect(team.name).toBe('Falcons');
        expect(updateTeam).toHaveBeenCalledWith('team-1', {
            adminEmails: ['owner@example.com', 'newadmin@example.com']
        });
        expect(updateUserProfile).toHaveBeenCalledWith('user-1', {
            coachOf: ['team-9', 'team-1'],
            roles: ['parent', 'coach']
        });
    });

    it('does not write duplicate admin email', async () => {
        const getTeam = vi.fn().mockResolvedValue({
            id: 'team-1',
            adminEmails: ['newadmin@example.com']
        });
        const getUserProfile = vi.fn().mockResolvedValue({
            email: 'NEWADMIN@example.com',
            coachOf: [],
            roles: []
        });
        const updateTeam = vi.fn().mockResolvedValue(undefined);
        const updateUserProfile = vi.fn().mockResolvedValue(undefined);

        await acceptAdminInvite({
            userId: 'user-1',
            teamId: 'team-1',
            getTeam,
            getUserProfile,
            updateTeam,
            updateUserProfile
        });

        expect(updateTeam).not.toHaveBeenCalled();
        expect(updateUserProfile).toHaveBeenCalledWith('user-1', {
            coachOf: ['team-1'],
            roles: ['coach']
        });
    });
});
