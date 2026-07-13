import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const doc = readFileSync(join(process.cwd(), 'docs/app-performance-baseline.md'), 'utf8');

describe('app performance baseline documentation', () => {
    it('documents the app performance metric set from issue 2896', () => {
        [
            'issue #2896',
            'Cold-start TTI (Home)',
            'Warm resume time',
            'Firestore reads / Home mount',
            'Firestore reads / Schedule mount',
            'Firestore reads / Messages mount',
            'Entry chunk size (gzip)',
            'RSVP tap latency',
            'Chat send latency'
        ].forEach((metric) => {
            expect(doc).toContain(metric);
        });
    });

    it('defines repeatable desktop, throttled web, and mobile measurement profiles', () => {
        [
            '| Desktop web |',
            '| Throttled 4G web |',
            '| Mid-range Android |',
            '| iPhone |',
            'DevTools "Slow 4G" plus 4x CPU throttle',
            'Numbers are medians of 3 runs',
            'Raw evidence contract',
            'npm run app:validate-performance-measurements -- docs/app-performance-measurements.json'
        ].forEach((needle) => {
            expect(doc).toContain(needle);
        });
    });

    it('keeps fillable baseline and after-fix templates for every profile', () => {
        [
            '## Baseline template',
            '## After-fix template',
            '| Profile | Cold-start TTI Home | Warm resume | Reads / Home mount | Reads / Schedule mount | Reads / Messages mount | Entry chunk gzip | RSVP tap latency | Chat send latency | Notes |',
            '| Profile | Fix / SHA | Cold-start TTI Home | Warm resume | Reads / Home mount | Reads / Schedule mount | Reads / Messages mount | Entry chunk gzip | RSVP tap latency | Chat send latency | Delta / notes |'
        ].forEach((needle) => {
            expect(doc).toContain(needle);
        });
    });

    it('ties baseline capture to stable uxTiming spans and repeatable commands', () => {
        [
            '`app startup`',
            '`app start to home first meaningful render`',
            '`first meaningful render`',
            '`warm resume to interactive`',
            '`rsvp tap latency`',
            '`chat send latency`',
            '`npm run app:build && npm run app:preview`'
        ].forEach((needle) => {
            expect(doc).toContain(needle);
        });
    });

    it('maps cold start and warm resume to their dedicated stable spans', () => {
        expect(doc).toContain('| Cold-start TTI (Home) | App launch → Home schedule cards interactive | `app start to home first meaningful render` span');
        expect(doc).toContain('| Warm resume time | Foreground after backgrounding → fresh data on screen | `warm resume to interactive` span');
        expect(doc).toContain('`app startup`\n  is only the initial render and is not a resume span');
    });

    it('documents the stable RSVP telemetry event name and label for baseline validation', () => {
        [
            '`app_ux_timing`',
            '`rsvp tap latency`',
            'Open a Schedule event and tap "Going" → RSVP confirmed',
            'RSVP timing validation uses the',
            'lab action "open a Schedule event and tap Going"',
            'telemetry event filtered to label `rsvp tap latency`'
        ].forEach((needle) => {
            expect(doc).toContain(needle);
        });
    });

    it('requires validated raw run evidence before issue closure', () => {
        [
            '`issue: 2050`',
            '`baselineSha`',
            '`afterSha`',
            '`desktop-web`',
            '`throttled-4g-web`',
            '`mid-range-android`',
            '`iphone`',
            '`coldStartHomeTtiMs`',
            '`warmResumeMs`',
            '`entryChunkGzipBytes`',
            'The validator rejects placeholders',
            'positive safe integers',
            'synthetic or anonymized fixture identifier',
            'Never commit passwords',
            'CI automatically validates'
        ].forEach((needle) => {
            expect(doc).toContain(needle);
        });
    });
});
