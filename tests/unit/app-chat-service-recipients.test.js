// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAppDataCache } from '../../apps/app/src/lib/appDataCache.ts';

const dbMocks = vi.hoisted(() => ({
    canAccessTeamChat: vi.fn(),
    canModerateChat: vi.fn(),
    deleteChatMessage: vi.fn(),
    deleteUploadedChatAttachments: vi.fn(),
    editChatMessage: vi.fn(),
    getAggregatedStatsForGames: vi.fn(),
    getChatConversations: vi.fn(),
    getChatMessages: vi.fn(),
    getGameEvents: vi.fn(),
    getGames: vi.fn(),
    getParentTeams: vi.fn(),
    getPlayers: vi.fn(),
    getSentTeamEmails: vi.fn(),
    getTeamEmailDrafts: vi.fn(),
    getTeamEmailTemplates: vi.fn(),
    getTeam: vi.fn(),
    getUnreadChatCounts: vi.fn(),
    getUserByEmail: vi.fn(),
    getUsersByParentPlayerKey: vi.fn(),
    getUserProfile: vi.fn(),
    getUserTeamsWithAccess: vi.fn(),
    postChatMessage: vi.fn(),
    repairLegacyAliasDirectConversation: vi.fn(),
    saveTeamEmailDraft: vi.fn(),
    saveTeamEmailTemplate: vi.fn(),
    sendTeamEmail: vi.fn(),
    subscribeToChatMessages: vi.fn(),
    toggleChatReaction: vi.fn(),
    updateChatLastRead: vi.fn(),
    updateChatMuted: vi.fn(),
    clearChatMuted: vi.fn(),
    uploadChatImage: vi.fn(),
    upsertChatConversation: vi.fn()
}));

const friendMessageMocks = vi.hoisted(() => ({
    canMessageAcceptedFriend: vi.fn(),
    sendAuthorizedDirectMessage: vi.fn()
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: () => false
    }
}));

vi.mock('../../js/db.js', () => dbMocks);
vi.mock('../../apps/app/src/lib/friendMessageService.ts', () => friendMessageMocks);
vi.mock('../../js/vendor/firebase-app.js', () => ({
    getApp: vi.fn(() => ({}))
}));
vi.mock('../../js/vendor/firebase-ai.js', () => ({
    getAI: vi.fn(),
    getGenerativeModel: vi.fn(),
    GoogleAIBackend: {}
}));
vi.mock('../../js/firebase-runtime-config.js', () => ({
    resolveImageFirebaseConfig: vi.fn(() => ({ storageBucket: 'test-bucket' }))
}));
vi.mock('../../apps/app/src/lib/authService.ts', () => ({
    firebaseAuth: {
        app: {
            options: {
                projectId: 'demo-allplays'
            }
        }
    },
    getNativeAuthIdToken: vi.fn()
}));
vi.mock('../../apps/app/src/lib/performanceInstrumentation.ts', () => ({
    now: vi.fn(() => 1000),
    startPerformanceSpan: vi.fn(() => ({
        end: vi.fn()
    })),
    recordCompletedPerformanceSpan: vi.fn()
}));

