import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
const rsvpHookSource = readFileSync(
    new URL('../../apps/app/src/hooks/schedule/useScheduleEventRsvp.ts', import.meta.url),
    'utf8'
);

function getFunctionSource(source, signature) {
    const start = source.indexOf(signature);
    expect(start).toBeGreaterThanOrEqual(0);
    const next = source.indexOf('\nexport ', start + 1);
    return source.slice(start, next === -1 ? source.length : next);
}

describe('RSVP summary recompute is non-blocking', () => {
    it('defines a fire-and-forget background summary refresh helper', () => {
        expect(dbSource).toContain('function refreshGameRsvpSummaryInBackground(');
        const helper = dbSource.slice(
            dbSource.indexOf('function refreshGameRsvpSummaryInBackground('),
            dbSource.indexOf('export async function submitRsvp(')
        );
        // The helper must NOT be awaited internally beyond its own promise chain,
        // and must swallow permission/not-found errors so it can never throw into
        // the caller.
        expect(helper).toContain('computeRsvpSummary(teamId, gameId, options)');
        expect(helper).toContain('.catch(');
    });

    it('submitRsvp returns immediately after the write without awaiting the summary', () => {
        const fn = getFunctionSource(dbSource, 'export async function submitRsvp(');
        expect(fn).toContain('refreshGameRsvpSummaryInBackground(teamId, gameId)');
        expect(fn.indexOf('await commitFamilyRsvpWrite({')).toBeLessThan(fn.indexOf('refreshGameRsvpSummaryInBackground(teamId, gameId)'));
        // The blocking pattern (awaiting the summary before returning) is gone.
        expect(fn).not.toContain('await computeRsvpSummary');
        expect(fn).not.toContain('return summary;');
    });

    it('submitRsvpForPlayer returns immediately after the write without awaiting the summary', () => {
        const fn = getFunctionSource(dbSource, 'export async function submitRsvpForPlayer(');
        expect(fn).toContain('refreshGameRsvpSummaryInBackground(teamId, gameId, { freshRoster: true })');
        expect(fn).not.toContain('await computeRsvpSummary');
        expect(fn).not.toContain('return summary;');
    });
});

describe('RSVP error messaging', () => {
    it('does not label a timeout as being offline', () => {
        // A timeout is classified network, but the user is not necessarily offline
        // and the RSVP may have saved — surface a timeout-specific message.
        expect(rsvpHookSource).toMatch(/timed out\|timeout/);
        expect(rsvpHookSource).toContain('taking longer than expected');
    });
});
