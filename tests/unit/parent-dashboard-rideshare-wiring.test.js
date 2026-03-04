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
});
