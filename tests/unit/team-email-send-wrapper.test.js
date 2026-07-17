import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
const sendTeamEmailSource = dbSource.slice(
    dbSource.indexOf('export async function sendTeamEmail'),
    dbSource.indexOf('export async function syncRegistrationProvider')
);

function loadSendTeamEmail(httpsCallable) {
    return new Function(
        'httpsCallable',
        'functions',
        `${sendTeamEmailSource.replace('export ', '')}; return sendTeamEmail;`
    )(httpsCallable, {});
}

describe('sendTeamEmail callable wrapper', () => {
    it('omits the default audience when sending a saved draft', async () => {
        const callable = vi.fn().mockResolvedValue({ data: { recipientCount: 1 } });
        const httpsCallable = vi.fn(() => callable);
        const sendTeamEmail = loadSendTeamEmail(httpsCallable);

        await sendTeamEmail('team-1', { draftId: 'draft-1' });

        expect(httpsCallable).toHaveBeenCalledWith({}, 'sendTeamEmail');
        expect(callable).toHaveBeenCalledOnce();
        expect(callable.mock.calls[0][0]).not.toHaveProperty('targetType');
        expect(callable.mock.calls[0][0]).toMatchObject({
            teamId: 'team-1',
            draftId: 'draft-1',
            recipientIds: [],
            attachments: []
        });
    });

    it('preserves an explicitly selected audience', async () => {
        const callable = vi.fn().mockResolvedValue({ data: { recipientCount: 1 } });
        const sendTeamEmail = loadSendTeamEmail(vi.fn(() => callable));

        await sendTeamEmail('team-1', {
            subject: 'Update',
            body: 'Practice moved.',
            targetType: 'individuals',
            recipientIds: ['player:p1']
        });

        expect(callable.mock.calls[0][0]).toMatchObject({
            targetType: 'individuals',
            recipientIds: ['player:p1']
        });
    });
});
