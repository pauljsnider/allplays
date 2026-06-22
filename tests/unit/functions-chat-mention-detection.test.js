import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
const notifyTeamChatMessageCreatedSource = functionsSource.slice(
    functionsSource.indexOf('exports.notifyTeamChatMessageCreated = functions.firestore'),
    functionsSource.indexOf('\nexports.postSharedGameCancellationNotification')
);
const handleTeamChatMessageCreatedSource = functionsSource.slice(
    functionsSource.indexOf('async function handleTeamChatMessageCreated(snapshot, context) {'),
    functionsSource.indexOf('\nexports.notifyTeamChatMessageCreated = functions.firestore')
);

function getDetectMentionedUids() {
    const start = functionsSource.indexOf('const teamChatMentionStartRegex =');
    const end = functionsSource.indexOf('\nasync function buildTeamChatNotificationContext');
    const slice = functionsSource.slice(start, end);
    return new Function(`${slice}; return detectMentionedUids;`)();
}

function getBuildTeamChatNotificationContext() {
    const start = functionsSource.indexOf('function normalizeTeamChatConversationId(');
    const end = functionsSource.indexOf('\nfunction buildTeamChatNotificationPlan');
    const slice = functionsSource.slice(start, end);
    return new Function(
        'firestore',
        'getUserIdsByEmails',
        'getUserRecordsByIds',
        'notificationAudienceAllowsRoles',
        'getLegacyTargetsForCategory',
        `${slice}; return buildTeamChatNotificationContext;`
    );
}

function getBuildTeamChatNotificationPlan() {
    const start = functionsSource.indexOf('function dedupeNotificationTargetsByUserDevice(');
    const end = functionsSource.indexOf('\nexports.notifyTeamChatMessageCreated');
    const slice = functionsSource.slice(start, end);
    return new Function('detectMentionedUids', `${slice}; return buildTeamChatNotificationPlan;`)(detectMentionedUids);
}

function getNotificationDestinationBuilders() {
    const start = functionsSource.indexOf('function buildScheduleSectionQuery(');
    const end = functionsSource.indexOf('\nfunction normalizeAccessNotificationStatus');
    const slice = functionsSource.slice(start, end);
    return new Function(`${slice}; return { buildNotificationLink, buildNotificationAppRoute };`)();
}

const detectMentionedUids = getDetectMentionedUids();
const buildTeamChatNotificationPlan = getBuildTeamChatNotificationPlan();
const { buildNotificationLink, buildNotificationAppRoute } = getNotificationDestinationBuilders();

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

    it('matches a rostered multi-word display name exactly', () => {
        const members = [{ uid: 'u2', displayName: 'Bob Smith' }];
        expect(detectMentionedUids('Good work @Bob Smith!', members)).toEqual(['u2']);
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
        const result = detectMentionedUids('Heads up @all!', members, { allowReservedMentions: true });
        expect(result.sort()).toEqual(['u1', 'u2', 'u3']);
    });

    it('@team returns all member UIDs', () => {
        const members = [
            { uid: 'u1', displayName: 'Alice' },
            { uid: 'u2', displayName: 'Bob' }
        ];
        const result = detectMentionedUids('Hey @team listen up', members, { allowReservedMentions: true });
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

    it('does not treat partial strings as exact @mentions', () => {
        const members = [{ uid: 'u1', displayName: 'Alice' }];
        expect(detectMentionedUids('Hello @ali', members)).toEqual([]);
    });

    it('falls back to name field when displayName is missing', () => {
        const members = [{ uid: 'u5', displayName: '', name: 'Eve' }];
        expect(detectMentionedUids('Hey @eve!', members)).toEqual(['u5']);
    });

    it('ignores reserved tokens unless the caller explicitly allows them', () => {
        const members = [
            { uid: 'u1', displayName: 'Alice' },
            { uid: 'u2', displayName: 'Bob' }
        ];
        expect(detectMentionedUids('Heads up @all', members)).toEqual([]);
        expect(detectMentionedUids('Heads up @team', members, { allowReservedMentions: true }).sort()).toEqual(['u1', 'u2']);
    });
});

