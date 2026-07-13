import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    MAX_ARTIFACT_BYTES,
    MAX_RUNS_PER_PHASE,
    REQUIRED_ENVIRONMENT_FIELDS,
    REQUIRED_METRICS,
    REQUIRED_PROFILES,
    buildMarkdownSummary,
    readMeasurementArtifact,
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
        expect(result.errors).toContain('profile desktop-web after.capturedAt must be a valid ISO timestamp with a timezone.');
        expect(result.errors).toContain('profile desktop-web after.runs must include at least 3 clean runs.');
        expect(result.errors).toContain('profile desktop-web after.runs contains duplicate run 1.');
        expect(result.errors).toContain('profile desktop-web after.runs[0].coldStartHomeTtiMs must be a number >= 1.');
    });

    it('rejects placeholder fixture account and environment evidence strings', () => {
        const fixtureArtifact = buildArtifact({
            fixture: {
                ...buildArtifact().fixture,
                testAccount: '_tbd_'
            }
        });

        expect(validateMeasurementArtifact(fixtureArtifact).errors).toContain(
            'fixture.testAccount must be real evidence, not a placeholder.'
        );

        for (const field of REQUIRED_ENVIRONMENT_FIELDS) {
            const artifact = buildArtifact();
            artifact.profiles[0] = {
                ...artifact.profiles[0],
                environment: {
                    ...artifact.profiles[0].environment,
                    [field]: '_tbd_'
                }
            };

            expect(validateMeasurementArtifact(artifact).errors).toContain(
                `profile desktop-web environment.${field} must be real evidence, not a placeholder.`
            );
        }
    });

    it('rejects descriptive placeholders, empty fixtures, and unsafe integer evidence', () => {
        const artifact = buildArtifact();
        artifact.fixture.testAccount = 'TBD - choose a synthetic account';
        artifact.fixture.accessToken = 'must-not-be-committed';
        artifact.fixture.homeTeamCount = 0;
        artifact.fixture.scheduleEventCount = Number.MAX_SAFE_INTEGER + 1;
        artifact.profiles[0].environment.hardware = 'unknown device';
        artifact.profiles[0].before.runs[0].readsHomeMount = Number.MAX_SAFE_INTEGER + 1;

        const result = validateMeasurementArtifact(artifact);

        expect(result.errors).toContain('fixture.testAccount must be real evidence, not a placeholder.');
        expect(result.errors).toContain('artifact must not include password, secret, token, credential, or private-key fields.');
        expect(result.errors).toContain('fixture.homeTeamCount must be a positive safe integer.');
        expect(result.errors).toContain('fixture.scheduleEventCount must be a positive safe integer.');
        expect(result.errors).toContain('profile desktop-web environment.hardware must be real evidence, not a placeholder.');
        expect(result.errors).toContain('profile desktop-web before.runs[0].readsHomeMount must be a safe integer.');
    });

    it('requires distinct build SHAs and compares phase SHAs case- and prefix-insensitively', () => {
        const sameBuild = buildArtifact({
            baselineSha: 'ABCDEF012345',
            afterSha: 'abcdef0'
        });
        sameBuild.profiles.forEach((profile) => {
            profile.before.sha = 'abcdef012345';
            profile.after.sha = 'ABCDEF0';
        });

        expect(validateMeasurementArtifact(sameBuild).errors).toContain(
            'baselineSha and afterSha must identify different commits.'
        );

        const casingOnly = buildArtifact();
        casingOnly.profiles[0].before.sha = baselineSha.toUpperCase();
        expect(validateMeasurementArtifact(casingOnly).errors).not.toContain(
            'profile desktop-web before.sha must match baselineSha.'
        );

        const mixedLength = buildArtifact();
        mixedLength.profiles[0].before.sha = baselineSha.slice(0, 7).toUpperCase();
        mixedLength.profiles[0].after.sha = afterSha.slice(0, 7).toUpperCase();
        const mixedLengthErrors = validateMeasurementArtifact(mixedLength).errors;
        expect(mixedLengthErrors).not.toContain('profile desktop-web before.sha must match baselineSha.');
        expect(mixedLengthErrors).not.toContain('profile desktop-web after.sha must match afterSha.');
    });

    it('requires real ISO timestamps with timezones and bounds raw run cost', () => {
        const artifact = buildArtifact();
        artifact.profiles[0].before.capturedAt = '2026-02-30T12:00:00Z';
        artifact.profiles[0].after.capturedAt = '2026-07-12T13:00:00';
        artifact.profiles[1].before.runs = Array.from(
            { length: MAX_RUNS_PER_PHASE + 1 },
            (_, index) => buildRun(index + 1)
        );

        const result = validateMeasurementArtifact(artifact);

        expect(result.errors).toContain('profile desktop-web before.capturedAt must be a valid ISO timestamp with a timezone.');
        expect(result.errors).toContain('profile desktop-web after.capturedAt must be a valid ISO timestamp with a timezone.');
        expect(result.errors).toContain(`profile throttled-4g-web before.runs must not exceed ${MAX_RUNS_PER_PHASE} runs.`);
    });

    it('escapes profile labels before emitting a paste-ready markdown table', () => {
        const artifact = buildArtifact();
        artifact.profiles[0].label = 'Desktop | primary';
        const result = validateMeasurementArtifact(artifact);

        expect(result.errors).toEqual([]);
        expect(buildMarkdownSummary(result.summary)).toContain('| Desktop \\| primary | before |');
    });

    it('preserves half-count medians for an even number of read samples', () => {
        const artifact = buildArtifact();
        artifact.profiles[0].before.runs = [1, 2, 3, 4].map((run) => buildRun(run, {
            readsHomeMount: run
        }));
        const result = validateMeasurementArtifact(artifact);

        expect(result.errors).toEqual([]);
        expect(result.summary.profiles[0].phases.before.medians.readsHomeMount).toBe(2.5);
        expect(buildMarkdownSummary(result.summary)).toContain('| desktop-web | before | 1803ms | 643ms | 2.5 |');
    });

    it('rejects oversized raw evidence files before loading them into memory', async () => {
        const tempDir = await mkdtemp(join(tmpdir(), 'allplays-performance-evidence-'));
        const artifactPath = join(tempDir, 'measurements.json');
        try {
            await writeFile(artifactPath, '{}');
            await truncate(artifactPath, MAX_ARTIFACT_BYTES + 1);

            await expect(readMeasurementArtifact(artifactPath)).rejects.toThrow(
                `exceeds the ${MAX_ARTIFACT_BYTES}-byte performance evidence limit`
            );
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
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
