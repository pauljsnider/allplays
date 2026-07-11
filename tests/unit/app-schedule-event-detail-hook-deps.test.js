import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('React app schedule event detail hook dependencies', () => {
    it('keeps event-driven editors and score autosave wired to current props', () => {
        const source = readFileSync(resolve('apps/app/src/pages/ScheduleEventDetail.tsx'), 'utf8');

        expect(source).toContain('const formResetKey = buildGameFormResetKey(event);');
        expect(source).toContain('}, [formResetKey]);');
        expect(source).toContain('}, [columns, event.id, event.teamId, roster])');
        expect(source).toContain('const saveScore = useCallback(async');
        expect(source).toContain('}, [auth.user, awayScore, event.id, event.teamId, homeScore, onScoreUpdated, savedAwayScore, savedHomeScore]);');
        expect(source).toContain('}, [auth.user, awayScore, dirty, homeScore, playerScoringId, saveScore, saving]);');
        expect(source).toContain('}, [childEvents, event]);');
        expect(source).toContain('}, [event.eventKey, eventFormationId, resetLineupBuilderState]);');
    });
});
