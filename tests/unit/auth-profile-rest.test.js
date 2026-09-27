import { beforeEach, describe, expect, it, vi } from 'vitest';

const appCheckMocks = vi.hoisted(() => ({
    getPrimaryAppCheckHeaders: vi.fn(async (headers) => ({
        ...headers,
        'X-Firebase-AppCheck': 'attestation'
    }))
}));

vi.mock('../../js/firebase-app-check-rest.js?v=1', () => appCheckMocks);

const { loadAuthProfileViaRest } = await import('../../js/auth-profile-rest.js');

describe('loadAuthProfileViaRest', () => {
    const auth = { app: { options: { projectId: 'demo-project' } } };
    const user = {
        uid: 'user.with:punctuation',
        getIdToken: vi.fn(async () => 'firebase-token')
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns a complete decoded profile from authenticated Firestore REST', async () => {
        const fetchImpl = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                name: 'projects/demo-project/databases/(default)/documents/users/user-1',
                fields: {
                    fullName: { stringValue: 'Pat Parent' },
                    isAdmin: { booleanValue: false },
                    parentOf: {
                        arrayValue: {
                            values: [{
                                mapValue: {
                                    fields: {
                                        teamId: { stringValue: 'team-1' },
                                        playerId: { stringValue: 'player-1' }
                                    }
                                }
                            }]
                        }
                    }
                }
            })
        }));

        await expect(loadAuthProfileViaRest({ auth, user, fetchImpl })).resolves.toEqual({
            fullName: 'Pat Parent',
            isAdmin: false,
            parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
        });

        expect(fetchImpl).toHaveBeenCalledWith(
            expect.stringContaining('/users/user.with%3Apunctuation'),
            expect.objectContaining({
                headers: expect.objectContaining({
                    Authorization: 'Bearer firebase-token',
                    'X-Firebase-AppCheck': 'attestation'
                })
            })
        );
    });

    it('treats a real 404 as complete profile absence', async () => {
        const fetchImpl = vi.fn(async () => ({
            ok: false,
            status: 404,
            json: async () => ({})
        }));

        await expect(loadAuthProfileViaRest({ auth, user, fetchImpl })).resolves.toBeNull();
    });

    it('rejects malformed success payloads instead of treating them as an empty profile', async () => {
        const fetchImpl = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ name: 'users/user-1' })
        }));

        await expect(loadAuthProfileViaRest({ auth, user, fetchImpl })).rejects.toThrow('Profile request failed');
    });
});
