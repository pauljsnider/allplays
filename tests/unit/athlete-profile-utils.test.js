import { describe, it, expect } from 'vitest';
import {
    normalizeAthleteProfileDraft,
    collectAthleteProfileMediaCleanupPaths,
    summarizeAthleteProfileCareer,
    buildAthleteProfileShareUrl,
    collectAthleteGameClipsForPlayer
} from '../../js/athlete-profile-utils.js';

describe('athlete profile helpers', () => {
    it('normalizes uploaded media, legacy clips, and custom headshots', () => {
        const result = normalizeAthleteProfileDraft({
            athlete: { name: '  Jordan Smith  ', headline: '  2028 Guard  ' },
            bio: { hometown: ' Austin, TX ', graduationYear: '2028' },
            privacy: 'public',
            profilePhoto: {
                url: ' https://example.com/headshot.png ',
                storagePath: ' athlete-profile-media/u1/p1/photo.png ',
                mimeType: ' image/png ',
                sizeBytes: '1024',
                uploadedAtMs: '1700000000000'
            },
            clips: [
                {
                    id: ' clip-1 ',
                    source: ' upload ',
                    mediaType: ' video ',
                    title: ' Winner ',
                    url: ' https://example.com/clip-1.mp4 ',
                    label: ' Game winner ',
                    storagePath: ' athlete-profile-media/u1/p1/clip-1.mp4 ',
                    mimeType: ' video/mp4 ',
                    sizeBytes: '2048',
                    uploadedAtMs: '1700000001000'
                },
                { title: ' Legacy ', url: ' https://example.com/clip-2 ', label: ' Hudl ' },
                { source: 'upload', title: '', url: '' }
            ],
            selectedSeasonKeys: ['team-1::player-1', '', 'team-1::player-1']
        });

        expect(result).toEqual({
            athlete: { name: 'Jordan Smith', headline: '2028 Guard' },
            bio: {
                hometown: 'Austin, TX',
                graduationYear: '2028',
                position: '',
                dominantHand: '',
                achievements: ''
            },
            privacy: 'public',
            profilePhoto: {
                url: 'https://example.com/headshot.png',
                storagePath: 'athlete-profile-media/u1/p1/photo.png',
                mimeType: 'image/png',
                sizeBytes: 1024,
                uploadedAtMs: 1700000000000
            },
            clips: [
                {
                    id: 'clip-1',
                    source: 'upload',
                    mediaType: 'video',
                    title: 'Winner',
                    url: 'https://example.com/clip-1.mp4',
                    label: 'Game winner',
                    storagePath: 'athlete-profile-media/u1/p1/clip-1.mp4',
                    mimeType: 'video/mp4',
                    sizeBytes: 2048,
                    uploadedAtMs: 1700000001000
                },
                {
                    id: '',
                    source: 'external',
                    mediaType: 'link',
                    title: 'Legacy',
                    url: 'https://example.com/clip-2',
                    label: 'Hudl',
                    storagePath: '',
                    mimeType: '',
                    sizeBytes: null,
                    uploadedAtMs: null
                }
            ],
            selectedSeasonKeys: ['team-1::player-1']
        });
    });

    it('collects removed uploaded media paths without touching retained assets', () => {
        const cleanupPaths = collectAthleteProfileMediaCleanupPaths({
            profilePhotoPath: 'athlete-profile-media/u1/p1/old-photo.png',
            clips: [
                { storagePath: 'athlete-profile-media/u1/p1/keep.mp4' },
                { storagePath: 'athlete-profile-media/u1/p1/remove.mp4' }
            ]
        }, {
            profilePhoto: {
                url: 'https://example.com/new-photo.png',
                storagePath: 'athlete-profile-media/u1/p1/new-photo.png'
            },
            clips: [
                {
                    source: 'upload',
                    mediaType: 'video',
                    url: 'https://example.com/keep.mp4',
                    storagePath: 'athlete-profile-media/u1/p1/keep.mp4'
                },
                {
                    source: 'external',
                    mediaType: 'link',
                    url: 'https://example.com/legacy'
                }
            ]
        });

        expect(cleanupPaths).toEqual([
            'athlete-profile-media/u1/p1/old-photo.png',
            'athlete-profile-media/u1/p1/remove.mp4'
        ]);
    });

    it('builds career totals and averages across selected seasons', () => {
        const summary = summarizeAthleteProfileCareer([
            {
                gamesPlayed: 2,
                totalTimeMs: 600000,
                statTotals: { PTS: 24, AST: 6 }
            },
            {
                gamesPlayed: 1,
                totalTimeMs: 300000,
                statTotals: { PTS: 9, REB: 5 }
            }
        ]);

        expect(summary).toEqual({
            gamesPlayed: 3,
            totalMinutes: 15,
            statTotals: { PTS: 33, AST: 6, REB: 5 },
            statAverages: { PTS: '11.0', AST: '2.0', REB: '1.7' }
        });
    });


    it('collects score-linked game clips for a player and hides non-public clips', () => {
        const clips = collectAthleteGameClipsForPlayer([
            {
                id: 'game-1',
                opponentName: 'Tigers',
                date: '2026-04-26',
                homeTeamName: 'Eagles',
                awayTeamName: 'Tigers',
                highlightClips: [
                    { id: 'clip-1', playerIds: ['player-1'], title: 'Fast break', homeScore: 12, awayScore: 10, startMs: '1000', endMs: '9000' },
                    { id: 'clip-2', playerIds: ['player-1'], title: 'Hidden bucket', hidden: true },
                    { id: 'clip-5', playerIds: ['player-1'], title: 'Game Photo', mediaType: 'image', url: 'https://example.com/game-photo.png', homeScore: 12, awayScore: 10 },
                    { id: 'clip-3', playerIds: ['player-2'], title: 'Other player' }
                ]
            },
            {
                id: 'game-2',
                opponent: 'Bears',
                gameClips: [
                    { clipId: 'clip-4', playerId: 'player-1', playDescription: 'Corner three', scoreContext: 'Eagles lead 44-41' }
                ]
            }
        ], { teamId: 'team-1', teamName: 'Eagles', playerId: 'player-1' });

        expect(clips).toEqual([
            {
                id: 'clip-1',
                source: 'game',
                mediaType: 'link',
                title: 'Fast break',
                url: '',
                teamId: 'team-1',
                teamName: 'Eagles',
                gameId: 'game-1',
                game: 'Tigers',
                date: '2026-04-26',
                playDescription: 'Fast break',
                scoreContext: 'Eagles 12, Tigers 10',
                startMs: 1000,
                endMs: 9000
            },
            {
                id: 'clip-5',
                source: 'game',
                mediaType: 'image',
                title: 'Game Photo',
                url: 'https://example.com/game-photo.png',
                teamId: 'team-1',
                teamName: 'Eagles',
                gameId: 'game-1',
                game: 'Tigers',
                date: '2026-04-26',
                playDescription: 'Game Photo',
                scoreContext: 'Eagles 12, Tigers 10',
                startMs: null,
                endMs: null
            },
            {
                id: 'clip-4',
                source: 'game',
                mediaType: 'link',
                title: 'Corner three',
                url: '',
                teamId: 'team-1',
                teamName: 'Eagles',
                gameId: 'game-2',
                game: 'Bears',
                date: '',
                playDescription: 'Corner three',
                scoreContext: 'Eagles lead 44-41',
                startMs: null,
                endMs: null
            }
        ]);
    });

    it('builds a shareable athlete profile URL', () => {
        expect(buildAthleteProfileShareUrl('https://allplays.example', 'profile-123')).toBe(
            'https://allplays.example/athlete-profile.html?profileId=profile-123'
        );
    });

    it('preserves public privacy through normalization', () => {
        const result = normalizeAthleteProfileDraft({
            athlete: { name: 'Jordan' },
            bio: {},
            privacy: 'public',
            clips: [],
            selectedSeasonKeys: ['team-1::player-1']
        });
        expect(result.privacy).toBe('public');
    });

    it('preserves private privacy through normalization', () => {
        const result = normalizeAthleteProfileDraft({
            athlete: { name: 'Jordan' },
            bio: {},
            privacy: 'private',
            clips: [],
            selectedSeasonKeys: ['team-1::player-1']
        });
        expect(result.privacy).toBe('private');
    });

    it('defaults to private when privacy is missing, undefined, or an unrecognized value', () => {
        expect(normalizeAthleteProfileDraft({ athlete: {}, bio: {}, clips: [] }).privacy).toBe('private');
        expect(normalizeAthleteProfileDraft({ athlete: {}, bio: {}, privacy: undefined, clips: [] }).privacy).toBe('private');
        expect(normalizeAthleteProfileDraft({ athlete: {}, bio: {}, privacy: null, clips: [] }).privacy).toBe('private');
        expect(normalizeAthleteProfileDraft({ athlete: {}, bio: {}, privacy: '', clips: [] }).privacy).toBe('private');
        expect(normalizeAthleteProfileDraft({ athlete: {}, bio: {}, privacy: 'Public', clips: [] }).privacy).toBe('private');
        expect(normalizeAthleteProfileDraft({ athlete: {}, bio: {}, privacy: 'PUBLIC', clips: [] }).privacy).toBe('private');
        expect(normalizeAthleteProfileDraft({ athlete: {}, bio: {}, privacy: 'secret', clips: [] }).privacy).toBe('private');
    });
});
