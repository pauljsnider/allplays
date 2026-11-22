import { describe, expect, it } from 'vitest';
import { parseOverlayParams, resolveOverlayClip, getOverlayReplayBounds, buildOverlayReplayUrl } from '../../js/live-game-overlay-clip.js';

describe('overlay highlight links', () => {
    it('accepts legacy hashes and gives explicit query values precedence', () => {
        expect(parseOverlayParams('?teamId=new&clipStart=2000', '#teamId=old&gameId=game&replay=true&clipStart=0&clipEnd=4000'))
            .toEqual({ teamId: 'new', gameId: 'game', replay: 'true', clipStart: '2000', clipEnd: '4000' });
    });
    it.each(['recorded', 'youtube'])('waits for real duration before enabling %s highlights', (videoMode) => {
        const params = { clipStart: '2000', clipEnd: '4000' };
        expect(resolveOverlayClip(params, { videoMode }).status).toBe('pending');
        const clip = resolveOverlayClip(params, { videoMode, durationMs: 8000 });
        expect(clip).toEqual({ status: 'active', startMs: 2000, endMs: 4000 });
        expect(getOverlayReplayBounds(clip, 10000)).toEqual({ startMs: 2000, endMs: 4000 });
    });
    it.each([
        { clipStart: '' }, { clipEnd: '4' }, { clipStart: 'NaN', clipEnd: '4' },
        { clipStart: '-1', clipEnd: '4' }, { clipStart: '4', clipEnd: '4' },
        { clipStart: '5', clipEnd: '4' }, { clipStart: '0', clipEnd: 'Infinity' },
        { clipStart: '0', clipEnd: '9000' }
    ])('rejects invalid ranges instead of silently playing the full video: %j', (params) => {
        expect(resolveOverlayClip(params, { videoMode: 'recorded', durationMs: 8000 }).status).toBe('invalid');
    });
    it('preserves whole replay and explains unsupported providers', () => {
        expect(resolveOverlayClip({})).toEqual({ status: 'none' });
        expect(getOverlayReplayBounds({ status: 'none' }, 12000)).toEqual({ startMs: 0, endMs: 12000 });
        expect(resolveOverlayClip({ clipStart: '0', clipEnd: '2000' }, { videoMode: 'embed' }).status).toBe('unavailable');
    });
    it('preserves clip shares and clears both timestamp encodings on full-game exit', () => {
        const href = 'https://allplays.ai/live-game-overlay.html#teamId=t&gameId=g&clipStart=2000&clipEnd=4000';
        const share = new URL(buildOverlayReplayUrl(href));
        expect(share.searchParams.get('clipStart')).toBe('2000');
        expect(share.searchParams.get('replay')).toBe('true');
        const full = new URL(buildOverlayReplayUrl(href, { fullGame: true }));
        expect([...full.searchParams]).toEqual([['teamId', 't'], ['gameId', 'g'], ['replay', 'true']]);
        expect(full.hash).toBe('');
    });
});
