import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
    buildPublicRsvpSummaryDelta,
    buildPublicRsvpSummaryJobPlan
} = require('../../functions/public-rsvp-summary-core.cjs');

describe('public RSVP summary delta', () => {
    const baseSummary = {
        going: 1,
        maybe: 1,
        notGoing: 0,
        notResponded: 2,
        total: 4,
        notRespondedPlayerIds: ['player-3', 'player-4']
    };

    it('moves a first response out of not responded', () => {
        expect(buildPublicRsvpSummaryDelta({
            summary: { ...baseSummary, notRespondedPlayerIds: ['player-1', 'player-4'] },
            playerId: 'player-1',
            previousResponse: '',
            nextResponse: 'going'
        })).toEqual({
            going: 2,
            maybe: 1,
            notGoing: 0,
            notResponded: 1,
            total: 4,
            notRespondedPlayerIds: ['player-4']
        });
    });

    it('moves a changed response between response buckets', () => {
        expect(buildPublicRsvpSummaryDelta({
            summary: baseSummary,
            playerId: 'player-1',
            previousResponse: 'maybe',
            previousResponseVerified: true,
            nextResponse: 'not_going'
        })).toEqual({ ...baseSummary, maybe: 0, notGoing: 1 });
    });

    it('leaves a repeated response unchanged', () => {
        expect(buildPublicRsvpSummaryDelta({
            summary: baseSummary,
            playerId: 'player-1',
            previousResponse: 'going',
            previousResponseVerified: true,
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
            playerId: 'player-1',
            previousResponse: '',
            nextResponse: 'going'
        })).toBeNull();
        expect(buildPublicRsvpSummaryDelta({
            summary: baseSummary,
            playerId: 'player-1',
            previousResponse: 'going',
            nextResponse: 'maybe'
        })).toBeNull();
        expect(buildPublicRsvpSummaryDelta({
            summary: { ...baseSummary, total: 99 },
            playerId: 'player-3',
            previousResponse: '',
            nextResponse: 'going'
        })).toBeNull();
    });

    it('rejects a concurrent stale first-response delta after membership already moved', () => {
        const initial = { ...baseSummary, notRespondedPlayerIds: ['player-1', 'player-4'] };
        const first = buildPublicRsvpSummaryDelta({
            summary: initial,
            playerId: 'player-1',
            previousResponse: '',
            nextResponse: 'going'
        });

        expect(first).not.toBeNull();
        expect(buildPublicRsvpSummaryDelta({
            summary: first,
            playerId: 'player-1',
            previousResponse: '',
            nextResponse: 'maybe'
        })).toBeNull();
    });

    it('orders concurrent token jobs through the per-player applied-response ledger', () => {
        const initial = { ...baseSummary, notRespondedPlayerIds: ['player-1', 'player-4'] };

        expect(buildPublicRsvpSummaryJobPlan({
            jobId: 'job-a',
            playerId: 'player-1',
            response: 'going',
            playerState: { latestJobId: 'job-b', latestResponse: 'maybe' },
            summary: initial
        })).toEqual({ mode: 'obsolete', summary: null });

        const latestPlan = buildPublicRsvpSummaryJobPlan({
            jobId: 'job-b',
            playerId: 'player-1',
            response: 'maybe',
            playerState: { latestJobId: 'job-b', latestResponse: 'maybe' },
            summary: initial
        });
        expect(latestPlan).toMatchObject({
            mode: 'delta',
            summary: { going: 1, maybe: 2, notGoing: 0, notResponded: 1, total: 4 }
        });

        const changedPlan = buildPublicRsvpSummaryJobPlan({
            jobId: 'job-c',
            playerId: 'player-1',
            response: 'not_going',
            playerState: {
                latestJobId: 'job-c',
                latestResponse: 'not_going',
                appliedJobId: 'job-b',
                appliedResponse: 'maybe'
            },
            summary: latestPlan.summary
        });
        expect(changedPlan).toEqual({ mode: 'recompute', summary: null });

        expect(buildPublicRsvpSummaryJobPlan({
            jobId: 'job-b',
            playerId: 'player-1',
            response: 'maybe',
            playerState: {
                latestJobId: 'job-b',
                latestResponse: 'maybe',
                appliedJobId: 'job-b',
                appliedResponse: 'maybe'
            },
            summary: latestPlan.summary
        })).toEqual({ mode: 'already_applied', summary: null });
    });
});
