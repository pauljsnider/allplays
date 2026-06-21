import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();

function readRepoFile(path) {
    return readFileSync(join(repoRoot, path), 'utf8');
}

describe('ScheduleEventDetail decomposition', () => {
    it('keeps extracted navigation, availability, RSVP, and rideshare pieces wired in', () => {
        const source = readRepoFile('apps/app/src/pages/ScheduleEventDetail.tsx');

        expect(source).toContain("from '../components/schedule/EventSectionNav'");
        expect(source).toContain("from '../components/schedule/AvailabilityPanels'");
        expect(source).toContain("from './schedule/ScheduleEventDetailContext'");
        expect(source).toContain("from '../hooks/schedule/useScheduleEventRsvp'");
        expect(source).toContain("from '../hooks/schedule/useScheduleRideOffers'");
        expect(source).toContain('<ScheduleEventDetailProvider value={{');
        expect(source).toContain('useScheduleEventRsvp({ availabilityNote })');
        expect(source).toContain('useScheduleRideOffers()');
    });

    it('keeps extracted schedule detail modules under focused tests', () => {
        [
            'apps/app/src/components/schedule/ScheduleEventSummaryComponents.test.tsx',
            'apps/app/src/hooks/schedule/useScheduleEventRsvp.test.tsx',
            'apps/app/src/hooks/schedule/useScheduleRideOffers.test.tsx'
        ].forEach((path) => {
            expect(readRepoFile(path).length).toBeGreaterThan(0);
        });
    });
});
