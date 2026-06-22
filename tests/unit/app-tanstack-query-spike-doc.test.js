import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'docs/pr-notes/tanstack-query-spike.md'), 'utf8');

describe('TanStack Query spike note', () => {
    it('compares cache behavior and records a go/no-go recommendation', () => {
        expect(source).toContain('appDataCache');
        expect(source).toContain('TanStack Query');
        expect(source).toContain('Request deduping');
        expect(source).toContain('Stale data');
        expect(source).toContain('Retries');
        expect(source).toContain('Migration cost');
        expect(source).toContain('Defer a full TanStack Query migration');
        expect(source).toContain('#2031');
    });

    it('keeps the proof of concept bounded to parent Home and schedule summary reads', () => {
        expect(source).toContain('parentHomeSummaryQuery');
        expect(source).toContain("['parent-home-summary', userId]");
        expect(source).toContain("['schedule-summary', userId, teamScopeKey]");
        expect(source).toContain('does not migrate writes, subscriptions, payments, or schedule detail mutations');
    });
});
