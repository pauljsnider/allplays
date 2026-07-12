import { describe, expect, it } from 'vitest';

import {
    REQUIRED_METRICS,
    REQUIRED_PROFILES,
    buildMarkdownSummary,
    validateMeasurementArtifact
} from '../../scripts/validate-app-performance-measurements.mjs';

const baselineSha = 'a60d0c56c5959b2d90fbf791d99a6fbc1a7d9ee1';
const afterSha = '5976012e';

function buildRun(run, overrides = {}) {
    return {
        run,
        coldStartHomeTtiMs: 1800 + run,
        warmResumeMs: 640 + run,
        readsHomeMount: 24 + run,
        readsScheduleMount: 18 + run,
        readsMessagesMount: 12 + run,
        entryChunkGzipBytes: 132000 + run,
        rsvpTapLatencyMs: 420 + run,
        chatSendLatencyMs: 520 + run,
        ...overrides
    };
}

function buildPhase(sha, capturedAt) {
    return {
        sha,
        capturedAt,
        runs: [
            buildRun(1),
            buildRun(2),
            buildRun(3)
        ]
    };
}

function buildArtifact(overrides = {}) {
    return {
        issue: 2050,
        baselineSha,
        afterSha,
        fixture: {
            testAccount: 'perf-parent@example.com',
            teamOrOrganization: 'Bears 12U seeded team',
            homeTeamCount: 3,
            scheduleEventCount: 20,
            messageThreadCount: 5
        },
        profiles: REQUIRED_PROFILES.map((id) => ({
            id,
            label: id,
            environment: {
                hardware: `${id} device`,
                os: 'Test OS 1.0',
                runtime: id.includes('web') ? 'Chrome web' : 'Capacitor native',
                browserOrWebView: 'Chrome 140',
                network: id === 'throttled-4g-web' ? 'Slow 4G' : 'Wi-Fi',
                cpu: id === 'throttled-4g-web' ? '4x throttle' : 'No throttle'
            },
            before: buildPhase(baselineSha, '2026-07-12T12:00:00.000Z'),
            after: buildPhase(afterSha, '2026-07-12T13:00:00.000Z')
        })),
        ...overrides
    };
}

describe('app performance measurement validator', () => {
    it('accepts a complete issue 2050 before/after artifact and reports medians', () => {
        const result = validateMeasurementArtifact(buildArtifact());

        expect(result.errors).toEqual([]);
        expect(result.summary.profileCount).toBe(4);
        expect(result.summary.runCount).toBe(24);
        expect(result.summary.profiles[0].phases.before.medians.coldStartHomeTtiMs).toBe(1802);

        const markdown = buildMarkdownSummary(result.summary);
        expect(markdown).toContain('| Profile | Phase | Cold-start TTI Home | Warm resume |');
        expect(markdown).toContain('| desktop-web | before | 1802ms | 642ms |');
    });

    it('rejects missing profiles, incomplete phases, and placeholder metric values', () => {
        const artifact = buildArtifact({
            profiles: [
                {
                    ...buildArtifact().profiles[0],
                    after: {
                        sha: afterSha,
                        capturedAt: 'not a date',
                        runs: [
                            buildRun(1, { coldStartHomeTtiMs: '_tbd_' }),
                            buildRun(1)
                        ]
                    }
                }
            ]
        });

        const result = validateMeasurementArtifact(artifact);

        expect(result.errors).toContain('profiles must include throttled-4g-web.');
        expect(result.errors).toContain('profiles must include mid-range-android.');
        expect(result.errors).toContain('profiles must include iphone.');
        expect(result.errors).toContain('profile desktop-web after.capturedAt must be parseable as a date.');
        expect(result.errors).toContain('profile desktop-web after.runs must include at least 3 clean runs.');
        expect(result.errors).toContain('profile desktop-web after.runs contains duplicate run 1.');
        expect(result.errors).toContain('profile desktop-web after.runs[0].coldStartHomeTtiMs must be a number >= 1.');
    });

    it('keeps the validator aligned with all issue 2050 metrics', () => {
        expect(REQUIRED_METRICS.map((metric) => metric.key)).toEqual([
            'coldStartHomeTtiMs',
            'warmResumeMs',
            'readsHomeMount',
            'readsScheduleMount',
            'readsMessagesMount',
            'entryChunkGzipBytes',
            'rsvpTapLatencyMs',
            'chatSendLatencyMs'
        ]);
    });
});
