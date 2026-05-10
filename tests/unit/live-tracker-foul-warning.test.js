import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../js/live-tracker.js', import.meta.url), 'utf8');

describe('live tracker foul warnings', () => {
    it('labels 5+ fouls as fouled out instead of only showing a warning icon', () => {
        expect(source).toContain("fouls >= 5 ? ' FOULED OUT!'");
        expect(source).not.toContain("fouls >= 5 ? ' ⚠️'");
    });
});