describe('buildTeamChatNotificationContext', () => {
    function createTeamChatNotificationContextHarness({ conversationDocs = {}, emailUserIds = ['assistant-1'] } = {}) {
        const teamData = { ownerId: 'coach-1', adminEmails: ['assistant@example.com'] };
        const parentDocs = [{ id: 'parent-1' }];
        const targetDocs = [
            {
                data: () => ({ uid: 'coach-1', deviceId: 'device-1', token: 'token-1', categories: { mentions: true, liveChat: true } })
            },
            {
                data: () => ({ uid: 'assistant-1', deviceId: 'device-2', token: 'token-2', categories: { mentions: true, liveChat: true } })
            },
            {
                data: () => ({ uid: 'parent-1', deviceId: 'device-3', token: 'token-3', categories: { mentions: true, liveChat: true } })
            }
        ];

        const firestore = {
            doc: (path) => ({
                get: async () => {
                    if (path === 'teams/team-1') {
                        return { exists: true, data: () => teamData };
                    }
                    if (conversationDocs[path]) {
                        return { exists: true, data: () => conversationDocs[path] };
                    }
                    return { exists: false, data: () => null };
                }
            }),
            collection: (path) => {
                if (path === 'users') {
                    return {
                        where: () => ({
                            get: async () => ({ forEach: (callback) => parentDocs.forEach((doc) => callback(doc)) })
                        })
                    };
                }
                if (path === 'teams/team-1/notificationTargets') {
                    return {
                        get: async () => ({ forEach: (callback) => targetDocs.forEach((doc) => callback(doc)) })
                    };
                }
                throw new Error(`Unexpected collection path: ${path}`);
            }
        };

        const factory = getBuildTeamChatNotificationContext();
        return factory(
            firestore,
            async (emails = []) => {
                const normalized = Array.isArray(emails) ? emails.map((email) => String(email || '').trim().toLowerCase()).sort() : [];
                if (normalized.length === 1 && normalized[0] === 'assistant@example.com') return ['assistant-1'];
                if (normalized.length === 1 && normalized[0] === 'parent@example.com') return ['parent-1'];
                return emailUserIds;
            },
            async () => new Map([
                ['coach-1', { displayName: 'Coach Kim', teamChatState: { 'team-1': { mutedConversations: { staff: { seconds: 1 } } } } }],
                ['assistant-1', { displayName: 'Assistant Lee', chatMuted: { 'team-1': { seconds: 2 } } }],
                ['parent-1', { displayName: 'Pat Parent', teamChatState: { 'team-1': { mutedConversations: { team: { seconds: 3 } } } } }]
            ]),
            (category, roles = []) => category === 'mentions' || roles.includes('parent') || roles.includes('staff'),
            async () => []
        );
    }

    it('uses per-conversation mute state before falling back to team-wide chatMuted', async () => {
        const buildTeamChatNotificationContext = createTeamChatNotificationContextHarness({
            conversationDocs: {
                'teams/team-1/chatConversations/staff': {
                    participantRoles: ['staff'],
                    participantIds: ['coach-1']
                }
            }
        });

        const teamConversationContext = await buildTeamChatNotificationContext('team-1', {
            includeMentions: true,
            conversationId: null
        });
        const staffConversationContext = await buildTeamChatNotificationContext('team-1', {
            includeMentions: true,
            conversationId: 'staff'
        });

        expect(teamConversationContext.mutedUids.sort()).toEqual(['assistant-1', 'parent-1']);
        expect(staffConversationContext.mutedUids).toEqual(['coach-1']);
        expect(staffConversationContext.members.map((member) => member.uid).sort()).toEqual(['assistant-1', 'coach-1']);
    });

    it('limits conversation-scoped notifications to conversation participants', async () => {
        const buildTeamChatNotificationContext = createTeamChatNotificationContextHarness({
            conversationDocs: {
                'teams/team-1/chatConversations/direct_coach_parent': {
                    participantIds: ['coach-1', 'parent-1']
                }
            }
        });

        const context = await buildTeamChatNotificationContext('team-1', {
            includeMentions: true,
            conversationId: 'direct_coach_parent',
            targetType: 'individuals',
            recipientIds: ['coach-1', 'parent-1']
        });

        expect(context.members.map((member) => member.uid).sort()).toEqual(['coach-1', 'parent-1']);
        expect(context.targetsByCategory.mentions.map((target) => target.uid).sort()).toEqual(['coach-1', 'parent-1']);
        expect(context.targetsByCategory.liveChat.map((target) => target.uid).sort()).toEqual(['coach-1', 'parent-1']);
    });
});

