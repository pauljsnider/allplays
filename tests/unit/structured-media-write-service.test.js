import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getStructuredMediaWriteRequestHash as getServerRequestHash } from '../../functions/structured-media-write-core.cjs';

const firebaseMocks = vi.hoisted(() => ({
    mutate: vi.fn(),
    httpsCallable: vi.fn(() => firebaseMocks.mutate)
}));

vi.mock('../../js/firebase.js?v=34', () => ({
    functions: {},
    httpsCallable: firebaseMocks.httpsCallable
}));

import {
    STRUCTURED_MEDIA_ACTIONS,
    STRUCTURED_MEDIA_RESOURCE_KINDS,
    STRUCTURED_MEDIA_WRITE_VERSION,
    createStructuredMediaMutationId,
    createStructuredMediaWriteService,
    getStructuredMediaWriteRequestHash,
    isStructuredMediaWriteUnconfirmedError,
    normalizeStructuredMediaMutationInput,
    normalizeStructuredMediaMutationResponse,
    structuredMediaWriteService
} from '../../js/structured-media-write-service.js';

const mutationId = '11111111-2222-4333-8444-555555555555';

function secureCrypto() {
    return {
        randomUUID: vi.fn(() => mutationId),
        subtle: webcrypto.subtle
    };
}

function responseFor(request, overrides = {}) {
    const isCreate = request.resourceKind === STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_MEDIA_VIDEO_LINK
        && request.action === STRUCTURED_MEDIA_ACTIONS.CREATE;
    const targetId = request.resourceKind === STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_FIXED_VIDEO
        ? null
        : isCreate
            ? 'generated-media-item'
            : request.targetId;
    const removesResource = [STRUCTURED_MEDIA_ACTIONS.REMOVE, STRUCTURED_MEDIA_ACTIONS.DELETE]
        .includes(request.action);
    return {
        data: {
            version: STRUCTURED_MEDIA_WRITE_VERSION,
            mutationId: request.mutationId,
            requestHash: request.requestHash,
            resourceKind: request.resourceKind,
            action: request.action,
            committed: true,
            targetId,
            resource: removesResource
                ? null
                : { id: targetId || request.teamId },
            ...overrides
        }
    };
}

function teamPayload(overrides = {}) {
    return {
        streamEmbedUrl: null,
        youtubeEmbedUrl: null,
        streamUrl: null,
        livestreamUrl: null,
        youtubeVideoId: null,
        ...overrides
    };
}

function drillPayload(overrides = {}) {
    return {
        youtubeUrl: null,
        resourceUrl: null,
        ...overrides
    };
}

