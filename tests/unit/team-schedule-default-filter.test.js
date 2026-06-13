import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('team schedule default filter', () => {
    it('defaults scheduleViewFilter to all-upcoming', () => {
        const source = readFileSync(new URL('../../team.html', import.meta.url), 'utf8');
        expect(source).toContain("let scheduleViewFilter = 'all-upcoming'");
    });

    it('calls setScheduleFilter with scheduleViewFilter fallback in renderSchedule', () => {
        const source = readFileSync(new URL('../../team.html', import.meta.url), 'utf8');

        const renderStart = source.indexOf('async function renderSchedule(');
        const renderEnd = source.indexOf('\n        function ', renderStart);
        const renderSource = source.slice(renderStart, renderEnd);

        expect(renderSource).toContain("setScheduleFilter(scheduleViewFilter || 'all-upcoming')");
        expect(renderSource).not.toContain("setScheduleFilter('recent-results')");
    });

    it('defaults to all-upcoming in setScheduleFilter', () => {
        const source = readFileSync(new URL('../../team.html', import.meta.url), 'utf8');

        const fnStart = source.indexOf('function setScheduleFilter(');
        const fnEnd = source.indexOf('\n        function ', fnStart);
        const fnSource = source.slice(fnStart, fnEnd);

        expect(fnSource).toContain("scheduleViewFilter = next || 'all-upcoming'");
    });
});
