import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const smoke = readFileSync(new URL('../smoke/app-authenticated-core.spec.js', import.meta.url), 'utf8');
const schedule = readFileSync(new URL('../../apps/app/src/pages/Schedule.tsx', import.meta.url), 'utf8');
const matchers = [...smoke.matchAll(/heading: \/([^\n]+)\/,\n\s+requiredHref: `\/schedule\//g)]
    .map((match) => new RegExp(match[1]));

describe('production schedule smoke heading contract', () => {
    it('covers both staff and parent schedule visits', () => {
        expect(matchers).toHaveLength(2);
    });

    it.each(['Schedule', 'Team schedule management', 'Games, practices, RSVP'])(
        'recognizes the rendered responsive heading: %s', (heading) => {
            expect(schedule).toContain(heading);
            for (const matcher of matchers) expect(matcher.test(heading)).toBe(true);
        }
    );

    it.each(['Unable to load schedule', 'Access denied', 'Your day'])(
        'does not accept an error or another route: %s', (heading) => {
            for (const matcher of matchers) expect(matcher.test(heading)).toBe(false);
        }
    );
});
