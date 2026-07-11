import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { buildPublicRsvpSummaryDelta } = require('../../functions/public-rsvp-summary-core.cjs');

describe('public RSVP summary delta', () => {
    const baseSummary = { going: 1, maybe: 1, notGoing: 0, notResponded: 2, total: 4 };

    it('moves a first response out of not responded', () => {
        expect(buildPublicRsvpSummaryDelta({
            summary: baseSummary,
            playerId: 'player-1',
            previousResponse: '',
            nextResponse: 'going'
        })).toEqual({ going: 2, maybe: 1, notGoing: 0, notResponded: 1, total: 4 });
    });

    it('moves a changed response between response buckets', () => {
        expect(buildPublicRsvpSummaryDelta({
            summary: baseSummary,
            playerId: 'player-1',
            previousResponse: 'maybe',
            nextResponse: 'not_going'
        })).toEqual({ going: 1, maybe: 0, notGoing: 1, notResponded: 2, total: 4 });
    });

    it('leaves a repeated response unchanged', () => {
        expect(buildPublicRsvpSummaryDelta({
            summary: baseSummary,
            playerId: 'player-1',
            previousResponse: 'going',
            nextResponse: 'going'
        })).toEqual(baseSummary);
    });

    it('updates a tracked not-responded player list when present', () => {
        const summary = { ...baseSummary, notRespondedPlayerIds: ['player-1', 'player-2'] };

        expect(buildPublicRsvpSummaryDelta({
            summary,
            playerId: 'player-1',
            previousResponse: '',
            nextResponse: 'maybe'
        })).toEqual({
            going: 1,
            maybe: 2,
            notGoing: 0,
            notResponded: 1,
            total: 4,
            notRespondedPlayerIds: ['player-2']
        });
    });

    it('requires a full recompute for missing or ambiguous summary state', () => {
        expect(buildPublicRsvpSummaryDelta({
            summary: null,
            previousResponse: '',
            nextResponse: 'going'
        })).toBeNull();
        expect(buildPublicRsvpSummaryDelta({
            summary: { ...baseSummary, going: 0 },
            previousResponse: 'going',
            nextResponse: 'maybe'
        })).toBeNull();
        expect(buildPublicRsvpSummaryDelta({
            summary: { ...baseSummary, total: 99 },
            previousResponse: '',
            nextResponse: 'going'
        })).toBeNull();
    });
});
