import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

function getDetectMentionedUids() {
    const start = functionsSource.indexOf('function detectMentionedUids(');
    const end = functionsSource.indexOf('\nexports.notifyTeamChatMessageCreated');
    const slice = functionsSource.slice(start, end);
    return new Function(`${slice}; return detectMentionedUids;`)();
}

const detectMentionedUids = getDetectMentionedUids();

describe('detectMentionedUids', () => {
    it('returns empty array when text is empty or null', () => {
        const members = [{ uid: 'u1', displayName: 'Alice' }];
        expect(detectMentionedUids('', members)).toEqual([]);
        expect(detectMentionedUids(null, members)).toEqual([]);
        expect(detectMentionedUids(undefined, members)).toEqual([]);
    });

    it('returns empty array when no @mentions are in the text', () => {
        const members = [{ uid: 'u1', displayName: 'Alice' }];
        expect(detectMentionedUids('Great practice today!', members)).toEqual([]);
    });

    it('detects a single @mention by compact display name', () => {
        const members = [{ uid: 'u1', displayName: 'Alice' }];
        expect(detectMentionedUids('Hey @alice nice job!', members)).toEqual(['u1']);
    });

    it('matches by first name when display name has a last name', () => {
        const members = [{ uid: 'u2', displayName: 'Bob Smith' }];
        expect(detectMentionedUids('Good work @bob!', members)).toEqual(['u2']);
    });

    it('matches compacted full name with no spaces', () => {
        const members = [{ uid: 'u3', displayName: 'Carol Jones' }];
        expect(detectMentionedUids('See you @CarolJones', members)).toEqual(['u3']);
    });

    it('is case-insensitive when matching names', () => {
        const members = [{ uid: 'u4', displayName: 'Dave' }];
        expect(detectMentionedUids('Hi @DAVE', members)).toEqual(['u4']);
        expect(detectMentionedUids('Hi @Dave', members)).toEqual(['u4']);
        expect(detectMentionedUids('Hi @dave', members)).toEqual(['u4']);
    });

    it('@all returns all member UIDs', () => {
        const members = [
            { uid: 'u1', displayName: 'Alice' },
            { uid: 'u2', displayName: 'Bob' },
            { uid: 'u3', displayName: 'Carol' }
        ];
        const result = detectMentionedUids('Heads up @all!', members);
        expect(result.sort()).toEqual(['u1', 'u2', 'u3']);
    });

    it('@team returns all member UIDs', () => {
        const members = [
            { uid: 'u1', displayName: 'Alice' },
            { uid: 'u2', displayName: 'Bob' }
        ];
        const result = detectMentionedUids('Hey @team listen up', members);
        expect(result.sort()).toEqual(['u1', 'u2']);
    });

    it('detects multiple distinct @mentions', () => {
        const members = [
            { uid: 'u1', displayName: 'Alice' },
            { uid: 'u2', displayName: 'Bob' },
            { uid: 'u3', displayName: 'Carol' }
        ];
        const result = detectMentionedUids('@alice and @bob great game!', members);
        expect(result.sort()).toEqual(['u1', 'u2']);
    });

    it('does not duplicate a UID when the same person is mentioned twice', () => {
        const members = [{ uid: 'u1', displayName: 'Alice' }];
        const result = detectMentionedUids('@alice and @Alice again', members);
        expect(result).toEqual(['u1']);
    });

    it('returns empty array when @mention token does not match any member', () => {
        const members = [{ uid: 'u1', displayName: 'Alice' }];
        expect(detectMentionedUids('Hello @unknown', members)).toEqual([]);
    });

    it('falls back to name field when displayName is missing', () => {
        const members = [{ uid: 'u5', displayName: '', name: 'Eve' }];
        expect(detectMentionedUids('Hey @eve!', members)).toEqual(['u5']);
    });
});

describe('notifyTeamChatMessageCreated source wiring', () => {
    it('exports the notifyTeamChatMessageCreated Firestore trigger', () => {
        expect(functionsSource).toContain("exports.notifyTeamChatMessageCreated = functions.firestore");
        expect(functionsSource).toContain(".document('teams/{teamId}/chatMessages/{messageId}')");
    });

    it('stores mentionedUids on the message document', () => {
        expect(functionsSource).toContain('snapshot.ref.update({ mentionedUids })');
    });

    it('reuses the existing candidate-user lookup for mention matching', () => {
        expect(functionsSource).toContain('const candidateUsers = await getCandidateUsersForTeam(teamId);');
        expect(functionsSource).toContain('const candidateUids = candidateUsers.map((user) => user.uid);');
        expect(functionsSource).not.toContain('getCandidateUserIdsForTeam');
    });

    it('sends a mentions-category notification for mentioned users', () => {
        expect(functionsSource).toContain("category: 'mentions'");
        expect(functionsSource).toContain('mentioned you');
    });

    it('sends a liveChat notification with excludeUids to skip mentioned and muted users', () => {
        expect(functionsSource).toContain("category: 'liveChat'");
        expect(functionsSource).toContain('excludeUids: [...new Set([...mentionedUids, ...mutedUids])]');
    });

    it('sendCategoryNotification accepts excludeUids parameter', () => {
        expect(functionsSource).toContain('excludeUids = []');
        expect(functionsSource).toContain('excludeSet.has(t.uid)');
    });
});
