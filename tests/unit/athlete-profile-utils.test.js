import { describe, it, expect } from 'vitest';
import {
    normalizeAthleteProfileDraft,
    summarizeAthleteProfileCareer,
    buildAthleteProfileShareUrl
} from '../../js/athlete-profile-utils.js';

describe('athlete profile helpers', () => {
    it('normalizes draft payloads and filters invalid clips', () => {
        const result = normalizeAthleteProfileDraft({
            athlete: { name: '  Jordan Smith  ', headline: '  2028 Guard  ' },
            bio: { hometown: ' Austin, TX ', graduationYear: '2028' },
            privacy: 'public',
            clips: [
                { title: ' Winner ', url: ' https://example.com/clip-1 ' },
                { title: '', url: '' }
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
            clips: [
                {
                    title: 'Winner',
                    url: 'https://example.com/clip-1',
                    label: ''
                }
            ],
            selectedSeasonKeys: ['team-1::player-1']
        });
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
