import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

function getHelper(name, nextMarker) {
    const start = functionsSource.indexOf(`function ${name}(`);
    const end = functionsSource.indexOf(`\n${nextMarker}`);
    const slice = functionsSource.slice(start, end);
    return new Function(`${slice}; return ${name};`)();
}

const getFeeReminderPlayerKey = getHelper('getFeeReminderPlayerKey', 'function buildFeeReminderCandidateUserIds');
const buildFeeReminderCandidateUserIds = getHelper('buildFeeReminderCandidateUserIds', 'async function resolveFeeReminderCandidateUserIds');

describe('fee due reminder helper logic', () => {
    it('builds a player key from team and player ids when the recipient does not store one', () => {
        expect(getFeeReminderPlayerKey({ playerId: 'player-1' }, 'team-1')).toBe('team-1::player-1');
        expect(getFeeReminderPlayerKey({ childId: 'player-2', teamId: 'team-2' }, '')).toBe('team-2::player-2');
    });

    it('preserves an explicit playerKey when present', () => {
        expect(getFeeReminderPlayerKey({ playerKey: 'team-9::player-9', playerId: 'ignored' }, 'team-1')).toBe('team-9::player-9');
    });

    it('merges direct payer ids with player-linked owner ids and removes blanks or duplicates', () => {
        expect(buildFeeReminderCandidateUserIds({
            userId: 'user-1',
            accountUserId: 'user-2',
            parentUserId: 'user-1'
        }, ['user-3', '', 'user-2'])).toEqual(['user-1', 'user-2', 'user-3']);
    });
});

describe('fee due reminder source wiring', () => {
    it('queries fee recipients using the stored status and dueDate fields', () => {
        expect(functionsSource).toContain(".where('status', 'in', ['unpaid', 'pending'])");
        expect(functionsSource).toContain(".where('dueDate', '>=', now)");
        expect(functionsSource).toContain(".where('dueDate', '<=', threeDaysLater)");
    });

    it('resolves player-linked parents before deciding whether to mark the reminder as sent', () => {
        expect(functionsSource).toContain(".where('parentPlayerKeys', 'array-contains', playerKey)");
        expect(functionsSource).toContain('const candidateUserIds = await resolveFeeReminderCandidateUserIds(teamId, data);');
        expect(functionsSource).toContain('const candidateUserIdSet = new Set(candidateUserIds);');
        expect(functionsSource).toContain('await doc.ref.update({ reminderSentAt: admin.firestore.FieldValue.serverTimestamp() });');
    });
});
