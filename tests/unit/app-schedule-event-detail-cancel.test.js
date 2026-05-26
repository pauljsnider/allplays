import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readDetailSource() {
    return readFileSync(new URL('../../apps/app/src/pages/ScheduleEventDetail.tsx', import.meta.url), 'utf8');
}

describe('React app schedule event detail cancellation action', () => {
    it('wires a staff-only non-cancelled DB game action through the cancellation service', () => {
        const source = readDetailSource();

        expect(source).toContain('cancelScheduledGameForApp');
        expect(source).toContain("const canCancelGame = Boolean(!isPractice && event.isDbGame && !event.isCancelled && event.canUpdateScore && auth.user);");
        expect(source).toContain('Cancel game');
        expect(source).toContain('This marks the game cancelled and notifies the team in chat.');
        expect(source).toContain("{ ...event, status: 'cancelled', isCancelled: true, availabilityLocked: true }");
        expect(source).toContain('Game cancelled, but team chat notification failed:');
    });
});
