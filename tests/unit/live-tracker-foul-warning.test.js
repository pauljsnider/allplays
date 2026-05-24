import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const liveTrackerSource = readFileSync(new URL('../../js/live-tracker.js', import.meta.url), 'utf8');
const basketballTrackerSource = readFileSync(new URL('../../js/track-basketball.js', import.meta.url), 'utf8');

describe('tracker foul warnings', () => {
    it('labels 5+ fouls as fouled out instead of only showing a warning icon', () => {
        for (const source of [liveTrackerSource, basketballTrackerSource]) {
            expect(source).toContain("fouls >= 5 ? ' FOULED OUT!'");
            expect(source).not.toContain("fouls >= 5 ? ' ⚠️'");
        }
    });
});
