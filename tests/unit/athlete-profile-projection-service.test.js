import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAthleteProfileProjectionRequestHash as getServerRequestHash } from '../../functions/athlete-profile-projection-core.cjs';

const firebaseMocks = vi.hoisted(() => ({
    save: vi.fn(),
    getDoc: vi.fn(),
    doc: vi.fn((_db, collection, id) => ({ path: `${collection}/${id}` })),
    httpsCallable: vi.fn(() => firebaseMocks.save)
}));

vi.mock('../../js/firebase.js?v=34', () => ({
    db: {},
    functions: {},
    doc: firebaseMocks.doc,
    getDoc: firebaseMocks.getDoc,
    httpsCallable: firebaseMocks.httpsCallable
}));

import {
    createAthleteProfileProjectionMutationId,
    createAthleteProfileProjectionService,
    getAthleteProfileProjectionRequestHash,
    isAthleteProfileSaveUnconfirmedError,
    normalizeAthleteProfileProjectionResponse
} from '../../js/athlete-profile-projection-service.js';

const mutationId = '11111111-2222-4333-8444-555555555555';

function profile() {
    const gameClip = {
        id: 'clip-1',
        url: 'https://www.youtube.com/watch?v=abcdefghijk'
    };
    return {
        athlete: { name: 'Athlete One', headline: 'Guard' },
        bio: { hometown: 'Chicago' },
        privacy: 'public',
        clips: [{ id: 'intentional', url: 'https://youtu.be/zyxwvutsrqp' }],
        gameClips: [gameClip],
        seasons: [{ seasonKey: 'team-1::player-1', gameClips: [gameClip] }],
        careerSummary: { gamesPlayed: 1 },
        profilePhotoUrl: null,
        profilePhotoPath: null,
        profilePhotoMimeType: null,
        profilePhotoSizeBytes: null,
        profilePhotoUploadedAtMs: null
    };
}

function secureCrypto() {
    return {
        randomUUID: vi.fn(() => mutationId),
        subtle: webcrypto.subtle
    };
}

function savedProfile(request, overrides = {}) {
    return {
        id: request.profileId,
        ...request.profile,
        profileProjectionSchemaVersion: 1,
        profileProjectionMutationId: request.mutationId,
        profileProjectionMutationHash: request.requestHash,
        ...overrides
    };
}

function existingSnapshot(data) {
    return {
        exists: () => true,
        data: () => data
    };
}

