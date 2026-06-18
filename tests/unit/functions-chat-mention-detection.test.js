import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
const notifyTeamChatMessageCreatedSource = functionsSource.slice(
    functionsSource.indexOf('exports.notifyTeamChatMessageCreated = functions.firestore'),
    functionsSource.indexOf('\nexports.postSharedGameCancellationNotification')
);

function getDetectMentionedUids() {
    const start = functionsSource.indexOf('function detectMentionedUids(');
    const end = functionsSource.indexOf('\nasync function buildTeamChatNotificationContext');
    const slice = functionsSource.slice(start, end);
    return new Function(`${slice}; return detectMentionedUids;`)();
}

function getBuildTeamChatNotificationPlan() {
    const start = functionsSource.indexOf('function buildTeamChatNotificationPlan(');
    const end = functionsSource.indexOf('\nexports.notifyTeamChatMessageCreated');
    const slice = functionsSource.slice(start, end);
    return new Function('detectMentionedUids', `${slice}; return buildTeamChatNotificationPlan;`)(detectMentionedUids);
}

const detectMentionedUids = getDetectMentionedUids();
const buildTeamChatNotificationPlan = getBuildTeamChatNotificationPlan();

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
        expect(notifyTeamChatMessageCreatedSource).toContain("exports.notifyTeamChatMessageCreated = functions.firestore");
        expect(notifyTeamChatMessageCreatedSource).toContain(".document('teams/{teamId}/chatMessages/{messageId}')");
    });

    it('stores mentionedUids on the message document', () => {
        expect(notifyTeamChatMessageCreatedSource).toContain('snapshot.ref.update({ mentionedUids })');
    });

    it('builds one shared recipient context for mentions and live chat delivery', () => {
        expect(notifyTeamChatMessageCreatedSource).toContain('const recipientContext = await buildTeamChatNotificationContext(teamId);');
        expect(notifyTeamChatMessageCreatedSource).toContain('const notificationPlan = buildTeamChatNotificationPlan({');
        expect(notifyTeamChatMessageCreatedSource).not.toContain('const candidateUsers = await getCandidateUsersForTeam(teamId);');
        expect(notifyTeamChatMessageCreatedSource).not.toContain('await getMutedUserIdsForTeam(');
        expect(notifyTeamChatMessageCreatedSource).not.toContain('const userSnap = await firestore.doc(`users/${uid}`).get();');
    });

    it('sends a mentions-category notification for mentioned users', () => {
        expect(notifyTeamChatMessageCreatedSource).toContain("category: 'mentions'");
        expect(notifyTeamChatMessageCreatedSource).toContain('mentioned you');
    });

    it('sends a liveChat notification directly from the shared recipient plan', () => {
        expect(notifyTeamChatMessageCreatedSource).toContain("category: 'liveChat'");
        expect(notifyTeamChatMessageCreatedSource).toContain('targets: notificationPlan.liveChatTargets');
    });

    it('preloads user records in batches instead of one users/{uid} read per recipient', () => {
        expect(functionsSource).toContain('async function getUserRecordsByIds(userIds)');
        expect(functionsSource).toContain('const snaps = await firestore.getAll(...refs);');
    });
});

describe('buildTeamChatNotificationPlan', () => {
    it('reuses one preloaded context for mentions, muted-user exclusion, and live chat exclusion', () => {
        const plan = buildTeamChatNotificationPlan({
            text: 'Great work @alice and @bob',
            actorUid: 'coach-1',
            recipientContext: {
                members: [
                    { uid: 'coach-1', displayName: 'Coach Kim' },
                    { uid: 'u1', displayName: 'Alice' },
                    { uid: 'u2', displayName: 'Bob' },
                    { uid: 'u3', displayName: 'Cara' },
                    { uid: 'u4', displayName: 'Dan' }
                ],
                mutedUids: ['u3'],
                targetsByCategory: {
                    mentions: [
                        { uid: 'u1', token: 'mention-1' },
                        { uid: 'u2', token: 'mention-2' },
                        { uid: 'u3', token: 'mention-3' }
                    ],
                    liveChat: [
                        { uid: 'coach-1', token: 'chat-coach' },
                        { uid: 'u1', token: 'chat-1' },
                        { uid: 'u2', token: 'chat-2' },
                        { uid: 'u3', token: 'chat-3' },
                        { uid: 'u4', token: 'chat-4' }
                    ]
                }
            }
        });

        expect(plan.mentionedUids.sort()).toEqual(['u1', 'u2']);
        expect(plan.mentionTargets.map((target) => target.uid).sort()).toEqual(['u1', 'u2']);
        expect(plan.liveChatTargets.map((target) => target.uid)).toEqual(['u4']);
    });

    it('handles a large mixed team fixture from one preloaded recipient context', () => {
        const mentionedUserIds = ['user-12', 'user-87', 'user-301'];
        const members = Array.from({ length: 500 }, (_, index) => ({
            uid: `user-${index}`,
            displayName: `Player ${index}`
        }));
        members[12].displayName = 'Alice';
        members[87].displayName = 'Bob Smith';
        members[301].displayName = 'Carol';

        const liveChatTargets = members.map((member) => ({ uid: member.uid, token: `live-${member.uid}` }));
        const mentionTargets = members
            .filter((member) => mentionedUserIds.includes(member.uid))
            .map((member) => ({ uid: member.uid, token: `mention-${member.uid}` }));

        const plan = buildTeamChatNotificationPlan({
            text: 'Nice work @alice @bob @carol',
            actorUid: 'user-0',
            recipientContext: {
                members,
                mutedUids: ['user-111', 'user-222'],
                targetsByCategory: {
                    mentions: mentionTargets,
                    liveChat: liveChatTargets
                }
            }
        });

        expect(plan.mentionedUids.sort()).toEqual(mentionedUserIds.sort());
        expect(plan.mentionTargets).toHaveLength(3);
        expect(plan.liveChatTargets).toHaveLength(494);
        expect(plan.liveChatTargets.some((target) => target.uid === 'user-0')).toBe(false);
        expect(plan.liveChatTargets.some((target) => target.uid === 'user-111')).toBe(false);
        expect(plan.liveChatTargets.some((target) => target.uid === 'user-222')).toBe(false);
        expect(plan.liveChatTargets.some((target) => mentionedUserIds.includes(target.uid))).toBe(false);
    });
});
