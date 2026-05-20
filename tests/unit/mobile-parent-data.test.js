import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
    auth: {
        app: {
            options: {
                projectId: 'demo-project'
            }
        }
    }
}));

vi.mock('../../js/firebase.js?v=13', () => firebaseMocks);

const {
    buildMobileTeamSummaries,
    decodeFirestoreFields,
    getMobileParentScope,
    listMobileTeamChatMessages,
    sendMobileTeamChatMessage,
    syncMobileParentScope
} = await import('../../js/mobile-parent-data.js');

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;

function firestoreValue(value) {
    if (value === null || value === undefined) return { nullValue: null };
    if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    if (typeof value === 'object') {
        return {
            mapValue: {
                fields: Object.fromEntries(Object.entries(value).map(([key, child]) => [key, firestoreValue(child)]))
            }
        };
    }
    return { stringValue: String(value) };
}

function firestoreFields(data) {
    return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, firestoreValue(value)]));
}

function createUser() {
    return {
        uid: 'parent-1',
        email: 'parent@example.com',
        getIdToken: vi.fn().mockResolvedValue('id-token')
    };
}

describe('mobile parent data helpers', () => {
    beforeEach(() => {
        globalThis.window = {
            setTimeout,
            clearTimeout
        };
        globalThis.fetch = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        if (typeof originalFetch === 'undefined') {
            delete globalThis.fetch;
        } else {
            globalThis.fetch = originalFetch;
        }

        if (typeof originalWindow === 'undefined') {
            delete globalThis.window;
        } else {
            globalThis.window = originalWindow;
        }
    });

    it('normalizes parent teams from linked children', () => {
        const children = [
            { teamId: 'team-b', playerId: 'player-2', teamName: 'Bears', playerName: 'Avery' },
            { teamId: 'team-a', playerId: 'player-1', teamName: 'Arrows', playerName: 'Blake' },
            { teamId: 'team-b', playerId: 'player-3', teamName: 'Bears', playerName: 'Casey' }
        ];

        expect(buildMobileTeamSummaries(children)).toEqual([
            { teamId: 'team-a', teamName: 'Arrows', playerNames: ['Blake'] },
            { teamId: 'team-b', teamName: 'Bears', playerNames: ['Avery', 'Casey'] }
        ]);
    });

    it('decodes Firestore REST fields and derives parent chat access scope', () => {
        const profile = decodeFirestoreFields(firestoreFields({
            parentOf: [
                { teamId: 'team-1', playerId: 'player-1' },
                { teamId: 'team-1', playerId: 'player-2' },
                { teamId: 'team-2', playerId: 'player-3' }
            ]
        }));

        expect(getMobileParentScope(profile)).toEqual({
            parentTeamIds: ['team-1', 'team-2'],
            parentPlayerKeys: ['team-1::player-1', 'team-1::player-2', 'team-2::player-3']
        });
    });

    it('patches missing parent chat access fields for the signed-in user', async () => {
        const user = createUser();
        globalThis.fetch.mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({})
        });

        const profile = await syncMobileParentScope(user, {
            parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
        });

        expect(profile.parentTeamIds).toEqual(['team-1']);
        expect(profile.parentPlayerKeys).toEqual(['team-1::player-1']);
        expect(globalThis.fetch).toHaveBeenCalledWith(
            expect.stringContaining('/documents/users/parent-1?'),
            expect.objectContaining({
                method: 'PATCH',
                headers: expect.objectContaining({ Authorization: 'Bearer id-token' })
            })
        );
    });

    it('lists team chat messages through Firestore REST in chronological order', async () => {
        const user = createUser();
        globalThis.fetch.mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({
                documents: [
                    {
                        name: 'projects/demo/databases/(default)/documents/teams/team-1/chatMessages/newer',
                        fields: firestoreFields({ text: 'Newer', createdAt: '2026-05-18T12:10:00Z', deleted: false })
                    },
                    {
                        name: 'projects/demo/databases/(default)/documents/teams/team-1/chatMessages/deleted',
                        fields: firestoreFields({ text: 'Deleted', createdAt: '2026-05-18T12:05:00Z', deleted: true })
                    },
                    {
                        name: 'projects/demo/databases/(default)/documents/teams/team-1/chatMessages/older',
                        fields: firestoreFields({ text: 'Older', createdAt: '2026-05-18T12:00:00Z', deleted: false })
                    }
                ]
            })
        });

        await expect(listMobileTeamChatMessages(user, 'team-1')).resolves.toEqual([
            expect.objectContaining({ id: 'older', text: 'Older' }),
            expect.objectContaining({ id: 'newer', text: 'Newer' })
        ]);
    });

    it('posts full-team chat messages through Firestore REST', async () => {
        const user = createUser();
        globalThis.fetch.mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({
                name: 'projects/demo/databases/(default)/documents/teams/team-1/chatMessages/message-1'
            })
        });

        await sendMobileTeamChatMessage(user, 'team-1', {
            text: 'Hello team',
            senderName: 'Parent'
        });

        const [, request] = globalThis.fetch.mock.calls[0];
        const body = JSON.parse(request.body);
        expect(request.method).toBe('POST');
        expect(body.fields.text.stringValue).toBe('Hello team');
        expect(body.fields.senderId.stringValue).toBe('parent-1');
        expect(body.fields.targetType.stringValue).toBe('full_team');
        expect(body.fields.recipientIds.arrayValue.values).toEqual([]);
    });
});