describe('athlete profile server-authoritative projection client', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('uses the same stable request hash as the server core', async () => {
        const payload = profile();
        await expect(getAthleteProfileProjectionRequestHash(
            'profile-1',
            payload,
            secureCrypto()
        )).resolves.toBe(getServerRequestHash('profile-1', payload));
    });

    it('reserves mutation IDs only from secure randomness', () => {
        expect(createAthleteProfileProjectionMutationId(secureCrypto())).toBe(mutationId);
        expect(() => createAthleteProfileProjectionMutationId({})).toThrow('Secure randomness is unavailable');
        expect(() => createAthleteProfileProjectionMutationId({ randomUUID: () => '/' }))
            .toThrow('Secure mutation ID generation failed');
    });

    it('saves only through the callable and validates the exact mutation marker', async () => {
        const saveCall = vi.fn(async (request) => ({ data: { profile: savedProfile(request) } }));
        const readProfile = vi.fn();
        const service = createAthleteProfileProjectionService({
            saveCall,
            readProfile,
            cryptoImpl: secureCrypto()
        });

        await expect(service.save({ profileId: 'profile-1', profile: profile() }))
            .resolves.toMatchObject({
                id: 'profile-1',
                profileProjectionMutationId: mutationId
            });
        expect(saveCall).toHaveBeenCalledTimes(1);
        expect(readProfile).not.toHaveBeenCalled();
        expect(saveCall.mock.calls[0][0]).toMatchObject({
            profileId: 'profile-1',
            mutationId,
            profile: profile()
        });
        expect(saveCall.mock.calls[0][0].requestHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('retries the exact request after an ambiguous callable response', async () => {
        const unavailable = Object.assign(new Error('response lost'), { code: 'functions/unavailable' });
        const saveCall = vi.fn()
            .mockRejectedValueOnce(unavailable)
            .mockImplementationOnce(async (request) => ({ profile: savedProfile(request) }));
        const service = createAthleteProfileProjectionService({
            saveCall,
            readProfile: vi.fn(),
            cryptoImpl: secureCrypto()
        });

        await expect(service.save({ profileId: 'profile-1', profile: profile() }))
            .resolves.toMatchObject({ profileProjectionMutationId: mutationId });
        expect(saveCall).toHaveBeenCalledTimes(2);
        expect(saveCall.mock.calls[1][0]).toEqual(saveCall.mock.calls[0][0]);
    });

    it('reconciles two lost responses only from an authoritative matching id and hash', async () => {
        const unavailable = Object.assign(new Error('response lost'), { code: 'unavailable' });
        const saveCall = vi.fn().mockRejectedValue(unavailable);
        const readProfile = vi.fn(async () => {
            const request = saveCall.mock.calls[0][0];
            return existingSnapshot(savedProfile(request, { headlineFromLaterEdit: true }));
        });
        const service = createAthleteProfileProjectionService({
            saveCall,
            readProfile,
            cryptoImpl: secureCrypto()
        });

        await expect(service.save({ profileId: 'profile-1', profile: profile() }))
            .resolves.toMatchObject({
                id: 'profile-1',
                headlineFromLaterEdit: true,
                profileProjectionMutationId: mutationId
            });
        expect(saveCall).toHaveBeenCalledTimes(2);
        expect(readProfile).toHaveBeenCalledWith('profile-1');
    });

    it('keeps an unknown commit fail-closed and explicitly preserves uploaded media', async () => {
        const unavailable = Object.assign(new Error('offline'), { code: 'functions/unavailable' });
        const service = createAthleteProfileProjectionService({
            saveCall: vi.fn().mockRejectedValue(unavailable),
            readProfile: vi.fn().mockRejectedValue(unavailable),
            cryptoImpl: secureCrypto()
        });

        let caught;
        try {
            await service.save({ profileId: 'profile-1', profile: profile() });
        } catch (error) {
            caught = error;
        }
        expect(caught).toMatchObject({
            code: 'athlete-profile-save-unconfirmed',
            preserveUploadedMedia: true
        });
        expect(isAthleteProfileSaveUnconfirmedError(caught)).toBe(true);
    });

    it('does not accept a coincidental mutation id with a different authoritative hash', async () => {
        const unavailable = Object.assign(new Error('offline'), { code: 'unavailable' });
        const service = createAthleteProfileProjectionService({
            saveCall: vi.fn().mockRejectedValue(unavailable),
            readProfile: vi.fn(async () => existingSnapshot({
                ...profile(),
                profileProjectionSchemaVersion: 1,
                profileProjectionMutationId: mutationId,
                profileProjectionMutationHash: '0'.repeat(64)
            })),
            cryptoImpl: secureCrypto()
        });

        await expect(service.save({ profileId: 'profile-1', profile: profile() }))
            .rejects.toMatchObject({ code: 'athlete-profile-save-unconfirmed' });
    });

    it('does not reconcile matching markers when the authoritative projection body changed', async () => {
        const unavailable = Object.assign(new Error('offline'), { code: 'unavailable' });
        const saveCall = vi.fn().mockRejectedValue(unavailable);
        const readProfile = vi.fn(async () => {
            const request = saveCall.mock.calls[0][0];
            return existingSnapshot(savedProfile(request, {
                bio: { hometown: 'Changed after commit' }
            }));
        });
        const service = createAthleteProfileProjectionService({
            saveCall,
            readProfile,
            cryptoImpl: secureCrypto()
        });

        await expect(service.save({ profileId: 'profile-1', profile: profile() }))
            .rejects.toMatchObject({
                code: 'athlete-profile-save-unconfirmed',
                preserveUploadedMedia: true
            });
    });

    it('does not retry definitive authorization failures', async () => {
        const denied = Object.assign(new Error('denied'), { code: 'functions/permission-denied' });
        const saveCall = vi.fn().mockRejectedValue(denied);
        const readProfile = vi.fn();
        const service = createAthleteProfileProjectionService({
            saveCall,
            readProfile,
            cryptoImpl: secureCrypto()
        });

        await expect(service.save({ profileId: 'profile-1', profile: profile() }))
            .rejects.toBe(denied);
        expect(saveCall).toHaveBeenCalledTimes(1);
        expect(readProfile).not.toHaveBeenCalled();
    });

    it('rejects incomplete callable responses even when the mutation id matches', () => {
        expect(() => normalizeAthleteProfileProjectionResponse({
            profile: {
                id: 'profile-1',
                profileProjectionSchemaVersion: 1,
                profileProjectionMutationId: mutationId,
                profileProjectionMutationHash: 'a'.repeat(64)
            }
        }, {
            profileId: 'profile-1',
            mutationId,
            requestHash: 'a'.repeat(64),
            profile: profile()
        })).toThrow('invalid response');
    });

    it('rejects a callable response whose exact projection differs despite matching markers', async () => {
        const payload = profile();
        const requestHash = await getAthleteProfileProjectionRequestHash(
            'profile-1',
            payload,
            secureCrypto()
        );
        expect(() => normalizeAthleteProfileProjectionResponse({
            profile: savedProfile({
                profileId: 'profile-1',
                profile: payload,
                mutationId,
                requestHash
            }, {
                bio: { hometown: 'Different response body' }
            })
        }, {
            profileId: 'profile-1',
            mutationId,
            requestHash,
            profile: payload
        })).toThrow('invalid response');
    });
});
