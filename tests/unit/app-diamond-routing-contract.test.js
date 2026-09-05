import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readRepo = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('app Diamond routing compatibility contract', () => {
    it('loads the shared React scorebook at one protected route', () => {
        const source = readRepo('apps/app/src/App.tsx');

        expect(source).toContain("import('./pages/DiamondScorebook')");
        expect(source).toContain('path="/schedule/:teamId/:eventId/diamond-v2"');
        expect(source).toContain('<Protected auth={auth}><DiamondScorebook auth={auth} /></Protected>');
    });

    it('carries the permanent engine discriminator through schedule models', () => {
        const logic = readRepo('apps/app/src/lib/scheduleLogic.ts');
        const service = readRepo('apps/app/src/lib/scheduleService.ts');

        expect(logic).toContain('trackingEngine?: string | null;');
        expect(service).toContain('trackingEngine: compactString(input.trackingEngine) || null');
        expect(service).toContain('trackingEngine: game.trackingEngine || null');
    });

    it('fails the legacy app tracker closed for every explicit engine', () => {
        const source = readRepo('apps/app/src/pages/StandardTracker.tsx');
        const hub = readRepo('apps/app/src/pages/schedule/ScheduleGameHubSection.tsx');

        expect(source).toContain('&& !loadedEvent.trackingEngine');
        expect(hub).toContain('const canUseLegacyScoring = canUpdateScore && !event.trackingEngine');
        expect(hub).toContain('data-testid="diamond-scorebook-launch"');
        expect(hub).toContain('data-testid="diamond-activation-card"');
        expect(hub).toContain("service.getDiamondAccess(event.teamId, { gameId: event.id })");
        expect(hub).toContain("service.activateDiamondGame({ teamId: event.teamId, gameId: event.id, captureMode })");
        expect(hub).toContain('if (!shouldCheck || !access?.eligible || !access.canManage || !access.teamOptIn');
        expect(hub).toContain('Score, plays, lineups, and corrections are controlled by the Diamond ledger.');
    });
});