describe('notifyTeamChatMessageCreated source wiring', () => {
    it('exports the notifyTeamChatMessageCreated Firestore trigger', () => {
        expect(notifyTeamChatMessageCreatedSource).toContain("exports.notifyTeamChatMessageCreated = functions.firestore");
        expect(notifyTeamChatMessageCreatedSource).toContain(".document('teams/{teamId}/chatMessages/{messageId}')");
    });

    it('stores mentionedUids on the message document', () => {
        expect(handleTeamChatMessageCreatedSource).toContain('await snapshot.ref.update({ mentionedUids });');
    });

    it('builds one shared recipient context for mentions and live chat delivery', () => {
        expect(handleTeamChatMessageCreatedSource).toContain('const shouldResolveMentions = Boolean(text);');
        expect(handleTeamChatMessageCreatedSource).toContain('const conversationId = normalizeTeamChatConversationId(data.conversationId || context.params.conversationId);');
        expect(handleTeamChatMessageCreatedSource).toContain('const recipientContext = await buildTeamChatNotificationContext(teamId, {');
        expect(handleTeamChatMessageCreatedSource).toContain('includeMentions: shouldResolveMentions');
        expect(handleTeamChatMessageCreatedSource).toContain('conversationId');
        expect(handleTeamChatMessageCreatedSource).toContain('targetType: data.targetType');
        expect(handleTeamChatMessageCreatedSource).toContain('recipientIds: data.recipientIds');
        expect(handleTeamChatMessageCreatedSource).toContain('const notificationPlan = buildTeamChatNotificationPlan({');
        expect(notifyTeamChatMessageCreatedSource).not.toContain('const candidateUsers = await getCandidateUsersForTeam(teamId);');
        expect(notifyTeamChatMessageCreatedSource).not.toContain('await getMutedUserIdsForTeam(');
        expect(notifyTeamChatMessageCreatedSource).not.toContain('const userSnap = await firestore.doc(`users/${uid}`).get();');
    });

    it('reuses the same create handler for conversation-scoped chat message documents', () => {
        expect(functionsSource).toContain("exports.notifyConversationChatMessageCreated = functions.firestore");
        expect(functionsSource).toContain(".document('teams/{teamId}/chatConversations/{conversationId}/chatMessages/{messageId}')");
        expect(functionsSource).toContain('.onCreate(handleTeamChatMessageCreated);');
    });

    it('sends a mentions-category notification for mentioned users', () => {
        expect(handleTeamChatMessageCreatedSource).toContain("category: 'mentions'");
        expect(handleTeamChatMessageCreatedSource).toContain('mentioned you');
    });

    it('sends a liveChat notification directly from the shared recipient plan', () => {
        expect(handleTeamChatMessageCreatedSource).toContain("category: 'liveChat'");
        expect(handleTeamChatMessageCreatedSource).toContain('targets: notificationPlan.liveChatTargets');
    });

    it('preloads user records in batches instead of one users/{uid} read per recipient', () => {
        expect(functionsSource).toContain('async function getUserRecordsByIds(userIds)');
        expect(functionsSource).toContain('const snaps = await firestore.getAll(...refs);');
    });

    it('skips mention target resolution for photo-only chats', () => {
        expect(functionsSource).toContain("const categories = includeMentions ? ['mentions', 'liveChat'] : ['liveChat'];");
        expect(functionsSource).toContain("displayName: includeMentions");
    });

    it('includes the conversation deep-link target in both mention and live chat payloads', () => {
        expect(notifyTeamChatMessageCreatedSource).toContain('conversationId');
        expect(functionsSource).toContain('conversationId: String(conversationId || \'\')');
        expect(functionsSource).toContain('return `${route}?conversation=${encodeURIComponent(conversationId)}`;');
        expect(functionsSource).toContain('return `${route}?conversationId=${encodeURIComponent(conversationId)}`;');
    });
});

