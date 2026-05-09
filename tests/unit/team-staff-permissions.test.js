import { describe, expect, it } from 'vitest';
import { buildTeamStaffPermissionsViewModel, renderTeamStaffPermissionsSection } from '../../js/team-staff-permissions.js';

describe('team staff and permissions view model', () => {
    it('lists owner, admins, and unused pending admin invites separately', () => {
        const viewModel = buildTeamStaffPermissionsViewModel({
            ownerId: 'owner-uid',
            ownerEmail: 'Owner@Example.com',
            adminEmails: [' Coach@Example.com ', 'coach@example.com'],
            teamPermissions: {
                scorekeeping: { mode: 'selected', memberIds: [' scorekeeper-1 ', 'scorekeeper-1'] },
                streaming: { mode: 'selected', memberIds: ['video-1'] },
                volunteer: { mode: 'selected', memberIds: ['snacks-1'] }
            },
            streamVolunteerEmails: ['video@example.com']
        }, [
            { email: 'pending@example.com', type: 'admin_invite', used: false },
            { email: 'coach@example.com', type: 'admin_invite', used: false },
            { email: 'used@example.com', type: 'admin_invite', used: true }
        ]);

        expect(viewModel.staff).toEqual([
            { label: 'owner@example.com', role: 'Owner' },
            { label: 'coach@example.com', role: 'Admin' }
        ]);
        expect(viewModel.pendingInvites).toEqual(['pending@example.com']);
        expect(viewModel.helperPermissions).toEqual([
            expect.objectContaining({ key: 'scorekeeper', grants: ['scorekeeper-1'] }),
            expect.objectContaining({ key: 'videographer', grants: ['video-1', 'video@example.com'] }),
            expect.objectContaining({ key: 'volunteer', grants: ['snacks-1'] })
        ]);
    });

    it('renders distinct empty states and hides from non-admin members', () => {
        const hiddenClasses = new Set();
        const container = {
            innerHTML: '',
            classList: {
                add: (name) => hiddenClasses.add(name),
                remove: (name) => hiddenClasses.delete(name),
                contains: (name) => hiddenClasses.has(name)
            }
        };

        renderTeamStaffPermissionsSection(container, {
            team: { id: 'team-1', ownerId: '', adminEmails: [] },
            pendingAdminInvites: [],
            canManage: false
        });

        expect(container.classList.contains('hidden')).toBe(true);
        expect(container.innerHTML).toBe('');

        renderTeamStaffPermissionsSection(container, {
            team: { id: 'team-1', ownerId: '', adminEmails: [] },
            pendingAdminInvites: [],
            canManage: true
        });

        expect(container.classList.contains('hidden')).toBe(false);
        expect(container.innerHTML).toContain('No owner, admin staff, or pending admin invites found.');
        expect(container.innerHTML).toContain('No scorekeeper helpers are assigned yet.');
        expect(container.innerHTML).toContain('No videographer helpers are assigned yet.');
        expect(container.innerHTML).toContain('No general volunteer permissions are assigned yet.');
        expect(container.innerHTML).toContain('Full staff admin access is separate from scoped game-day helper permissions');
    });
});
