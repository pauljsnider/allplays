import { describe, it, expect } from 'vitest';
import { buildRolloverAccessPreview, buildStaffAdminRolloverUpdate } from '../../js/rollover-access.js';

describe('rollover access helpers', () => {
    it('shows eligible staff/admin emails without target duplicates', () => {
        const preview = buildRolloverAccessPreview(
            { id: 'source-1', adminEmails: ['Coach@Example.com', 'coach@example.com', 'asst@example.com'] },
            { adminEmails: ['ASST@example.com'] }
        );

        expect(preview.staffAdmins).toEqual([
            { email: 'coach@example.com', sourceTeamId: 'source-1' }
        ]);
        expect(preview.memberAccessSupported).toBe(false);
    });

    it('copies selected staff/admin emails with audit metadata only once', () => {
        const rolledOverAt = new Date('2026-04-27T16:00:00.000Z');
        const update = buildStaffAdminRolloverUpdate({
            sourceTeam: { id: 'source-1', adminEmails: ['coach@example.com', 'asst@example.com'] },
            targetTeam: { adminEmails: ['coach@example.com'] },
            selectedEmails: ['coach@example.com', 'asst@example.com', 'other@example.com'],
            rolledOverAt
        });

        expect(update.adminEmails).toEqual(['coach@example.com', 'asst@example.com']);
        expect(update.copiedEmails).toEqual(['asst@example.com']);
        expect(update.accessRolloverAudit.staffAdmins).toEqual([
            {
                email: 'asst@example.com',
                sourceTeamId: 'source-1',
                rolledOverAt
            }
        ]);
    });

    it('preserves existing rollover audit records', () => {
        const previous = { email: 'old@example.com', sourceTeamId: 'source-0', rolledOverAt: 'then' };
        const update = buildStaffAdminRolloverUpdate({
            sourceTeam: { id: 'source-1', adminEmails: ['new@example.com'] },
            targetTeam: {
                adminEmails: [],
                accessRolloverAudit: { staffAdmins: [previous] }
            },
            selectedEmails: ['new@example.com'],
            rolledOverAt: 'now'
        });

        expect(update.accessRolloverAudit.staffAdmins).toEqual([
            previous,
            { email: 'new@example.com', sourceTeamId: 'source-1', rolledOverAt: 'now' }
        ]);
    });
});