describe('chat mention notification destinations', () => {
    it('builds legacy and app deep links for mentioned conversation notifications', () => {
        expect(buildNotificationLink({
            category: 'mentions',
            teamId: 'team 1',
            conversationId: 'direct/user?2'
        })).toBe('https://allplays.ai/team-chat.html?teamId=team%201&conversationId=direct%2Fuser%3F2');
        expect(buildNotificationAppRoute({
            category: 'mentions',
            teamId: 'team 1',
            conversationId: 'direct/user?2'
        })).toBe('/messages/team%201?conversation=direct%2Fuser%3F2');
    });

    it('keeps team-wide mention notifications on the default message route', () => {
        expect(buildNotificationLink({
            category: 'mentions',
            teamId: 'team-1',
            conversationId: ''
        })).toBe('https://allplays.ai/team-chat.html?teamId=team-1');
        expect(buildNotificationAppRoute({
            category: 'mentions',
            teamId: 'team-1',
            conversationId: ''
        })).toBe('/messages/team-1');
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
                        { uid: 'u1', token: 'mention-1' },
                        { uid: 'u2', token: 'mention-2' },
                        { uid: 'u3', token: 'mention-3' }
                    ],
                    liveChat: [
                        { uid: 'coach-1', token: 'chat-coach' },
                        { uid: 'u1', token: 'chat-1' },
                        { uid: 'u2', token: 'chat-2' },
                        { uid: 'u3', token: 'chat-3' },
                        { uid: 'u4', token: 'chat-4' },
                        { uid: 'u4', token: 'chat-4' }
                    ]
                }
            }
        });

        expect(plan.mentionedUids.sort()).toEqual(['u1', 'u2']);
        expect(plan.mentionTargets.map((target) => target.uid).sort()).toEqual(['u1', 'u2']);
        expect(plan.liveChatTargets.map((target) => target.uid)).toEqual(['u4']);
        expect(plan.mentionTargets).toHaveLength(2);
        expect(plan.liveChatTargets).toHaveLength(1);
    });

    it('excludes every live-chat device for mentioned users while preserving mention devices', () => {
        const plan = buildTeamChatNotificationPlan({
            text: 'Can you check this @alice?',
            actorUid: 'coach-1',
            recipientContext: {
                members: [
                    { uid: 'coach-1', displayName: 'Coach Kim', roles: ['staff'] },
                    { uid: 'alice-parent', displayName: 'Alice Parent', roles: ['parent'] },
                    { uid: 'blair-parent', displayName: 'Blair Parent', roles: ['parent'] }
                ],
                mutedUids: [],
                targetsByCategory: {
                    mentions: [
                        { uid: 'alice-parent', deviceId: 'phone', token: 'mention-phone' },
                        { uid: 'alice-parent', deviceId: 'tablet', token: 'mention-tablet' }
                    ],
                    liveChat: [
                        { uid: 'coach-1', deviceId: 'phone', token: 'coach-chat' },
                        { uid: 'alice-parent', deviceId: 'phone', token: 'alice-chat-phone' },
                        { uid: 'alice-parent', deviceId: 'tablet', token: 'alice-chat-tablet' },
                        { uid: 'blair-parent', deviceId: 'phone', token: 'blair-chat' }
                    ]
                }
            }
        });

        expect(plan.mentionedUids).toEqual(['alice-parent']);
        expect(plan.mentionTargets.map((target) => target.token).sort()).toEqual(['mention-phone', 'mention-tablet']);
        expect(plan.liveChatTargets.map((target) => target.uid)).toEqual(['blair-parent']);
        expect(plan.liveChatTargets.some((target) => target.uid === 'alice-parent')).toBe(false);
    });

    it('deduplicates mentioned users out of generic live chat pushes across devices', () => {
        const plan = buildTeamChatNotificationPlan({
            text: '@Alice check the jersey note',
            actorUid: 'coach-1',
            recipientContext: {
                members: [
                    { uid: 'coach-1', displayName: 'Coach Kim', roles: ['staff'] },
                    { uid: 'u1', displayName: 'Alice Parent', roles: ['parent'] },
                    { uid: 'u2', displayName: 'Blair Parent', roles: ['parent'] }
                ],
                mutedUids: [],
                targetsByCategory: {
                    mentions: [
                        { uid: 'u1', deviceId: 'ios', token: 'mention-ios' },
                        { uid: 'u1', deviceId: 'web', token: 'mention-web' },
                        { uid: 'u1', deviceId: 'web', token: 'mention-web' }
                    ],
                    liveChat: [
                        { uid: 'u1', deviceId: 'ios', token: 'chat-ios' },
                        { uid: 'u1', deviceId: 'web', token: 'chat-web' },
                        { uid: 'u2', deviceId: 'ios', token: 'chat-u2' }
                    ]
                }
            }
        });

        expect(plan.mentionedUids).toEqual(['u1']);
        expect(plan.mentionTargets.map((target) => `${target.uid}:${target.deviceId}`).sort()).toEqual(['u1:ios', 'u1:web']);
        expect(plan.liveChatTargets.map((target) => target.uid)).toEqual(['u2']);
    });

    it('suppresses muted conversation participants from generic photo-only chat pushes', () => {
        const plan = buildTeamChatNotificationPlan({
            text: '',
            actorUid: 'coach-1',
            recipientContext: {
                members: [
                    { uid: 'coach-1', displayName: 'Coach Kim', roles: ['staff'] },
                    { uid: 'muted-parent', displayName: 'Muted Parent', roles: ['parent'] },
                    { uid: 'active-parent', displayName: 'Active Parent', roles: ['parent'] }
                ],
                mutedUids: ['muted-parent'],
                targetsByCategory: {
                    mentions: [],
                    liveChat: [
                        { uid: 'coach-1', deviceId: 'phone', token: 'coach-chat' },
                        { uid: 'muted-parent', deviceId: 'phone', token: 'muted-chat' },
                        { uid: 'active-parent', deviceId: 'phone', token: 'active-chat' }
                    ]
                }
            }
        });

        expect(plan.mentionedUids).toEqual([]);
        expect(plan.mentionTargets).toEqual([]);
        expect(plan.liveChatTargets.map((target) => target.uid)).toEqual(['active-parent']);
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

    it('honors reserved @team mentions only for staff senders and still dedupes live chat', () => {
        const recipientContext = {
            members: [
                { uid: 'coach-1', displayName: 'Coach Kim', roles: ['staff'] },
                { uid: 'player-1', displayName: 'Alex', roles: ['parent'] },
                { uid: 'player-2', displayName: 'Blair', roles: ['parent'] }
            ],
            mutedUids: [],
            targetsByCategory: {
                mentions: [
                    { uid: 'player-1', token: 'mention-1' },
                    { uid: 'player-2', token: 'mention-2' }
                ],
                liveChat: [
                    { uid: 'player-1', token: 'chat-1' },
                    { uid: 'player-2', token: 'chat-2' }
                ]
            }
        };

        const staffPlan = buildTeamChatNotificationPlan({
            text: 'Heads up @team',
            actorUid: 'coach-1',
            recipientContext
        });
        const parentPlan = buildTeamChatNotificationPlan({
            text: 'Heads up @team',
            actorUid: 'player-1',
            recipientContext
        });

        expect(staffPlan.mentionedUids.sort()).toEqual(['player-1', 'player-2']);
        expect(staffPlan.liveChatTargets).toEqual([]);
        expect(parentPlan.mentionedUids).toEqual([]);
        expect(parentPlan.liveChatTargets.map((target) => target.uid).sort()).toEqual(['player-2']);
    });
});
