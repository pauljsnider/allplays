import { describe, it, expect } from 'vitest';
import { hasPlayerProfileParticipation } from '../../js/player-profile-stats.js';

describe('player profile stats participation', () => {
    it('excludes players explicitly marked did not play', () => {
        expect(hasPlayerProfileParticipation({
            didNotPlay: true,
            timeMs: 0,
            stats: { pts: 12 }
        })).toBe(false);
    });

    it('excludes unused roster aggregate documents with only zero stats', () => {
        expect(hasPlayerProfileParticipation({
            timeMs: 0,
            stats: { pts: 0, ast: 0, reb: 0, fouls: 0 }
        })).toBe(false);
    });

    it('includes explicitly marked zero-stat appearances', () => {
        expect(hasPlayerProfileParticipation({
            participated: true,
            timeMs: 0,
            stats: { pts: 0, ast: 0, reb: 0, fouls: 0 }
        })).toBe(true);

        expect(hasPlayerProfileParticipation({
            participationStatus: 'appeared',
            stats: { pts: 0, fouls: 0 }
        })).toBe(true);
    });

    it('keeps did not play as the highest precedence participation signal', () => {
        expect(hasPlayerProfileParticipation({
            didNotPlay: true,
            participated: true,
            participationStatus: 'appeared',
            timeMs: 120000,
            stats: { pts: 8 }
        })).toBe(false);
    });

    it('excludes explicitly unused aggregate documents', () => {
        expect(hasPlayerProfileParticipation({
            participationStatus: 'unused',
            timeMs: 0,
            stats: { pts: 0, ast: 0, reb: 0, fouls: 0 }
        })).toBe(false);
    });

    it('includes players with recorded time or non-zero stats', () => {
        expect(hasPlayerProfileParticipation({ timeMs: 30000, stats: { pts: 0 } })).toBe(true);
        expect(hasPlayerProfileParticipation({ timeMs: 0, stats: { pts: 0, ast: 1 } })).toBe(true);
    });
});