beforeEach(() => {
    vi.clearAllMocks();
    clearAppDataCache();
    dbMocks.canAccessTeamChat.mockImplementation((user, team) => team.id !== 'team-denied');
    dbMocks.canModerateChat.mockImplementation((user, team) => team.id === 'team-coach');
    dbMocks.getUnreadChatCounts.mockResolvedValue({});
    dbMocks.getChatMessages.mockResolvedValue([]);
    dbMocks.sendTeamEmail.mockResolvedValue({ recipientCount: 8, status: 'queued' });
    dbMocks.getSentTeamEmails.mockResolvedValue([]);
    friendMessageMocks.canMessageAcceptedFriend.mockResolvedValue(true);
    friendMessageMocks.sendAuthorizedDirectMessage.mockResolvedValue({ id: 'direct-message-1' });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('React app chat recipient service', () => {
    it('builds selected member options from roster parent data without profile lookups', async () => {
        dbMocks.getPlayers.mockResolvedValue([
            {
                id: 'player-1',
                name: 'Avery',
                number: 9,
                parents: [
                    {
                        userId: 'parent-1',
                        email: 'pat@example.com',
                        fullName: 'Pat Parent'
                    }
                ]
            },
            {
                id: 'player-2',
                name: 'Blake',
                parents: [
                    {
                        email: 'casey@example.com',
                        displayName: 'Casey Guardian'
                    },
                    {
                        email: 'noname@example.com'
                    }
                ]
            }
        ]);

        const { loadChatRecipientOptions } = await import('../../apps/app/src/lib/chatService.ts');
        const options = await loadChatRecipientOptions('team-1');

        expect(dbMocks.getUserProfile).not.toHaveBeenCalled();
        expect(dbMocks.getUserByEmail).toHaveBeenCalledTimes(1);
        expect(dbMocks.getUserByEmail).toHaveBeenCalledWith('noname@example.com');
        expect(options).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 'user:parent-1',
                name: 'Pat Parent',
                detail: 'Guardian for Avery',
                email: 'pat@example.com'
            }),
            expect.objectContaining({
                id: 'email:casey@example.com',
                name: 'Casey Guardian',
                detail: 'Guardian for Blake',
                email: 'casey@example.com'
            }),
            expect.objectContaining({
                id: 'email:noname@example.com',
                name: 'noname@example.com',
                detail: 'Guardian for Blake',
                email: 'noname@example.com'
            })
        ]));
    });

    it('only hydrates parent profiles for roster entries missing a usable label', async () => {
        dbMocks.getPlayers.mockResolvedValue([
            {
                id: 'player-1',
                name: 'Avery',
                parents: [
                    {
                        userId: 'parent-1',
                        email: 'pat@example.com',
                        fullName: 'Pat Parent'
                    },
                    {
                        userId: 'parent-2'
                    }
                ]
            },
            {
                id: 'player-2',
                name: 'Blake',
                parents: [
                    {
                        email: 'casey@example.com'
                    },
                    {
                        userId: 'parent-3'
                    },
                    {
                        email: 'named@example.com',
                        name: 'Named Guardian'
                    }
                ]
            }
        ]);
        dbMocks.getUserProfile.mockImplementation(async (userId) => {
            if (userId === 'parent-2') {
                return { fullName: 'Morgan Missing', email: 'morgan@example.com' };
            }
            if (userId === 'parent-3') {
                return { fullName: 'Casey Guardian', email: 'casey@example.com' };
            }
            return null;
        });
        dbMocks.getUserByEmail.mockImplementation(async (email) => (
            email === 'casey@example.com'
                ? { fullName: 'Casey Guardian', email }
                : null
        ));

        const { loadChatRecipientOptions } = await import('../../apps/app/src/lib/chatService.ts');
        const options = await loadChatRecipientOptions('team-1');

        expect(dbMocks.getUserProfile).toHaveBeenCalledTimes(2);
        expect(dbMocks.getUserProfile).toHaveBeenCalledWith('parent-2');
        expect(dbMocks.getUserProfile).toHaveBeenCalledWith('parent-3');
        expect(dbMocks.getUserByEmail).toHaveBeenCalledTimes(1);
        expect(dbMocks.getUserByEmail).toHaveBeenCalledWith('casey@example.com');
        expect(options).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 'user:parent-1',
                name: 'Pat Parent'
            }),
            expect.objectContaining({
                id: 'user:parent-2',
                name: 'Morgan Missing',
                email: 'morgan@example.com'
            }),
            expect.objectContaining({
                id: 'email:casey@example.com',
                name: 'Casey Guardian',
                email: 'casey@example.com'
            }),
            expect.objectContaining({
                id: 'user:parent-3',
                name: 'Casey Guardian',
                email: 'casey@example.com'
            }),
            expect.objectContaining({
                id: 'email:named@example.com',
                name: 'Named Guardian'
            })
        ]));
    });

    it('bounds missing-label parent profile hydration and preserves fallback options', async () => {
        const missingLabelParents = Array.from({ length: 50 }, (_, index) => {
            const parent = index < 25
                ? { userId: `parent-${index}`, email: `parent-${index}@example.com` }
                : { email: `guardian-${index}@example.com` };
            return {
                id: `player-${index}`,
                name: `Player ${index}`,
                parents: [parent]
            };
        });
        dbMocks.getPlayers.mockResolvedValue(missingLabelParents);

        const pendingLookups = [];
        let inFlight = 0;
        let maxInFlight = 0;
        const trackLookup = (key, profile) => {
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            let resolveLookup;
            let rejectLookup;
            const promise = new Promise((resolve, reject) => {
                resolveLookup = resolve;
                rejectLookup = reject;
            }).finally(() => {
                inFlight -= 1;
            });
            pendingLookups.push({
                key,
                profile,
                resolve: resolveLookup,
                reject: rejectLookup
            });
            return promise;
        };
        dbMocks.getUserProfile.mockImplementation((userId) => trackLookup(userId, {
            fullName: `Hydrated ${userId}`,
            email: `${userId}@profile.example.com`
        }));
        dbMocks.getUserByEmail.mockImplementation((email) => trackLookup(email, {
            fullName: `Hydrated ${email}`,
            email
        }));

        const {
            CHAT_RECIPIENT_PROFILE_LOOKUP_CONCURRENCY,
            loadChatRecipientOptions
        } = await import('../../apps/app/src/lib/chatService.ts');
        const optionsPromise = loadChatRecipientOptions('team-1');

        await vi.waitFor(() => {
            expect(pendingLookups).toHaveLength(CHAT_RECIPIENT_PROFILE_LOOKUP_CONCURRENCY);
        });
        expect(maxInFlight).toBe(CHAT_RECIPIENT_PROFILE_LOOKUP_CONCURRENCY);

        for (let index = 0; index < missingLabelParents.length; index += 1) {
            await vi.waitFor(() => {
                expect(pendingLookups.length).toBeGreaterThan(0);
            });
            const lookup = pendingLookups.shift();
            if (lookup.key === 'guardian-37@example.com') {
                lookup.reject(new Error('profile lookup failed'));
            } else {
                lookup.resolve(lookup.profile);
            }
            await Promise.resolve();
            await Promise.resolve();
            expect(maxInFlight).toBeLessThanOrEqual(CHAT_RECIPIENT_PROFILE_LOOKUP_CONCURRENCY);
        }

        const options = await optionsPromise;

        expect(dbMocks.getUserProfile).toHaveBeenCalledTimes(25);
        expect(dbMocks.getUserByEmail).toHaveBeenCalledTimes(25);
        expect(maxInFlight).toBeLessThanOrEqual(CHAT_RECIPIENT_PROFILE_LOOKUP_CONCURRENCY);
        expect(options).toHaveLength(100);
        expect(options).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 'user:parent-0',
                name: 'Hydrated parent-0',
                email: 'parent-0@example.com'
            }),
            expect.objectContaining({
                id: 'email:guardian-25@example.com',
                name: 'Hydrated guardian-25@example.com',
                email: 'guardian-25@example.com'
            }),
            expect.objectContaining({
                id: 'email:guardian-37@example.com',
                name: 'guardian-37@example.com',
                email: 'guardian-37@example.com'
            })
        ]));
    });

    it('returns fallback recipient options when profile lookups never settle', async () => {
        vi.useFakeTimers();
        const missingLabelParents = Array.from({ length: 9 }, (_, index) => ({
            id: `player-${index}`,
            name: `Player ${index}`,
            parents: [{ userId: `parent-${index}` }]
        }));
        dbMocks.getPlayers.mockResolvedValue(missingLabelParents);

        dbMocks.getUserProfile.mockImplementation(() => new Promise(() => {}));

        const {
            CHAT_RECIPIENT_PROFILE_LOOKUP_CONCURRENCY,
            loadChatRecipientOptions
        } = await import('../../apps/app/src/lib/chatService.ts');
        const optionsPromise = loadChatRecipientOptions('team-1');

        await vi.waitFor(() => {
            expect(dbMocks.getUserProfile).toHaveBeenCalledTimes(CHAT_RECIPIENT_PROFILE_LOOKUP_CONCURRENCY);
        });

        await vi.advanceTimersByTimeAsync(2500);
        await vi.waitFor(() => {
            expect(dbMocks.getUserProfile).toHaveBeenCalledTimes(CHAT_RECIPIENT_PROFILE_LOOKUP_CONCURRENCY + 1);
        });

        await vi.advanceTimersByTimeAsync(2500);

        const options = await optionsPromise;

        expect(dbMocks.getUserProfile).toHaveBeenCalledTimes(9);
        expect(options).toHaveLength(18);
        expect(options).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 'user:parent-8',
                name: 'Guardian',
                detail: 'Guardian for Player 8'
            })
        ]));
    });

    it('builds the inbox from parent, coach, and admin team access with unread and preview data', async () => {
        dbMocks.getUserProfile.mockResolvedValue({
            email: 'parent@example.com',
            parentOf: [{ teamId: 'team-parent', playerId: 'player-1' }]
        });
        dbMocks.getUserTeamsWithAccess.mockResolvedValue([
            { id: 'team-coach', name: 'Bears', sport: 'Basketball', adminEmails: ['parent@example.com'] },
            { id: 'team-inactive-admin', name: 'Inactive Admin', sport: 'Soccer', adminEmails: ['parent@example.com'], active: false },
            { id: 'team-denied', name: 'Hidden team', sport: 'Soccer' }
        ]);
        dbMocks.getParentTeams.mockResolvedValue([
            { id: 'team-parent', name: 'Zebras', sport: 'Soccer' },
            { id: 'team-inactive-parent', name: 'Inactive Parent', sport: 'Soccer', active: false }
        ]);
        dbMocks.getUnreadChatCounts.mockResolvedValue({
            'team-parent': 2,
            'team-coach': 0
        });
        dbMocks.getChatMessages.mockImplementation(async (teamId) => [
            {
                id: `last-${teamId}`,
                text: teamId === 'team-parent' ? 'Need RSVP' : 'Staff note',
                senderName: teamId === 'team-parent' ? 'Coach Morgan' : 'Director',
                createdAt: new Date(teamId === 'team-parent' ? '2026-05-21T13:00:00Z' : '2026-05-21T12:00:00Z')
            }
        ]);

        const { loadChatInbox } = await import('../../apps/app/src/lib/chatService.ts');
        const inbox = await loadChatInbox({
            uid: 'user-1',
            email: 'parent@example.com',
            displayName: 'Pat Parent',
            roles: ['parent', 'coach']
        });

        expect(dbMocks.getUserTeamsWithAccess).toHaveBeenCalledWith('user-1', 'parent@example.com');
        expect(dbMocks.getParentTeams).toHaveBeenCalledWith('user-1');
        expect(dbMocks.getUnreadChatCounts).toHaveBeenCalledWith('user-1', ['team-coach', 'team-parent'], expect.objectContaining({
            latestMessageAtByTeam: {},
            conversationLookupByTeam: expect.objectContaining({
                'team-coach': expect.objectContaining({
                    user: expect.objectContaining({ uid: 'user-1', email: 'parent@example.com' }),
                    team: expect.objectContaining({ id: 'team-coach' }),
                    canModerate: true
                }),
                'team-parent': expect.objectContaining({
                    user: expect.objectContaining({ uid: 'user-1', email: 'parent@example.com' }),
                    team: expect.objectContaining({ id: 'team-parent' }),
                    canModerate: false
                })
            })
        }));
        expect(dbMocks.canAccessTeamChat).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'team-inactive-admin' }));
        expect(dbMocks.canAccessTeamChat).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'team-inactive-parent' }));
        expect(dbMocks.canAccessTeamChat).toHaveBeenCalledWith(expect.objectContaining({
            uid: 'user-1',
            parentOf: [{ teamId: 'team-parent', playerId: 'player-1' }]
        }), expect.objectContaining({ id: 'team-denied' }));
        expect(inbox.teams.map((team) => team.id)).toEqual(['team-parent', 'team-coach']);
        expect(inbox.teams[0]).toEqual(expect.objectContaining({
            id: 'team-parent',
            role: 'Parent',
            canModerate: false,
            unreadCount: 2,
            lastMessage: expect.objectContaining({ text: 'Need RSVP' })
        }));
        expect(inbox.teams[1]).toEqual(expect.objectContaining({
            id: 'team-coach',
            role: 'Coach',
            canModerate: true,
            unreadCount: 0,
            lastMessage: expect.objectContaining({ text: 'Staff note' })
        }));
    });

    it('requests exact unread counts when sibling conversation metadata is newer than the default last read', async () => {
        dbMocks.getUserProfile.mockResolvedValue({
            email: 'parent@example.com',
            chatLastRead: {
                'team-read': new Date('2026-05-21T13:00:00Z')
            },
            teamChatState: {
                'team-read': {
                    lastReadAt: new Date('2026-05-21T13:00:00Z')
                }
            }
        });
        dbMocks.getUserTeamsWithAccess.mockResolvedValue([
            {
                id: 'team-read',
                name: 'Already Read Default Thread',
                sport: 'Soccer',
                lastMessageAt: new Date('2026-05-21T12:00:00Z'),
                chatConversationSummaries: [
                    { id: 'staff-conversation', lastMessageAt: new Date('2026-05-21T15:00:00Z') }
                ]
            },
            {
                id: 'team-unread',
                name: 'Needs Attention',
                sport: 'Basketball',
                lastMessageAt: new Date('2026-05-21T14:00:00Z')
            },
            {
                id: 'team-unknown',
                name: 'Unknown Timestamp',
                sport: 'Baseball'
            }
        ]);
        dbMocks.getParentTeams.mockResolvedValue([]);
        dbMocks.getUnreadChatCounts.mockResolvedValue({
            'team-read': 2,
            'team-unread': 4,
            'team-unknown': 1
        });
        dbMocks.getChatMessages.mockResolvedValue([]);

        const { loadChatInbox } = await import('../../apps/app/src/lib/chatService.ts');
        const inbox = await loadChatInbox({
            uid: 'user-1',
            email: 'parent@example.com',
            displayName: 'Pat Parent',
            roles: ['parent']
        }, { includeLastMessages: false });

        expect(dbMocks.getUnreadChatCounts).toHaveBeenCalledWith('user-1', ['team-read', 'team-unread', 'team-unknown'], expect.objectContaining({
            latestMessageAtByTeam: {
                'team-read': new Date('2026-05-21T12:00:00Z'),
                'team-unread': new Date('2026-05-21T14:00:00Z')
            },
            latestMessageAtByConversationByTeam: {
                'team-read': {
                    'staff-conversation': new Date('2026-05-21T15:00:00Z'),
                    team: new Date('2026-05-21T12:00:00Z')
                },
                'team-unread': {
                    team: new Date('2026-05-21T14:00:00Z')
                }
            },
            conversationIdsByTeam: {
                'team-read': ['team', 'staff-conversation'],
                'team-unread': ['team'],
                'team-unknown': ['team']
            },
            defaultConversationOnly: true,
            conversationLookupByTeam: expect.objectContaining({
                'team-read': expect.objectContaining({
                    user: expect.objectContaining({ uid: 'user-1', email: 'parent@example.com' }),
                    team: expect.objectContaining({ id: 'team-read' }),
                    canModerate: false
                }),
                'team-unread': expect.objectContaining({
                    user: expect.objectContaining({ uid: 'user-1', email: 'parent@example.com' }),
                    team: expect.objectContaining({ id: 'team-unread' }),
                    canModerate: false
                }),
                'team-unknown': expect.objectContaining({
                    user: expect.objectContaining({ uid: 'user-1', email: 'parent@example.com' }),
                    team: expect.objectContaining({ id: 'team-unknown' }),
                    canModerate: false
                })
            })
        }));
        expect(inbox.teams).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'team-read', unreadCount: 2 }),
            expect.objectContaining({ id: 'team-unread', unreadCount: 4 }),
            expect.objectContaining({ id: 'team-unknown', unreadCount: 1 })
        ]));
    });

    it('uses only the newest conversation lookup per team when timestamps are usable', async () => {
        dbMocks.getUserProfile.mockResolvedValue({
            email: 'parent@example.com',
            parentOf: [{ teamId: 'team-parent', playerId: 'player-1' }]
        });
        dbMocks.getUserTeamsWithAccess.mockResolvedValue([]);
        dbMocks.getParentTeams.mockResolvedValue([
            { id: 'team-parent', name: 'Zebras', sport: 'Soccer' }
        ]);
        dbMocks.getChatConversations.mockResolvedValue([
            { id: 'team', type: 'team', name: 'Zebras Team Chat', updatedAt: new Date('2026-05-21T12:00:00Z') },
            { id: 'group_family', type: 'group', name: 'Carpool', lastMessageAt: new Date('2026-05-21T13:00:00Z') },
            { id: 'direct_user-1__coach-1', type: 'direct', name: 'Coach Morgan', participantIds: ['user-1', 'coach-1'], updatedAt: new Date('2026-05-21T14:00:00Z') }
        ]);
        dbMocks.getChatMessages.mockImplementation(async (teamId, options = {}) => {
            if (options.conversationId === 'direct_user-1__coach-1') {
                return [{
                    id: 'direct-last',
                    text: 'Uniform pickup moved to 6.',
                    senderName: 'Coach Morgan',
                    createdAt: new Date('2026-05-21T14:00:00Z')
                }];
            }
            if (options.conversationId === 'group_family') {
                return [{
                    id: 'group-last',
                    text: 'Van leaves at 5:30.',
                    senderName: 'Sam Parent',
                    createdAt: new Date('2026-05-21T13:00:00Z')
                }];
            }
            return [{
                id: 'team-last',
                text: 'Older team announcement.',
                senderName: 'Coach Jamie',
                createdAt: new Date('2026-05-21T12:00:00Z')
            }];
        });

        const { loadChatInbox } = await import('../../apps/app/src/lib/chatService.ts');
        const inbox = await loadChatInbox({
            uid: 'user-1',
            email: 'parent@example.com',
            displayName: 'Pat Parent',
            roles: ['parent']
        });

        expect(dbMocks.getChatMessages).toHaveBeenCalledTimes(1);
        expect(dbMocks.getChatMessages).toHaveBeenCalledWith('team-parent', { limit: 1, conversationId: 'direct_user-1__coach-1' });
        expect(inbox.teams[0].lastMessage).toEqual(expect.objectContaining({
            id: 'direct-last',
            text: 'Uniform pickup moved to 6.'
        }));
    });

    it('falls back to missing conversation timestamps without restoring the full fan-out', async () => {
        dbMocks.getUserProfile.mockResolvedValue({
            email: 'parent@example.com',
            parentOf: [{ teamId: 'team-parent', playerId: 'player-1' }]
        });
        dbMocks.getUserTeamsWithAccess.mockResolvedValue([]);
        dbMocks.getParentTeams.mockResolvedValue([
            { id: 'team-parent', name: 'Zebras', sport: 'Soccer' }
        ]);
        dbMocks.getChatConversations.mockResolvedValue([
            { id: 'team', type: 'team', name: 'Zebras Team Chat' },
            { id: 'direct_user-1__coach-1', type: 'direct', name: 'Coach Morgan', participantIds: ['user-1', 'coach-1'], updatedAt: new Date('2026-05-21T13:00:00Z') },
            { id: 'group_family', type: 'group', name: 'Carpool', lastMessageAt: new Date('2026-05-21T12:00:00Z') }
        ]);
        dbMocks.getChatMessages.mockImplementation(async (teamId, options = {}) => {
            if (options.conversationId === 'direct_user-1__coach-1') {
                return [{
                    id: 'direct-last',
                    text: 'Uniform pickup moved to 6.',
                    senderName: 'Coach Morgan',
                    createdAt: new Date('2026-05-21T13:00:00Z')
                }];
            }
            if (options.conversationId === 'group_family') {
                return [{
                    id: 'group-last',
                    text: 'Van leaves at 5:30.',
                    senderName: 'Sam Parent',
                    createdAt: new Date('2026-05-21T12:00:00Z')
                }];
            }
            return [{
                id: 'team-last',
                text: 'Older team announcement.',
                senderName: 'Coach Jamie',
                createdAt: new Date('2026-05-21T11:00:00Z')
            }];
        });

        const { loadChatInbox } = await import('../../apps/app/src/lib/chatService.ts');
        const inbox = await loadChatInbox({
            uid: 'user-1',
            email: 'parent@example.com',
            displayName: 'Pat Parent',
            roles: ['parent']
        });

        expect(dbMocks.getChatMessages).toHaveBeenCalledTimes(2);
        expect(dbMocks.getChatMessages).toHaveBeenNthCalledWith(1, 'team-parent', { limit: 1, conversationId: 'direct_user-1__coach-1' });
        expect(dbMocks.getChatMessages).toHaveBeenNthCalledWith(2, 'team-parent', { limit: 1, conversationId: 'team' });
        expect(inbox.teams[0].lastMessage).toEqual(expect.objectContaining({
            id: 'direct-last',
            text: 'Uniform pickup moved to 6.'
        }));
    });

    it('checks older timestamped conversations in parallel when the newest conversation has no messages yet', async () => {
        dbMocks.getUserProfile.mockResolvedValue({
            email: 'parent@example.com',
            parentOf: [{ teamId: 'team-parent', playerId: 'player-1' }]
        });
        dbMocks.getUserTeamsWithAccess.mockResolvedValue([]);
        dbMocks.getParentTeams.mockResolvedValue([
            { id: 'team-parent', name: 'Zebras', sport: 'Soccer' }
        ]);
        dbMocks.getChatConversations.mockResolvedValue([
            { id: 'direct_user-1__coach-1', type: 'direct', name: 'Coach Morgan', participantIds: ['user-1', 'coach-1'], updatedAt: new Date('2026-05-21T14:00:00Z') },
            { id: 'group_family', type: 'group', name: 'Carpool', lastMessageAt: new Date('2026-05-21T13:00:00Z') },
            { id: 'team', type: 'team', name: 'Zebras Team Chat', updatedAt: new Date('2026-05-21T12:00:00Z') }
        ]);
        const fallbackResolvers = new Map();
        dbMocks.getChatMessages.mockImplementation(async (teamId, options = {}) => {
            if (options.conversationId === 'direct_user-1__coach-1') {
                return [];
            }
            if (options.conversationId === 'group_family') {
                return new Promise((resolve) => {
                    fallbackResolvers.set(options.conversationId, resolve);
                });
            }
            return new Promise((resolve) => {
                fallbackResolvers.set(options.conversationId, resolve);
            });
        });

        const { loadChatInbox } = await import('../../apps/app/src/lib/chatService.ts');
        const inboxPromise = loadChatInbox({
            uid: 'user-1',
            email: 'parent@example.com',
            displayName: 'Pat Parent',
            roles: ['parent']
        });

        await vi.waitFor(() => {
            expect(fallbackResolvers.has('group_family')).toBe(true);
            expect(fallbackResolvers.has('team')).toBe(true);
        });
        expect(dbMocks.getChatMessages).toHaveBeenCalledTimes(3);
        expect(dbMocks.getChatMessages).toHaveBeenNthCalledWith(1, 'team-parent', { limit: 1, conversationId: 'direct_user-1__coach-1' });
        expect(dbMocks.getChatMessages).toHaveBeenNthCalledWith(2, 'team-parent', { limit: 1, conversationId: 'group_family' });
        expect(dbMocks.getChatMessages).toHaveBeenNthCalledWith(3, 'team-parent', { limit: 1, conversationId: 'team' });

        fallbackResolvers.get('team')([{
            id: 'team-last',
            text: 'Older team announcement.',
            senderName: 'Coach Jamie',
            createdAt: new Date('2026-05-21T12:00:00Z')
        }]);
        fallbackResolvers.get('group_family')([{
            id: 'group-last',
            text: 'Van leaves at 5:30.',
            senderName: 'Sam Parent',
            createdAt: new Date('2026-05-21T13:00:00Z')
        }]);

        const inbox = await inboxPromise;
        expect(inbox.teams[0].lastMessage).toEqual(expect.objectContaining({
            id: 'group-last',
            text: 'Van leaves at 5:30.'
        }));
    });

    it('reuses cached inbox previews within the preview cache window', async () => {
        dbMocks.getUserProfile.mockResolvedValue({
            email: 'parent@example.com',
            parentOf: [{ teamId: 'team-parent', playerId: 'player-1' }]
        });
        dbMocks.getUserTeamsWithAccess.mockResolvedValue([]);
        dbMocks.getParentTeams.mockResolvedValue([
            { id: 'team-parent', name: 'Zebras', sport: 'Soccer' }
        ]);
        dbMocks.getChatConversations.mockResolvedValue([
            { id: 'team', type: 'team', updatedAt: new Date('2026-05-21T13:00:00Z') }
        ]);
        dbMocks.getChatMessages.mockResolvedValue([
            { id: 'cached-message', text: 'Bring water.', createdAt: new Date('2026-05-21T13:05:00Z') }
        ]);
        const user = {
            uid: 'user-1',
            email: 'parent@example.com',
            displayName: 'Pat Parent',
            roles: ['parent']
        };

        const { loadChatInbox } = await import('../../apps/app/src/lib/chatService.ts');
        await loadChatInbox(user);
        await loadChatInbox(user);

        expect(dbMocks.getChatConversations).toHaveBeenCalledTimes(1);
        expect(dbMocks.getChatMessages).toHaveBeenCalledTimes(1);
    });

    it('separates preview cache entries when moderation visibility changes mid-session', async () => {
        let canModerate = true;
        dbMocks.canModerateChat.mockImplementation(() => canModerate);
        dbMocks.getUserProfile.mockResolvedValue({
            email: 'parent@example.com',
            parentOf: [{ teamId: 'team-parent', playerId: 'player-1' }]
        });
        dbMocks.getUserTeamsWithAccess.mockResolvedValue([]);
        dbMocks.getParentTeams.mockResolvedValue([
            { id: 'team-parent', name: 'Zebras', sport: 'Soccer' }
        ]);
        dbMocks.getChatConversations.mockImplementation(async (_teamId, _user, options = {}) => (
            options.canModerate
                ? [
                    { id: 'staff-conversation', type: 'group', updatedAt: new Date('2026-05-21T14:00:00Z') },
                    { id: 'team', type: 'team', updatedAt: new Date('2026-05-21T13:00:00Z') }
                ]
                : [
                    { id: 'team', type: 'team', updatedAt: new Date('2026-05-21T13:00:00Z') }
                ]
        ));
        dbMocks.getChatMessages.mockImplementation(async (_teamId, options = {}) => {
            if (options.conversationId === 'staff-conversation') {
                return [{
                    id: 'staff-last',
                    text: 'Staff only update',
                    createdAt: new Date('2026-05-21T14:00:00Z')
                }];
            }
            return [{
                id: 'team-last',
                text: 'Team update',
                createdAt: new Date('2026-05-21T13:00:00Z')
            }];
        });
        const user = {
            uid: 'user-1',
            email: 'parent@example.com',
            displayName: 'Pat Parent',
            roles: ['parent']
        };

        const { loadChatInbox } = await import('../../apps/app/src/lib/chatService.ts');
        const moderatorInbox = await loadChatInbox(user);
        canModerate = false;
        const memberInbox = await loadChatInbox(user);

        expect(dbMocks.getChatConversations).toHaveBeenCalledTimes(2);
        expect(moderatorInbox.teams[0].lastMessage).toEqual(expect.objectContaining({
            id: 'staff-last',
            text: 'Staff only update'
        }));
        expect(memberInbox.teams[0].lastMessage).toEqual(expect.objectContaining({
            id: 'team-last',
            text: 'Team update'
        }));
    });

    it('returns teams immediately without preview lookups in fast inbox mode', async () => {
        dbMocks.getUserProfile.mockResolvedValue({ email: 'coach@example.com' });
        dbMocks.getUserTeamsWithAccess.mockResolvedValue([
            { id: 'team-a', name: 'Alpha', sport: 'Soccer' },
            {
                id: 'team-b',
                name: 'Beta',
                sport: 'Basketball',
                chatConversationSummaries: [
                    { id: 'staff-conversation', lastMessageAt: new Date('2026-05-21T15:00:00Z') }
                ]
            }
        ]);
        dbMocks.getParentTeams.mockResolvedValue([]);
        dbMocks.getUnreadChatCounts.mockResolvedValue({ 'team-b': 3 });

        const { loadChatInbox } = await import('../../apps/app/src/lib/chatService.ts');
        const inbox = await loadChatInbox({
            uid: 'user-1',
            email: 'coach@example.com',
            displayName: 'Coach',
            roles: ['coach']
        }, { includeLastMessages: false });

        expect(inbox.teams).toEqual([
            expect.objectContaining({ id: 'team-a', lastMessage: null, unreadCount: 0 }),
            expect.objectContaining({ id: 'team-b', lastMessage: null, unreadCount: 3 })
        ]);
        expect(dbMocks.getUnreadChatCounts).toHaveBeenCalledWith('user-1', ['team-a', 'team-b'], expect.objectContaining({
            defaultConversationOnly: true,
            conversationIdsByTeam: {
                'team-a': ['team'],
                'team-b': ['team', 'staff-conversation']
            },
            latestMessageAtByConversationByTeam: {
                'team-b': {
                    'staff-conversation': new Date('2026-05-21T15:00:00Z')
                }
            }
        }));
        expect(dbMocks.getChatConversations).not.toHaveBeenCalled();
        expect(dbMocks.getChatMessages).not.toHaveBeenCalled();
    });

    it('throttles deferred inbox preview hydration while still emitting every update', async () => {
        dbMocks.getUserProfile.mockResolvedValue({ email: 'coach@example.com' });
        dbMocks.getUserTeamsWithAccess.mockResolvedValue([
            { id: 'team-1', name: 'Alpha', sport: 'Soccer' },
            { id: 'team-2', name: 'Beta', sport: 'Soccer' },
            { id: 'team-3', name: 'Gamma', sport: 'Soccer' },
            { id: 'team-4', name: 'Delta', sport: 'Soccer' },
            { id: 'team-5', name: 'Echo', sport: 'Soccer' }
        ]);
        dbMocks.getParentTeams.mockResolvedValue([]);

        const startedTeams = [];
        const resolvers = new Map();
        let activePreviewLoads = 0;
        let maxActivePreviewLoads = 0;
        dbMocks.getChatConversations.mockImplementation((teamId) => {
            startedTeams.push(teamId);
            activePreviewLoads += 1;
            maxActivePreviewLoads = Math.max(maxActivePreviewLoads, activePreviewLoads);
            return new Promise((resolve) => {
                resolvers.set(teamId, (value) => {
                    activePreviewLoads -= 1;
                    resolve(value);
                });
            });
        });

        const previewUpdates = [];
        const { loadChatInbox } = await import('../../apps/app/src/lib/chatService.ts');
        const inbox = await loadChatInbox({
            uid: 'user-1',
            email: 'coach@example.com',
            displayName: 'Coach',
            roles: ['coach']
        }, {
            includeLastMessages: false,
            onPreview: (update) => {
                previewUpdates.push(update);
            }
        });

        expect(inbox.teams.map((team) => team.id)).toEqual(['team-1', 'team-2', 'team-4', 'team-5', 'team-3']);
        expect(inbox.teams.every((team) => team.lastMessage === null)).toBe(true);
        await vi.waitFor(() => {
            expect(startedTeams).toEqual(['team-1', 'team-2', 'team-3']);
        });

        resolvers.get('team-1')([]);
        await vi.waitFor(() => {
            expect(startedTeams).toEqual(['team-1', 'team-2', 'team-3', 'team-4']);
        });
        expect(maxActivePreviewLoads).toBeLessThanOrEqual(3);
        expect(previewUpdates.map((update) => update.teamId)).toContain('team-1');

        resolvers.get('team-2')([]);
        resolvers.get('team-3')([]);
        await vi.waitFor(() => {
            expect(startedTeams).toEqual(['team-1', 'team-2', 'team-3', 'team-4', 'team-5']);
        });
        resolvers.get('team-4')([]);
        resolvers.get('team-5')([]);

        await vi.waitFor(() => {
            expect(previewUpdates.map((update) => update.teamId).sort()).toEqual(['team-1', 'team-2', 'team-3', 'team-4', 'team-5']);
        });
        expect(maxActivePreviewLoads).toBeLessThanOrEqual(3);
    });

    it('returns no inbox teams for signed-out users', async () => {
        const { loadChatInbox } = await import('../../apps/app/src/lib/chatService.ts');

        await expect(loadChatInbox(null)).resolves.toEqual({ teams: [] });
        expect(dbMocks.getUserProfile).not.toHaveBeenCalled();
        expect(dbMocks.getUserTeamsWithAccess).not.toHaveBeenCalled();
    });

    it('normalizes chat conversations and older message pages through typed mappers', async () => {
        dbMocks.getChatConversations.mockResolvedValue([
            { name: 'Missing id', type: 'direct' },
            {
                id: 'conversation-1',
                type: 'unsupported',
                participantIds: [' user-1 ', 'user-1', 'coach-1'],
                mutedBy: [' coach-1 ', 'coach-1'],
                updatedAt: { seconds: Date.parse('2026-06-19T19:00:00.000Z') / 1000 }
            }
        ]);
        dbMocks.getChatMessages.mockResolvedValue([
            {
                text: 'missing id',
                createdAt: new Date('2026-06-19T19:01:00.000Z')
            },
            {
                id: 'message-1',
                text: '  Bring water ',
                reactions: {
                    heart: [' user-2 ', 'user-2', '']
                },
                mentionedUids: [' user-3 ', 'user-3'],
                createdAt: { toDate: () => new Date('2026-06-19T19:02:00.000Z') }
            }
        ]);

        const { loadChatConversations, loadOlderTeamChatMessages } = await import('../../apps/app/src/lib/chatService.ts');
        const conversations = await loadChatConversations(
            'team-1',
            { uid: 'user-1', email: 'parent@example.com', roles: [] },
            { id: 'team-1', name: 'Bears' },
            true
        );
        const messages = await loadOlderTeamChatMessages('team-1', 'conversation-1', { id: 'cursor' });

        expect(conversations).toEqual([
            expect.objectContaining({
                id: 'conversation-1',
                type: 'group',
                participantIds: ['user-1', 'coach-1'],
                mutedBy: ['coach-1'],
                updatedAt: new Date('2026-06-19T19:00:00.000Z')
            })
        ]);
        expect(messages).toEqual([
            expect.objectContaining({
                id: 'message-1',
                text: 'Bring water',
                reactions: {
                    heart: ['user-2']
                },
                mentionedUids: ['user-3'],
                createdAt: new Date('2026-06-19T19:02:00.000Z')
            })
        ]);
    });

    it('requests and returns an active deep-linked conversation when the recent page omits it', async () => {
        dbMocks.getChatConversations.mockImplementation(async (_teamId, _user, options = {}) => {
            const recentPage = [
                { id: 'team', type: 'team', name: 'Bears Team Chat', participantIds: [], participantRoles: ['team'] },
                { id: 'recent-family', type: 'group', name: 'Recent family', participantIds: ['user-1'], updatedAt: new Date('2026-06-19T20:00:00.000Z') }
            ];
            if (options.includeConversationId === 'older-deep-link') {
                return [
                    ...recentPage,
                    { id: 'older-deep-link', type: 'direct', name: 'Older direct', participantIds: ['user-1', 'coach-1'], updatedAt: new Date('2026-04-01T12:00:00.000Z') }
                ];
            }
            return recentPage;
        });

        const { loadChatConversations } = await import('../../apps/app/src/lib/chatService.ts');
        const conversations = await loadChatConversations(
            'team-1',
            { uid: 'user-1', email: 'parent@example.com', roles: [] },
            { id: 'team-1', name: 'Bears' },
            false,
            { activeConversationId: 'older-deep-link' }
        );

        expect(dbMocks.getChatConversations).toHaveBeenCalledWith('team-1', expect.objectContaining({ uid: 'user-1' }), {
            team: { id: 'team-1', name: 'Bears' },
            canModerate: false,
            includeConversationId: 'older-deep-link'
        });
        expect(conversations.map((conversation) => conversation.id)).toEqual([
            'team',
            'recent-family',
            'older-deep-link'
        ]);
    });

    it('loads an exact reverse direct conversation beyond the recent page', async () => {
        const reverseConversationId = 'direct_friend-2__user%3Acurrent-1';
        dbMocks.getChatConversations.mockImplementation(async (_teamId, _user, options = {}) => [
            { id: 'team', type: 'team', participantIds: [] },
            ...(options.includeConversationId === reverseConversationId ? [{
                id: reverseConversationId,
                type: 'direct',
                participantIds: ['friend-2', 'user:current-1']
            }] : [])
        ]);

        const { loadChatConversationById } = await import('../../apps/app/src/lib/chatService.ts');
        const conversation = await loadChatConversationById(
            'team-1',
            { uid: 'current-1', email: 'current@example.com', roles: [] },
            { id: 'team-1', name: 'Bears' },
            false,
            reverseConversationId
        );

        expect(dbMocks.getChatConversations).toHaveBeenCalledWith(
            'team-1',
            expect.objectContaining({ uid: 'current-1' }),
            {
                team: { id: 'team-1', name: 'Bears' },
                canModerate: false,
                includeConversationId: reverseConversationId,
                strictIncludeConversationId: true
            }
        );
        expect(conversation).toEqual(expect.objectContaining({
            id: reverseConversationId,
            type: 'direct',
            participantIds: ['friend-2', 'user:current-1']
        }));
    });

    it('does not treat a failed exact direct conversation lookup as a missing thread', async () => {
        dbMocks.getChatConversations.mockRejectedValueOnce(new Error('conversation lookup unavailable'));
        const { loadChatConversationById } = await import('../../apps/app/src/lib/chatService.ts');

        await expect(loadChatConversationById(
            'team-1',
            { uid: 'current-1', email: 'current@example.com', roles: [] },
            { id: 'team-1', name: 'Bears' },
            false,
            'direct_friend-2__user%3Acurrent-1'
        )).rejects.toThrow('conversation lookup unavailable');
    });

    it('treats a denied missing direct conversation as absent for a non-moderator', async () => {
        dbMocks.getChatConversations.mockRejectedValueOnce(Object.assign(
            new Error('Missing conversation reads are denied by Firestore rules.'),
            { code: 'permission-denied' }
        ));
        const { loadChatConversationById } = await import('../../apps/app/src/lib/chatService.ts');

        await expect(loadChatConversationById(
            'team-1',
            { uid: 'current-1', email: 'parent@example.com', roles: [] },
            { id: 'team-1', name: 'Bears' },
            false,
            'direct_current-1__user%3Afriend-2'
        )).resolves.toBeNull();
    });

    it('routes selected-member messages into a non-default conversation before posting', async () => {
        const photo = new File(['photo'], 'arrival.jpg', { type: 'image/jpeg' });
        const video = new File(['clip'], 'warmups.mp4', { type: 'video/mp4' });
        const uploadedPhoto = {
            type: 'image',
            url: 'https://cdn.example.test/arrival.jpg',
            path: 'team-photos/arrival.jpg',
            name: 'arrival.jpg',
            mimeType: 'image/jpeg',
            size: photo.size
        };
        const uploadedVideo = {
            type: 'video',
            url: 'https://cdn.example.test/warmups.mp4',
            path: 'team-videos/warmups.mp4',
            name: 'warmups.mp4',
            mimeType: 'video/mp4',
            size: video.size
        };
        dbMocks.uploadChatImage
            .mockResolvedValueOnce(uploadedPhoto)
            .mockResolvedValueOnce(uploadedVideo);
        dbMocks.getPlayers.mockResolvedValue([
            {
                id: 'player-1',
                name: 'Avery',
                parents: [
                    { userId: 'parent-2', email: 'guardian@example.com' }
                ]
            }
        ]);
        dbMocks.upsertChatConversation.mockResolvedValue({
            id: 'group-player-coach',
            type: 'group',
            participantIds: ['user-1', 'email:guardian@example.com', 'user:coach-1', 'user:parent-2'],
            participantRoles: []
        });
        dbMocks.postChatMessage.mockResolvedValue({ id: 'msg-1' });
        const progress = [];

        const { sendTeamChatMessage } = await import('../../apps/app/src/lib/chatService.ts');
        const result = await sendTeamChatMessage({
            teamId: 'team-1',
            user: {
                uid: 'user-1',
                email: 'parent@example.com',
                displayName: 'Pat Parent'
            },
            profile: {
                fullName: 'Pat Profile',
                photoUrl: 'https://cdn.example.test/pat.jpg'
            },
            text: '@ALL PLAYS summarize this thread',
            files: [photo, video],
            selectedConversation: null,
            selectedConversationId: 'team',
            selectedRecipientTarget: 'individuals',
            selectedRecipientIds: ['user:coach-1', 'player:player-1'],
            onProgress: (stage) => progress.push(stage)
        });

        expect(progress).toEqual(['uploading', 'uploading', 'posting']);
        expect(dbMocks.uploadChatImage).toHaveBeenNthCalledWith(1, 'team-1', photo, { conversationId: 'group-player-coach' });
        expect(dbMocks.uploadChatImage).toHaveBeenNthCalledWith(2, 'team-1', video, { conversationId: 'group-player-coach' });
        expect(dbMocks.upsertChatConversation).toHaveBeenCalledWith('team-1', expect.objectContaining({
            type: 'group',
            participantIds: expect.arrayContaining(['user-1', 'user:coach-1', 'user:parent-2', 'email:guardian@example.com']),
            participantRoles: []
        }));
        expect(dbMocks.upsertChatConversation.mock.calls[0][1].participantIds).toHaveLength(4);
        expect(dbMocks.postChatMessage).toHaveBeenCalledWith('team-1', expect.objectContaining({
            text: '@ALL PLAYS summarize this thread',
            senderId: 'user-1',
            senderName: 'Pat Profile',
            senderEmail: 'parent@example.com',
            senderPhotoUrl: 'https://cdn.example.test/pat.jpg',
            attachments: [uploadedPhoto, uploadedVideo],
            conversationId: 'group-player-coach',
            targetType: 'individuals',
            recipientIds: ['user-1', 'email:guardian@example.com', 'user:coach-1', 'user:parent-2'],
            targetRole: null
        }));
        expect(result).toEqual({
            conversationId: 'group-player-coach',
            createdConversation: expect.objectContaining({ id: 'group-player-coach' }),
            wantsAi: true
        });
    });

    it('resolves selected players through user parentPlayerKeys before creating a private conversation', async () => {
        dbMocks.getPlayers.mockResolvedValue([{ id: 'player-1', name: 'Avery', parents: [] }]);
        dbMocks.getUsersByParentPlayerKey.mockResolvedValue([
            { id: 'parent-1', email: 'guardian@example.com', parentPlayerKeys: ['team-1::player-1'] }
        ]);
        dbMocks.upsertChatConversation.mockImplementation(async (_teamId, conversation) => ({
            id: 'group-linked-parent',
            ...conversation
        }));
        dbMocks.postChatMessage.mockResolvedValue({ id: 'msg-linked-parent' });

        const { sendTeamChatMessage } = await import('../../apps/app/src/lib/chatService.ts');
        await sendTeamChatMessage({
            teamId: 'team-1',
            user: {
                uid: 'coach-1',
                email: 'coach@example.com',
                displayName: 'Coach Jamie'
            },
            profile: { fullName: 'Coach Jamie' },
            text: 'Private update',
            files: [],
            selectedConversation: null,
            selectedConversationId: 'team',
            selectedRecipientTarget: 'individuals',
            selectedRecipientIds: ['player:player-1']
        });

        expect(dbMocks.getUsersByParentPlayerKey).toHaveBeenCalledWith('team-1::player-1');
        expect(dbMocks.upsertChatConversation).toHaveBeenCalledWith('team-1', expect.objectContaining({
            type: 'group',
            participantIds: ['coach-1', 'user:parent-1', 'email:guardian@example.com']
        }));
        expect(dbMocks.postChatMessage).toHaveBeenCalledWith('team-1', expect.objectContaining({
            conversationId: 'group-linked-parent'
        }));
        expect(friendMessageMocks.sendAuthorizedDirectMessage).not.toHaveBeenCalled();
    });

    it('does not create undiscoverable player-token conversations when a selected player has no linked guardian', async () => {
        dbMocks.getPlayers.mockResolvedValue([{ id: 'player-1', name: 'Avery', parents: [] }]);
        dbMocks.getUsersByParentPlayerKey.mockResolvedValue([]);

        const { sendTeamChatMessage } = await import('../../apps/app/src/lib/chatService.ts');
        await expect(sendTeamChatMessage({
            teamId: 'team-1',
            user: {
                uid: 'coach-1',
                email: 'coach@example.com',
                displayName: 'Coach Jamie'
            },
            profile: { fullName: 'Coach Jamie' },
            text: 'Private update',
            files: [],
            selectedConversation: null,
            selectedConversationId: 'team',
            selectedRecipientTarget: 'individuals',
            selectedRecipientIds: ['player:player-1']
        })).rejects.toThrow('Selected player recipients must have a linked guardian');

        expect(dbMocks.upsertChatConversation).not.toHaveBeenCalled();
        expect(dbMocks.postChatMessage).not.toHaveBeenCalled();
    });

    it('reuses only canonical staff conversations and ignores legacy coach-scoped staff threads', async () => {
        dbMocks.upsertChatConversation.mockResolvedValue({
            id: 'group_role%3Astaff',
            type: 'group',
            participantIds: [],
            participantRoles: ['staff']
        });

        const { ensureStaffChatConversation } = await import('../../apps/app/src/lib/chatService.ts');
        const result = await ensureStaffChatConversation('team-1', {
            uid: 'coach-1',
            email: 'coach@example.com',
            displayName: 'Coach Jamie'
        }, [
            {
                id: 'legacy-staff-thread',
                type: 'group',
                participantIds: ['coach-1'],
                participantRoles: ['staff']
            }
        ]);

        expect(dbMocks.upsertChatConversation).toHaveBeenCalledWith('team-1', expect.objectContaining({
            type: 'group',
            participantIds: [],
            participantRoles: ['staff'],
            name: 'Staff only'
        }));
        expect(result).toEqual(expect.objectContaining({
            id: 'group_role%3Astaff',
            participantIds: [],
            participantRoles: ['staff']
        }));
    });

    it('normalizes a canonical staff conversation with legacy participant roles', async () => {
        dbMocks.upsertChatConversation.mockResolvedValue({
            id: 'group_role%3Astaff',
            type: 'group',
            participantIds: [],
            participantRoles: ['staff']
        });

        const { ensureStaffChatConversation } = await import('../../apps/app/src/lib/chatService.ts');
        await ensureStaffChatConversation('team-1', {
            uid: 'coach-1',
            email: 'coach@example.com',
            displayName: 'Coach Jamie'
        }, [{
            id: 'group_role%3Astaff',
            type: 'group',
            participantIds: ['coach-1'],
            participantRoles: ['staff', 'coach']
        }]);

        expect(dbMocks.upsertChatConversation).toHaveBeenCalledWith('team-1', expect.objectContaining({
            participantIds: [],
            participantRoles: ['staff']
        }));
    });

    it('routes staff-only messages into a non-default conversation before posting', async () => {
        dbMocks.upsertChatConversation.mockResolvedValue({
            id: 'staff-conversation',
            type: 'group',
            participantIds: ['coach-1'],
            participantRoles: ['staff']
        });
        dbMocks.postChatMessage.mockResolvedValue({ id: 'msg-staff-1' });

        const { sendTeamChatMessage } = await import('../../apps/app/src/lib/chatService.ts');
        const result = await sendTeamChatMessage({
            teamId: 'team-1',
            user: {
                uid: 'coach-1',
                email: 'coach@example.com',
                displayName: 'Coach Jamie'
            },
            profile: {
                fullName: 'Coach Jamie'
            },
            text: 'Coaches only update',
            files: [],
            selectedConversation: null,
            selectedConversationId: 'team',
            selectedRecipientTarget: 'staff',
            selectedRecipientIds: []
        });

        expect(dbMocks.upsertChatConversation).toHaveBeenCalledWith('team-1', expect.objectContaining({
            type: 'group',
            participantIds: [],
            participantRoles: ['staff'],
            name: 'Staff only'
        }));
        expect(dbMocks.postChatMessage).toHaveBeenCalledWith('team-1', expect.objectContaining({
            text: 'Coaches only update',
            conversationId: 'staff-conversation',
            targetType: 'staff',
            recipientIds: [],
            targetRole: 'staff'
        }));
        expect(result).toEqual({
            conversationId: 'staff-conversation',
            createdConversation: expect.objectContaining({ id: 'staff-conversation' }),
            wantsAi: false
        });
    });

    it('rejects empty selected-member targeting before falling back to full team', async () => {
        const { sendTeamChatMessage } = await import('../../apps/app/src/lib/chatService.ts');
        await expect(sendTeamChatMessage({
            teamId: 'team-1',
            user: {
                uid: 'user-1',
                email: 'parent@example.com',
                displayName: 'Pat Parent'
            },
            profile: {},
            text: 'Private update',
            files: [],
            selectedConversation: null,
            selectedConversationId: 'team',
            selectedRecipientTarget: 'individuals',
            selectedRecipientIds: []
        })).rejects.toThrow('Choose at least one selected member before sending.');

        expect(dbMocks.postChatMessage).not.toHaveBeenCalled();
        expect(dbMocks.upsertChatConversation).not.toHaveBeenCalled();
    });

    it('sends team email through the backend callable wrapper', async () => {
        const { sendTeamEmailMessage, loadSentTeamEmails } = await import('../../apps/app/src/lib/chatService.ts');

        await expect(sendTeamEmailMessage({
            teamId: 'team-1',
            subject: ' Practice update ',
            body: ' Bring jerseys ',
            targetType: 'individuals',
            recipientIds: ['user:coach-1']
        })).resolves.toEqual({ recipientCount: 8, status: 'queued' });

        expect(dbMocks.sendTeamEmail).toHaveBeenCalledWith('team-1', {
            subject: 'Practice update',
            body: 'Bring jerseys',
            targetType: 'individuals',
            recipientIds: ['user:coach-1']
        });

        await loadSentTeamEmails('team-1', { limit: 10 });
        expect(dbMocks.getSentTeamEmails).toHaveBeenCalledWith('team-1', { limit: 10 });
    });

    it('validates team email subject, body, and selected recipients', async () => {
        const { sendTeamEmailMessage } = await import('../../apps/app/src/lib/chatService.ts');

        await expect(sendTeamEmailMessage({
            teamId: 'team-1',
            subject: '   ',
            body: 'Body',
            targetType: 'full_team'
        })).rejects.toThrow('Subject and message are required.');
        await expect(sendTeamEmailMessage({
            teamId: 'team-1',
            subject: 'Subject',
            body: 'Body',
            targetType: 'individuals',
            recipientIds: []
        })).rejects.toThrow('Choose at least one selected member before sending.');
        expect(dbMocks.sendTeamEmail).not.toHaveBeenCalled();
    });

    describe('loadChatInbox sort order', () => {
        it('puts the team with a newer lastMessage first', async () => {
            dbMocks.getUserProfile.mockResolvedValue({ email: 'coach@example.com' });
            dbMocks.getUserTeamsWithAccess.mockResolvedValue([
                { id: 'team-a', name: 'Alpha', sport: 'Soccer' },
                { id: 'team-b', name: 'Beta', sport: 'Soccer' }
            ]);
            dbMocks.getParentTeams.mockResolvedValue([]);
            dbMocks.getChatMessages.mockImplementation(async (teamId) => [
                {
                    id: `msg-${teamId}`,
                    text: 'hello',
                    senderName: 'Coach',
                    createdAt: new Date(teamId === 'team-b' ? '2026-05-21T14:00:00Z' : '2026-05-21T12:00:00Z')
                }
            ]);

            const { loadChatInbox } = await import('../../apps/app/src/lib/chatService.ts');
            const inbox = await loadChatInbox({
                uid: 'user-1',
                email: 'coach@example.com',
                displayName: 'Coach',
                roles: ['coach']
            });

            expect(inbox.teams.map((t) => t.id)).toEqual(['team-b', 'team-a']);
        });

        it('puts teams with no lastMessage after teams that have messages', async () => {
            dbMocks.getUserProfile.mockResolvedValue({ email: 'coach@example.com' });
            dbMocks.getUserTeamsWithAccess.mockResolvedValue([
                { id: 'team-a', name: 'Alpha', sport: 'Soccer' },
                { id: 'team-b', name: 'Beta', sport: 'Soccer' },
                { id: 'team-c', name: 'Gamma', sport: 'Soccer' }
            ]);
            dbMocks.getParentTeams.mockResolvedValue([]);
            dbMocks.getChatMessages.mockImplementation(async (teamId) => {
                if (teamId === 'team-c') return [];
                return [
                    {
                        id: `msg-${teamId}`,
                        text: 'hello',
                        senderName: 'Coach',
                        createdAt: new Date(teamId === 'team-b' ? '2026-05-21T14:00:00Z' : '2026-05-21T12:00:00Z')
                    }
                ];
            });

            const { loadChatInbox } = await import('../../apps/app/src/lib/chatService.ts');
            const inbox = await loadChatInbox({
                uid: 'user-1',
                email: 'coach@example.com',
                displayName: 'Coach',
                roles: ['coach']
            });

            expect(inbox.teams.map((t) => t.id)).toEqual(['team-b', 'team-a', 'team-c']);
        });

        it('sorts alphabetically when two teams have no messages', async () => {
            dbMocks.getUserProfile.mockResolvedValue({ email: 'coach@example.com' });
            dbMocks.getUserTeamsWithAccess.mockResolvedValue([
                { id: 'team-z', name: 'Zebras', sport: 'Soccer' },
                { id: 'team-a', name: 'Antelopes', sport: 'Soccer' }
            ]);
            dbMocks.getParentTeams.mockResolvedValue([]);
            dbMocks.getChatMessages.mockResolvedValue([]);

            const { loadChatInbox } = await import('../../apps/app/src/lib/chatService.ts');
            const inbox = await loadChatInbox({
                uid: 'user-1',
                email: 'coach@example.com',
                displayName: 'Coach',
                roles: ['coach']
            });

            expect(inbox.teams.map((t) => t.id)).toEqual(['team-a', 'team-z']);
        });
    });

    it('cleans uploaded chat media if the message write fails', async () => {
        const photo = new File(['photo'], 'arrival.jpg', { type: 'image/jpeg' });
        const uploadedPhoto = {
            type: 'image',
            url: 'https://cdn.example.test/arrival.jpg',
            path: 'team-photos/arrival.jpg',
            name: 'arrival.jpg',
            mimeType: 'image/jpeg',
            size: photo.size
        };
        dbMocks.uploadChatImage.mockResolvedValue(uploadedPhoto);
        dbMocks.postChatMessage.mockRejectedValue(new Error('Firestore unavailable'));

        const { sendTeamChatMessage } = await import('../../apps/app/src/lib/chatService.ts');
        await expect(sendTeamChatMessage({
            teamId: 'team-1',
            user: {
                uid: 'user-1',
                email: 'parent@example.com',
                displayName: 'Pat Parent'
            },
            profile: {},
            text: 'Photo only',
            files: [photo],
            selectedConversation: null,
            selectedConversationId: 'team',
            selectedRecipientTarget: 'full_team',
            selectedRecipientIds: []
        })).rejects.toThrow('Firestore unavailable');

        expect(dbMocks.deleteUploadedChatAttachments).toHaveBeenCalledWith([uploadedPhoto]);
    });

    it('muteTeamChat sets mutedAt via updateChatMuted for the selected conversation', async () => {
        dbMocks.updateChatMuted.mockResolvedValue(undefined);

        const { muteTeamChat } = await import('../../apps/app/src/lib/chatService.ts');
        await muteTeamChat('user-1', 'team-1', 'staff-conversation');

        expect(dbMocks.updateChatMuted).toHaveBeenCalledWith('user-1', 'team-1', 'staff-conversation');
        expect(dbMocks.clearChatMuted).not.toHaveBeenCalled();
    });

    it('unmuteTeamChat deletes mutedAt via clearChatMuted for the selected conversation', async () => {
        dbMocks.clearChatMuted.mockResolvedValue(undefined);

        const { unmuteTeamChat } = await import('../../apps/app/src/lib/chatService.ts');
        await unmuteTeamChat('user-1', 'team-1', 'staff-conversation');

        expect(dbMocks.clearChatMuted).toHaveBeenCalledWith('user-1', 'team-1', 'staff-conversation');
        expect(dbMocks.updateChatMuted).not.toHaveBeenCalled();
    });

    it('rethrows failed web mute writes so callers can roll back optimistic state', async () => {
        dbMocks.updateChatMuted.mockRejectedValueOnce(new Error('offline'));
        dbMocks.clearChatMuted.mockRejectedValueOnce(new Error('permission-denied'));

        const { muteTeamChat, unmuteTeamChat } = await import('../../apps/app/src/lib/chatService.ts');

        await expect(muteTeamChat('user-1', 'team-1')).rejects.toThrow('offline');
        await expect(unmuteTeamChat('user-1', 'team-1')).rejects.toThrow('permission-denied');
    });

    it('loadChatInbox sets isMuted from the conversation-keyed team chat state', async () => {
        dbMocks.getUserProfile.mockResolvedValue({
            email: 'parent@example.com',
            parentOf: [],
            teamChatState: {
                'team-parent': {
                    mutedConversations: {
                        team: new Date('2026-06-01T12:00:00Z')
                    }
                }
            }
        });
        dbMocks.getUserTeamsWithAccess.mockResolvedValue([]);
        dbMocks.getParentTeams.mockResolvedValue([
            { id: 'team-parent', name: 'Zebras', sport: 'Soccer' }
        ]);
        dbMocks.getUnreadChatCounts.mockResolvedValue({});
        dbMocks.getChatMessages.mockResolvedValue([]);

        const { loadChatInbox } = await import('../../apps/app/src/lib/chatService.ts');
        const inbox = await loadChatInbox({
            uid: 'user-1',
            email: 'parent@example.com',
            displayName: 'Pat Parent',
            roles: ['parent']
        });

        expect(inbox.teams[0]).toEqual(expect.objectContaining({
            id: 'team-parent',
            isMuted: true
        }));
    });


    it('loadChatInbox includes deferred preview mute state for non-default conversations', async () => {
        dbMocks.getUserProfile.mockResolvedValue({
            email: 'coach@example.com',
            teamIds: ['team-1'],
            teamChatState: {
                'team-1': {
                    mutedConversations: {
                        'staff-conversation': new Date('2026-06-01T12:00:00Z')
                    }
                }
            }
        });
        dbMocks.getUserTeamsWithAccess.mockResolvedValue([
            { id: 'team-1', name: 'Bears', sport: 'Basketball', ownerId: 'user-1' }
        ]);
        dbMocks.getParentTeams.mockResolvedValue([]);
        dbMocks.getUnreadChatCounts.mockResolvedValue({});
        dbMocks.getChatConversations.mockResolvedValue([
            { id: 'team', type: 'team', updatedAt: new Date('2026-06-01T11:00:00Z') },
            { id: 'staff-conversation', type: 'group', updatedAt: new Date('2026-06-01T12:00:00Z') }
        ]);
        dbMocks.getChatMessages.mockImplementation(async (_teamId, options = {}) => {
            if (options.conversationId === 'staff-conversation') {
                return [{ id: 'msg-1', text: 'Staff note', createdAt: new Date('2026-06-01T12:00:00Z') }];
            }
            return [];
        });

        const previews = [];
        const { loadChatInbox } = await import('../../apps/app/src/lib/chatService.ts');
        await loadChatInbox({
            uid: 'user-1',
            email: 'coach@example.com',
            displayName: 'Coach One',
            roles: ['coach']
        }, {
            includeLastMessages: false,
            onPreview: (preview) => previews.push(preview)
        });
        await vi.waitFor(() => {
            expect(previews).toContainEqual(expect.objectContaining({
            teamId: 'team-1',
            preferredConversationId: 'staff-conversation',
            isMuted: true
        }));
        });
    });
});