describe('structured media callable write service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('uses the same recursively stable semantic request hash as the server', async () => {
        const input = {
            payload: {
                youtubeVideoId: 'dQw4w9WgXcQ',
                livestreamUrl: null,
                streamUrl: null,
                youtubeEmbedUrl: null,
                streamEmbedUrl: 'https://video.example.test/replay?id=1'
            },
            teamId: ' team-1 ',
            action: STRUCTURED_MEDIA_ACTIONS.SET,
            resourceKind: STRUCTURED_MEDIA_RESOURCE_KINDS.TEAM_FIXED_VIDEO
        };
        const normalized = normalizeStructuredMediaMutationInput(input);

        await expect(getStructuredMediaWriteRequestHash(input, secureCrypto()))
            .resolves.toBe(getServerRequestHash(normalized));
        expect(normalized).toEqual({
            version: 1,
            resourceKind: 'team-fixed-video',
            action: 'set',
            teamId: 'team-1',
            payload: {
                streamEmbedUrl: 'https://video.example.test/replay?id=1',
                youtubeEmbedUrl: null,
                streamUrl: null,
                livestreamUrl: null,
                youtubeVideoId: 'dQw4w9WgXcQ'
            }
        });
    });

    it('reserves mutation IDs only from secure UUID randomness', () => {
        expect(createStructuredMediaMutationId(secureCrypto())).toBe(mutationId);

        const randomBytes = vi.fn((bytes) => {
            bytes.fill(0);
            return bytes;
        });
        expect(createStructuredMediaMutationId({ getRandomValues: randomBytes }))
            .toBe('00000000-0000-4000-8000-000000000000');
        expect(randomBytes).toHaveBeenCalledTimes(1);
        expect(() => createStructuredMediaMutationId({})).toThrow('Secure randomness is unavailable');
        expect(() => createStructuredMediaMutationId({ randomUUID: () => 'not-a-uuid' }))
            .toThrow('Secure mutation ID generation failed');
    });

    it.each([
        {
            name: 'team set',
            method: 'setTeamFixedVideo',
            options: {
                teamId: ' team-1 ',
                streamEmbedUrl: ' https://www.youtube.com/embed/dQw4w9WgXcQ ',
                youtubeEmbedUrl: null,
                streamUrl: null,
                livestreamUrl: null,
                youtubeVideoId: ' dQw4w9WgXcQ '
            },
            semantic: {
                version: 1,
                resourceKind: 'team-fixed-video',
                action: 'set',
                teamId: 'team-1',
                payload: teamPayload({
                    streamEmbedUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
                    youtubeVideoId: 'dQw4w9WgXcQ'
                })
            }
        },
        {
            name: 'team remove',
            method: 'removeTeamFixedVideo',
            options: { teamId: 'team-1' },
            semantic: {
                version: 1,
                resourceKind: 'team-fixed-video',
                action: 'remove',
                teamId: 'team-1',
                payload: {}
            }
        },
        {
            name: 'media create',
            method: 'createTeamMediaVideoLink',
            options: {
                teamId: 'team-1',
                folderId: ' folder-1 ',
                title: ' Game replay ',
                url: ' https://vimeo.com/123456789?share=copy '
            },
            semantic: {
                version: 1,
                resourceKind: 'team-media-video-link',
                action: 'create',
                teamId: 'team-1',
                payload: {
                    folderId: 'folder-1',
                    title: 'Game replay',
                    type: 'video-link',
                    url: 'https://vimeo.com/123456789?share=copy',
                    src: null,
                    downloadUrl: null
                }
            }
        },
        {
            name: 'media remove',
            method: 'removeTeamMediaVideoLink',
            options: { teamId: 'team-1', targetId: 'media-1' },
            semantic: {
                version: 1,
                resourceKind: 'team-media-video-link',
                action: 'remove',
                teamId: 'team-1',
                targetId: 'media-1',
                payload: {}
            }
        },
        {
            name: 'drill set',
            method: 'setDrillLibraryVideo',
            options: {
                teamId: 'team-1',
                targetId: 'drill-1',
                youtubeUrl: null,
                resourceUrl: ' https://videos.example.test/drill/one?quality=source '
            },
            semantic: {
                version: 1,
                resourceKind: 'drill-library-video',
                action: 'set',
                teamId: 'team-1',
                targetId: 'drill-1',
                payload: drillPayload({
                    resourceUrl: 'https://videos.example.test/drill/one?quality=source'
                })
            }
        },
        {
            name: 'drill remove',
            method: 'removeDrillLibraryVideo',
            options: { teamId: 'team-1', targetId: 'drill-1' },
            semantic: {
                version: 1,
                resourceKind: 'drill-library-video',
                action: 'remove',
                teamId: 'team-1',
                targetId: 'drill-1',
                payload: {}
            }
        },
        {
            name: 'drill delete',
            method: 'deleteDrillLibraryVideo',
            options: { teamId: 'team-1', targetId: 'drill-1' },
            semantic: {
                version: 1,
                resourceKind: 'drill-library-video',
                action: 'delete',
                teamId: 'team-1',
                targetId: 'drill-1',
                payload: {}
            }
        }
    ])('normalizes the exact $name callable request without a direct-write fallback', async ({
        method,
        options,
        semantic
    }) => {
        const callMutation = vi.fn(async (request) => responseFor(request));
        const service = createStructuredMediaWriteService({
            callMutation,
            cryptoImpl: secureCrypto()
        });

        const result = await service[method](options);

        expect(callMutation).toHaveBeenCalledTimes(1);
        const request = callMutation.mock.calls[0][0];
        expect(request).toEqual({
            version: 1,
            mutationId,
            requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
            resourceKind: semantic.resourceKind,
            action: semantic.action,
            teamId: semantic.teamId,
            ...(semantic.targetId ? { targetId: semantic.targetId } : {}),
            payload: semantic.payload
        });
        await expect(getStructuredMediaWriteRequestHash(semantic, secureCrypto()))
            .resolves.toBe(request.requestHash);
        expect(result).toEqual(responseFor(request).data);
    });

    it('preserves non-YouTube absolute URL bytes after trimming', async () => {
        const callMutation = vi.fn(async (request) => responseFor(request));
        const service = createStructuredMediaWriteService({
            callMutation,
            cryptoImpl: secureCrypto()
        });
        const url = 'https://player.twitch.tv/?channel=vipers&parent=allplays.ai#live';

        await service.setTeamFixedVideo({
            teamId: 'team-1',
            streamEmbedUrl: null,
            youtubeEmbedUrl: null,
            streamUrl: `  ${url}  `,
            livestreamUrl: null,
            youtubeVideoId: null
        });

        expect(callMutation.mock.calls[0][0].payload).toEqual(teamPayload({ streamUrl: url }));
    });

    it('retries an ambiguous callable response with the exact frozen request', async () => {
        const callMutation = vi.fn()
            .mockRejectedValueOnce(Object.assign(new Error('response lost'), {
                code: 'functions/unavailable'
            }))
            .mockImplementationOnce(async (request) => responseFor(request));
        const service = createStructuredMediaWriteService({
            callMutation,
            cryptoImpl: secureCrypto()
        });

        await expect(service.removeTeamMediaVideoLink({
            teamId: 'team-1',
            targetId: 'media-1'
        })).resolves.toMatchObject({ committed: true, targetId: 'media-1', resource: null });

        expect(callMutation).toHaveBeenCalledTimes(2);
        expect(callMutation.mock.calls[1][0]).toBe(callMutation.mock.calls[0][0]);
        expect(Object.isFrozen(callMutation.mock.calls[0][0])).toBe(true);
        expect(Object.isFrozen(callMutation.mock.calls[0][0].payload)).toBe(true);
    });

    it('treats mismatched receipt responses as ambiguous and preserves existing media', async () => {
        const callMutation = vi.fn(async (request) => responseFor(request, {
            requestHash: '0'.repeat(64)
        }));
        const service = createStructuredMediaWriteService({
            callMutation,
            cryptoImpl: secureCrypto()
        });

        const result = service.setDrillLibraryVideo({
            teamId: 'team-1',
            targetId: 'drill-1',
            youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
            resourceUrl: null
        });
        await expect(result).rejects.toMatchObject({
            code: 'structured-media-write-unconfirmed',
            preserveExistingMedia: true
        });
        await expect(result.catch((error) => error)).resolves.toSatisfy(
            isStructuredMediaWriteUnconfirmedError
        );
        expect(callMutation).toHaveBeenCalledTimes(2);
        expect(callMutation.mock.calls[1][0]).toBe(callMutation.mock.calls[0][0]);
    });

    it('throws an explicit unconfirmed error after two ambiguous callable failures', async () => {
        const firstError = Object.assign(new Error('timeout'), { code: 'deadline-exceeded' });
        const secondError = new TypeError('network response was lost');
        const callMutation = vi.fn()
            .mockRejectedValueOnce(firstError)
            .mockRejectedValueOnce(secondError);
        const service = createStructuredMediaWriteService({
            callMutation,
            cryptoImpl: secureCrypto()
        });

        const result = service.removeTeamFixedVideo({ teamId: 'team-1' });
        await expect(result).rejects.toMatchObject({
            code: 'structured-media-write-unconfirmed',
            preserveExistingMedia: true,
            cause: secondError
        });
        expect(callMutation).toHaveBeenCalledTimes(2);
        expect(callMutation.mock.calls[1][0]).toBe(callMutation.mock.calls[0][0]);
    });

    it('does not retry definitive callable failures', async () => {
        const denied = Object.assign(new Error('denied'), { code: 'functions/permission-denied' });
        const callMutation = vi.fn().mockRejectedValue(denied);
        const service = createStructuredMediaWriteService({
            callMutation,
            cryptoImpl: secureCrypto()
        });

        await expect(service.removeTeamFixedVideo({ teamId: 'team-1' })).rejects.toBe(denied);
        expect(callMutation).toHaveBeenCalledTimes(1);
    });

    it('requires every fixed alias so omitted values cannot silently erase non-YouTube media', async () => {
        const callMutation = vi.fn();
        const service = createStructuredMediaWriteService({
            callMutation,
            cryptoImpl: secureCrypto()
        });

        expect(() => service.setTeamFixedVideo({
            teamId: 'team-1',
            streamUrl: 'https://video.example.test/replay'
        })).toThrow('missing fields');
        expect(() => service.setDrillLibraryVideo({
            teamId: 'team-1',
            targetId: 'drill-1',
            youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ'
        })).toThrow('missing fields');
        expect(callMutation).not.toHaveBeenCalled();
    });

    it('requires exact receipt fields, target identity, commit marker, and resource shape', () => {
        const expectedRequest = {
            version: 1,
            mutationId,
            requestHash: 'a'.repeat(64),
            resourceKind: 'drill-library-video',
            action: 'set',
            teamId: 'team-1',
            targetId: 'drill-1',
            payload: drillPayload({ youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' })
        };
        const valid = responseFor(expectedRequest).data;
        expect(normalizeStructuredMediaMutationResponse({ data: valid }, expectedRequest))
            .toEqual(valid);

        for (const invalid of [
            { ...valid, committed: false },
            { ...valid, targetId: 'drill-2' },
            { ...valid, resource: { id: 'drill-2' } },
            { ...valid, resource: { id: 'drill-1', youtubeUrl: 'https://example.test' } },
            { ...valid, extra: true }
        ]) {
            expect(() => normalizeStructuredMediaMutationResponse({ data: invalid }, expectedRequest))
                .toThrow('invalid response');
        }
    });

    it.each([
        ['unknown resource kind', {
            resourceKind: 'other', action: 'set', teamId: 'team-1', payload: {}
        }],
        ['unsupported action', {
            resourceKind: 'team-fixed-video', action: 'delete', teamId: 'team-1', payload: {}
        }],
        ['slash in team ID', {
            resourceKind: 'team-fixed-video', action: 'remove', teamId: 'teams/one', payload: {}
        }],
        ['team target ID', {
            resourceKind: 'team-fixed-video', action: 'remove', teamId: 'team-1', targetId: null, payload: {}
        }],
        ['missing media remove target', {
            resourceKind: 'team-media-video-link', action: 'remove', teamId: 'team-1', payload: {}
        }],
        ['nonempty remove payload', {
            resourceKind: 'team-fixed-video', action: 'remove', teamId: 'team-1', payload: { streamUrl: null }
        }],
        ['empty team set', {
            resourceKind: 'team-fixed-video', action: 'set', teamId: 'team-1', payload: teamPayload()
        }],
        ['invalid YouTube ID', {
            resourceKind: 'team-fixed-video', action: 'set', teamId: 'team-1',
            payload: teamPayload({ youtubeVideoId: 'live_stream' })
        }],
        ['invalid URL protocol', {
            resourceKind: 'team-fixed-video', action: 'set', teamId: 'team-1',
            payload: teamPayload({ streamUrl: 'javascript:alert(1)' })
        }],
        ['oversized URL', {
            resourceKind: 'drill-library-video', action: 'set', teamId: 'team-1', targetId: 'drill-1',
            payload: drillPayload({ resourceUrl: `https://example.test/${'a'.repeat(2_100)}` })
        }],
        ['empty drill set', {
            resourceKind: 'drill-library-video', action: 'set', teamId: 'team-1', targetId: 'drill-1',
            payload: drillPayload()
        }],
        ['unexpected payload field', {
            resourceKind: 'drill-library-video', action: 'set', teamId: 'team-1', targetId: 'drill-1',
            payload: { ...drillPayload({ youtubeUrl: 'https://example.test/video' }), videoId: 'unexpected' }
        }]
    ])('rejects %s before calling the server', async (_name, input) => {
        const callMutation = vi.fn();
        const service = createStructuredMediaWriteService({
            callMutation,
            cryptoImpl: secureCrypto()
        });

        await expect(service.mutate(input)).rejects.toBeInstanceOf(TypeError);
        expect(callMutation).not.toHaveBeenCalled();
    });

    it('binds the default service only to mutateStructuredMediaIdentity', async () => {
        firebaseMocks.mutate.mockImplementationOnce(async (request) => responseFor(request));

        await structuredMediaWriteService.removeTeamFixedVideo({ teamId: 'team-1' });

        expect(firebaseMocks.httpsCallable).toHaveBeenCalledWith(
            {},
            'mutateStructuredMediaIdentity'
        );
        expect(firebaseMocks.mutate).toHaveBeenCalledTimes(1);
    });
});
