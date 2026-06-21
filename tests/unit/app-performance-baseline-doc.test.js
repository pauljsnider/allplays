import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const doc = readFileSync(join(process.cwd(), 'docs/app-performance-baseline.md'), 'utf8');

describe('app performance baseline documentation', () => {
    it('documents the app performance metric set from issue 2050', () => {
        [
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

    it('ties baseline capture to stable uxTiming spans and repeatable commands', () => {
        [
            '`app startup`',
            '`first meaningful render`',
            '`rsvp tap latency`',
            '`chat send latency`',
            '`npm run app:build && npm run app:preview`'
        ].forEach((needle) => {
            expect(doc).toContain(needle);
        });
    });
});
