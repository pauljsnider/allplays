import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('parent dashboard rideshare wiring', () => {
    it('keeps a single submitGameRsvp assignment and no accidental wrapper around rideshare helpers', () => {
        const html = readRepoFile('parent-dashboard.html');
        const submitAssignments = html.match(/window\.submitGameRsvp\s*=\s*async function\s*\(/g) || [];

        expect(submitAssignments).toHaveLength(1);
        expect(html).not.toMatch(/window\.submitGameRsvp\s*=\s*async function\s*\([^)]*\)\s*\{\s*function\s+getEventRideKey\s*\(/s);
    });

    it('allows rideshare rendering for practice events even when not db-tracked', () => {
        const html = readRepoFile('parent-dashboard.html');

        expect(html).toContain('function canShowRideshareForEvent(event)');
        expect(html).toContain('event?.isDbGame || event?.type === \'practice\'');
        expect(html).toContain('if (!canShowRideshareForEvent(event)) return \'\';');
    });

    it('hydrates rideshare offers for practices and db-tracked events', () => {
        const html = readRepoFile('parent-dashboard.html');

        expect(html).toContain('.filter((ev) => canShowRideshareForEvent(ev))');
    });

    it('wires the extracted rideshare control helpers into the dashboard modal flow', () => {
        const html = readRepoFile('parent-dashboard.html');

        expect(html).toContain("from './js/parent-dashboard-rideshare-controls.js?v=1'");
        expect(html).toContain('resolveSelectedRideChildId({');
        expect(html).toContain('createRideRequestHandlers({');
        expect(html).toContain('selectedRideChildByOffer');
    });
});
