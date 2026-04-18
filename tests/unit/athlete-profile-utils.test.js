import { describe, it, expect } from 'vitest';
import {
    normalizeAthleteProfileDraft,
    collectAthleteProfileMediaCleanupPaths,
    summarizeAthleteProfileCareer,
    buildAthleteProfileShareUrl
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

    it('builds a shareable athlete profile URL', () => {
        expect(buildAthleteProfileShareUrl('https://allplays.example', 'profile-123')).toBe(
            'https://allplays.example/athlete-profile.html?profileId=profile-123'
        );
    });
});
