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

    it('includes players with recorded time or non-zero stats', () => {
        expect(hasPlayerProfileParticipation({ timeMs: 30000, stats: { pts: 0 } })).toBe(true);
        expect(hasPlayerProfileParticipation({ timeMs: 0, stats: { pts: 0, ast: 1 } })).toBe(true);
    });
});
