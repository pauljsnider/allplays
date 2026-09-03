import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
    manage: vi.fn(),
    playback: vi.fn(),
    highlights: vi.fn(),
    httpsCallable: vi.fn((_functions, name) => {
        if (name === 'manageGameReplayArchive') return firebaseMocks.manage;
        if (name === 'saveGameHighlightClips') return firebaseMocks.highlights;
        return firebaseMocks.playback;
    })
}));

vi.mock('../../js/firebase.js?v=34', () => ({
    functions: {},
    httpsCallable: firebaseMocks.httpsCallable
}));

import {
    createGameReplayService,
    createReplayMutationId,
    normalizeHighlightClipsResponse,
    normalizeReplayManagementResponse,
    normalizeReplayPlaybackResponse,
    normalizeTransientReplayVideo
} from '../../js/game-replay-service.js';

const videoId = 'dQw4w9WgXcQ';
const replayVideo = {
    provider: 'youtube',
    videoId,
    embedUrl: `https://www.youtube.com/embed/${videoId}`,
    publicUrl: `https://www.youtube.com/watch?v=${videoId}`,
    title: 'Final replay'
};

function secureCrypto(id = '11111111-2222-4333-8444-555555555555') {
    return { randomUUID: vi.fn(() => id) };
}

describe('private game replay callable service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('reserves mutation IDs only from secure randomness', () => {
        expect(createReplayMutationId(secureCrypto())).toBe('11111111-2222-4333-8444-555555555555');
        expect(() => createReplayMutationId({})).toThrow('Secure randomness is unavailable');
    });

    it('canonicalizes consistent transient YouTube responses and rejects conflicting identities', () => {
        expect(normalizeTransientReplayVideo({
            provider: 'youtube',
            videoId,
            publicUrl: `https://youtu.be/${videoId}?si=transient`,
            title: ' Final   replay '
        })).toEqual(replayVideo);

        expect(normalizeTransientReplayVideo({
            provider: 'youtube',
            videoId,
            publicUrl: 'https://youtu.be/abcdefghijk'
        })).toBeNull();
        expect(normalizeTransientReplayVideo({
            provider: 'vimeo',
            publicUrl: `https://youtu.be/${videoId}`
        })).toBeNull();
    });

    it('fails closed on inconsistent management and playback response shapes', () => {
        expect(() => normalizeReplayManagementResponse({
            state: 'ready',
            hasRecordedReplay: true,
            replayArchiveRevision: 'r1'
        })).toThrow('complete ready replay');
        expect(() => normalizeReplayManagementResponse({
            state: 'removed',
            hasRecordedReplay: true,
            replayVideo
        })).toThrow('non-ready state');
        expect(() => normalizeReplayPlaybackResponse({
            available: true,
            hasRecordedReplay: true
        })).toThrow('complete available replay');

        expect(() => normalizeReplayPlaybackResponse({
            available: false,
            hasRecordedReplay: true,
            replayArchiveRevision: 'r2',
            replayVideo,
            reason: 'team-pass-required'
        })).toThrow('capability while unavailable');

        expect(normalizeReplayPlaybackResponse({
            available: false,
            hasRecordedReplay: true,
            replayArchiveRevision: 'r2',
            reason: 'team-pass-required'
        })).toEqual({
            available: false,
            hasRecordedReplay: true,
            replayArchiveRevision: 'r2',
            replayVideo: null,
            reason: 'team-pass-required'
        });
    });

    it('saves highlight clips through one exact retryable callable request', async () => {
        const unavailable = Object.assign(new Error('response lost'), { code: 'functions/unavailable' });
        const clips = [{ title: 'Fourth quarter', startMs: 1000, endMs: 5000 }];
        const highlightCall = vi.fn()
            .mockRejectedValueOnce(unavailable)
            .mockResolvedValueOnce({ data: {
                highlightClips: clips,
                highlightClipsRevision: 'r:next',
                lastMutationId: '11111111-2222-4333-8444-555555555555'
            } });
        const service = createGameReplayService({
            manageCall: vi.fn(),
            playbackCall: vi.fn(),
            highlightCall,
            cryptoImpl: secureCrypto()
        });

        await expect(service.saveHighlightClips({
            teamId: 'team-1',
            gameId: 'game-1',
            expectedRevision: 'r:old',
            highlightClips: clips
        })).resolves.toEqual({
            highlightClips: clips,
            highlightClipsRevision: 'r:next',
            lastMutationId: '11111111-2222-4333-8444-555555555555'
        });
        expect(highlightCall).toHaveBeenCalledTimes(2);
        expect(highlightCall.mock.calls[1][0]).toEqual(highlightCall.mock.calls[0][0]);
    });

    it('preserves ambiguous highlight uploads and rejects malformed responses', async () => {
        expect(() => normalizeHighlightClipsResponse({
            highlightClips: [],
            highlightClipsRevision: null,
            lastMutationId: 'mutation.1'
        })).toThrow('unversioned');

        const unavailable = Object.assign(new Error('offline'), { code: 'unavailable' });
        const service = createGameReplayService({
            manageCall: vi.fn(),
            playbackCall: vi.fn(),
            highlightCall: vi.fn().mockRejectedValue(unavailable),
            cryptoImpl: secureCrypto()
        });
        await expect(service.saveHighlightClips({
            teamId: 'team-1',
            gameId: 'game-1',
            highlightClips: []
        })).rejects.toMatchObject({ code: 'highlight-clips-commit-unknown' });
    });

    it('sends only the canonical URL, expected revision, and one stable mutation ID', async () => {
        const manageCall = vi.fn(async (request) => ({ data: {
            state: 'ready',
            hasRecordedReplay: true,
            replayArchiveRevision: 'r2',
            replayVideo
        } }));
        const service = createGameReplayService({
            manageCall,
            playbackCall: vi.fn(),
            cryptoImpl: secureCrypto()
        });

        const result = await service.setReplay({
            teamId: 'team-1',
            gameId: 'game-1',
            expectedRevision: 'r1',
            youtubeUrl: `https://youtu.be/${videoId}?si=clipboard`,
            title: ' Final   replay '
        });

        expect(result.replayVideo).toEqual(replayVideo);
        expect(manageCall).toHaveBeenCalledWith({
            action: 'set',
            teamId: 'team-1',
            gameId: 'game-1',
            expectedRevision: 'r1',
            mutationId: '11111111-2222-4333-8444-555555555555',
            youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
            title: 'Final replay'
        });
    });

    it('replays the exact mutation after an ambiguous response', async () => {
        const ambiguous = Object.assign(new Error('response lost'), { code: 'functions/unavailable' });
        const manageCall = vi.fn()
            .mockRejectedValueOnce(ambiguous)
            .mockResolvedValueOnce({
                state: 'removed',
                hasRecordedReplay: false,
                replayArchiveRevision: 'r2',
                lastMutationId: '11111111-2222-4333-8444-555555555555'
            });
        const service = createGameReplayService({
            manageCall,
            playbackCall: vi.fn(),
            cryptoImpl: secureCrypto()
        });

        await expect(service.removeReplay({
            teamId: 'team-1',
            gameId: 'game-1',
            expectedRevision: 'r1'
        })).resolves.toMatchObject({ state: 'removed', replayArchiveRevision: 'r2' });

        expect(manageCall).toHaveBeenCalledTimes(2);
        expect(manageCall.mock.calls[1][0]).toEqual(manageCall.mock.calls[0][0]);
    });

    it.each([
        ['set', new Error('response lost without a callable code')],
        ['remove', Object.assign(new Error('transport reported data loss'), { code: 'functions/data-loss' })]
    ])('replays the exact %s mutation when commit status is ambiguous', async (action, ambiguous) => {
        const success = action === 'set'
            ? {
                state: 'ready',
                hasRecordedReplay: true,
                replayArchiveRevision: 'r2',
                lastMutationId: '11111111-2222-4333-8444-555555555555',
                replayVideo
            }
            : {
                state: 'removed',
                hasRecordedReplay: false,
                replayArchiveRevision: 'r2',
                lastMutationId: '11111111-2222-4333-8444-555555555555'
            };
        const manageCall = vi.fn()
            .mockRejectedValueOnce(ambiguous)
            .mockResolvedValueOnce(success);
        const service = createGameReplayService({
            manageCall,
            playbackCall: vi.fn(),
            cryptoImpl: secureCrypto()
        });

        const operation = action === 'set'
            ? service.setReplay({
                teamId: 'team-1',
                gameId: 'game-1',
                expectedRevision: 'r1',
                youtubeUrl: replayVideo.publicUrl,
                title: replayVideo.title
            })
            : service.removeReplay({
                teamId: 'team-1',
                gameId: 'game-1',
                expectedRevision: 'r1'
            });
        await expect(operation).resolves.toMatchObject({ replayArchiveRevision: 'r2' });
        expect(manageCall).toHaveBeenCalledTimes(2);
        expect(manageCall.mock.calls[1][0]).toEqual(manageCall.mock.calls[0][0]);
    });

    it('replays an exact highlight request after a no-code transport error', async () => {
        const clips = [{ title: 'Fourth quarter', startMs: 1_000, endMs: 5_000 }];
        const highlightCall = vi.fn()
            .mockRejectedValueOnce(new TypeError('response lost'))
            .mockResolvedValueOnce({
                highlightClips: clips,
                highlightClipsRevision: 'r:next',
                lastMutationId: '11111111-2222-4333-8444-555555555555'
            });
        const service = createGameReplayService({
            manageCall: vi.fn(),
            playbackCall: vi.fn(),
            highlightCall,
            cryptoImpl: secureCrypto()
        });

        await expect(service.saveHighlightClips({
            teamId: 'team-1',
            gameId: 'game-1',
            expectedRevision: 'r:old',
            highlightClips: clips
        })).resolves.toMatchObject({ highlightClipsRevision: 'r:next' });
        expect(highlightCall).toHaveBeenCalledTimes(2);
        expect(highlightCall.mock.calls[1][0]).toEqual(highlightCall.mock.calls[0][0]);
    });

    it('authoritatively reconciles a committed write after two ambiguous responses', async () => {
        const unavailable = Object.assign(new Error('network unavailable'), { code: 'unavailable' });
        const manageCall = vi.fn()
            .mockRejectedValueOnce(unavailable)
            .mockRejectedValueOnce(unavailable)
            .mockResolvedValueOnce({
                state: 'ready',
                hasRecordedReplay: true,
                replayArchiveRevision: 'r2',
                lastMutationId: '11111111-2222-4333-8444-555555555555',
                replayVideo
            });
        const service = createGameReplayService({
            manageCall,
            playbackCall: vi.fn(),
            cryptoImpl: secureCrypto()
        });

        await expect(service.setReplay({
            teamId: 'team-1',
            gameId: 'game-1',
            expectedRevision: 'r1',
            youtubeUrl: replayVideo.publicUrl,
            title: replayVideo.title
        })).resolves.toMatchObject({
            state: 'ready',
            reconciled: true,
            replayArchiveRevision: 'r2'
        });
        expect(manageCall.mock.calls[2][0]).toEqual({
            action: 'read',
            teamId: 'team-1',
            gameId: 'game-1'
        });
    });

    it('does not reconcile a coincidentally matching replay written by a different mutation', async () => {
        const unavailable = Object.assign(new Error('network unavailable'), { code: 'unavailable' });
        const manageCall = vi.fn()
            .mockRejectedValueOnce(unavailable)
            .mockRejectedValueOnce(unavailable)
            .mockResolvedValueOnce({
                state: 'ready',
                hasRecordedReplay: true,
                replayArchiveRevision: 'r2',
                lastMutationId: 'different-writer-mutation',
                replayVideo
            });
        const service = createGameReplayService({
            manageCall,
            playbackCall: vi.fn(),
            cryptoImpl: secureCrypto()
        });

        await expect(service.setReplay({
            teamId: 'team-1',
            gameId: 'game-1',
            expectedRevision: 'r1',
            youtubeUrl: replayVideo.publicUrl,
            title: replayVideo.title
        })).rejects.toMatchObject({ code: 'replay-commit-unknown' });
    });

    it('does not reconcile the same mutation ID when the authoritative state is wrong', async () => {
        const unavailable = Object.assign(new Error('network unavailable'), { code: 'unavailable' });
        const manageCall = vi.fn()
            .mockRejectedValueOnce(unavailable)
            .mockRejectedValueOnce(unavailable)
            .mockResolvedValueOnce({
                state: 'removed',
                hasRecordedReplay: false,
                replayArchiveRevision: 'r2',
                lastMutationId: '11111111-2222-4333-8444-555555555555'
            });
        const service = createGameReplayService({
            manageCall,
            playbackCall: vi.fn(),
            cryptoImpl: secureCrypto()
        });

        await expect(service.setReplay({
            teamId: 'team-1',
            gameId: 'game-1',
            expectedRevision: 'r1',
            youtubeUrl: replayVideo.publicUrl,
            title: replayVideo.title
        })).rejects.toMatchObject({ code: 'replay-commit-unknown' });
    });

    it('preserves an unknown commit outcome when authoritative reconciliation is unavailable', async () => {
        const unavailable = Object.assign(new Error('network unavailable'), { code: 'functions/unavailable' });
        const manageCall = vi.fn().mockRejectedValue(unavailable);
        const service = createGameReplayService({
            manageCall,
            playbackCall: vi.fn(),
            cryptoImpl: secureCrypto()
        });

        await expect(service.removeReplay({
            teamId: 'team-1',
            gameId: 'game-1',
            expectedRevision: 'r1'
        })).rejects.toMatchObject({ code: 'replay-commit-unknown' });
        expect(manageCall).toHaveBeenCalledTimes(3);
    });

    it('releases playback only through the playback callable and validates the response', async () => {
        const playbackCall = vi.fn(async () => ({ data: {
            available: true,
            hasRecordedReplay: true,
            replayArchiveRevision: 'r9',
            replayVideo
        } }));
        const service = createGameReplayService({
            manageCall: vi.fn(),
            playbackCall,
            cryptoImpl: secureCrypto()
        });

        await expect(service.getPlayback({
            teamId: 'team-1',
            gameId: 'game-1',
            seasonId: 'season-1'
        })).resolves.toMatchObject({
            available: true,
            replayArchiveRevision: 'r9',
            replayVideo
        });
        expect(playbackCall).toHaveBeenCalledWith({
            teamId: 'team-1',
            gameId: 'game-1',
            seasonId: 'season-1'
        });
    });
});
