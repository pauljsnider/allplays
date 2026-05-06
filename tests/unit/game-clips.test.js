import { describe, expect, it, vi } from 'vitest';
import {
    MAX_GAME_CLIP_UPLOAD_SIZE,
    buildScoreLinkedClipRecord,
    isScoredPlayEvent,
    validateGameClipFile
} from '../../js/game-clips.js';

describe('game clip helpers', () => {
    it('builds score-linked clip records with score context and selected players', () => {
        vi.spyOn(Date, 'now').mockReturnValue(123456789);
        vi.spyOn(Math, 'random').mockReturnValue(0.123456);

        const clip = buildScoreLinkedClipRecord({
            teamId: 'team-1',
            gameId: 'game-1',
            event: {
                id: 'event-1',
                playerId: 'player-1',
                statKey: 'pts',
                value: 3,
                homeScore: 21,
                awayScore: 18,
                period: 'Q2',
                gameClockMs: 75_000,
                description: 'Corner three'
            },
            playerIds: ['player-2'],
            title: 'Corner three',
            caption: 'Big shot before half',
            media: {
                url: 'https://cdn.example.com/clip.mp4',
                source: 'external',
                type: 'video/mp4',
                size: 1234
            },
            createdBy: 'coach-1'
        });

        expect(clip).toMatchObject({
            type: 'score-linked',
            teamId: 'team-1',
            gameId: 'game-1',
            playEventId: 'event-1',
            selectedPlayerIds: ['player-1', 'player-2'],
            title: 'Corner three',
            caption: 'Big shot before half',
            mediaUrl: 'https://cdn.example.com/clip.mp4',
            mimeType: 'video/mp4',
            sizeBytes: 1234,
            scoreContext: {
                homeScore: 21,
                awayScore: 18,
                period: 'Q2',
                gameClockMs: 75_000,
                scoringTeam: 'home',
                points: 3
            },
            createdBy: 'coach-1'
        });

        Date.now.mockRestore();
        Math.random.mockRestore();
    });

    it('rejects unsupported and oversized uploaded media', () => {
        expect(() => validateGameClipFile({ type: 'image/png', size: 1000 })).toThrow('video file');
        expect(() => validateGameClipFile({ type: 'video/mp4', size: MAX_GAME_CLIP_UPLOAD_SIZE + 1 })).toThrow('50MB');
    });

    it('detects scored play events only', () => {
        expect(isScoredPlayEvent({ statKey: 'pts', value: 2 })).toBe(true);
        expect(isScoredPlayEvent({ statKey: 'reb', value: 1 })).toBe(false);
    });
});
