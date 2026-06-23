import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const teamsSource = readFileSync(new URL('../../apps/app/src/pages/Teams.tsx', import.meta.url), 'utf8');

function getLoadTeamsSource() {
    const start = teamsSource.indexOf('  const loadTeams = async');
    const end = teamsSource.indexOf('\n\n  useEffect(() => {', start);
    if (start === -1 || end === -1) {
        throw new Error('Unable to extract Teams loadTeams source.');
    }
    return teamsSource.slice(start, end);
}

describe('Teams async operation contract', () => {
    it('runs the Teams summary and enrichment reads through shared async operations', () => {
        const loadTeamsSource = getLoadTeamsSource();

        expect(teamsSource).toContain("import { useAsyncOperation } from '../lib/useAsyncOperation';");
        expect(teamsSource).toContain('loading: teamSummaryLoading');
        expect(teamsSource).toContain('error: teamSummaryError');
        expect(teamsSource).toContain('run: runTeamSummaryLoad');
        expect(teamsSource).toContain('loading: teamEnrichmentLoading');
        expect(teamsSource).toContain('error: teamEnrichmentError');
        expect(teamsSource).toContain('run: runTeamEnrichmentLoad');
        expect(loadTeamsSource).toContain('const fastHome = await runTeamSummaryLoad(');
        expect(loadTeamsSource).toContain('await runTeamEnrichmentLoad(');
        expect(loadTeamsSource).toContain('ignoreStale: true');
        expect(loadTeamsSource).not.toContain('setLoading(');
        expect(loadTeamsSource).not.toContain('setRefreshing(');
        expect(loadTeamsSource).not.toContain('finally {');
        expect(loadTeamsSource).not.toContain('catch (');
    });

    it('keeps Teams load failures on typed retry copy while preserving fast summary data', () => {
        const loadTeamsSource = getLoadTeamsSource();

        expect(loadTeamsSource).toContain("getTeamsLoadErrorMessage(toAppServiceError(loadError, 'Unable to load teams.'), hasExistingTeams)");
        expect(loadTeamsSource).toContain("const appError = toAppServiceError(loadError, 'Unable to load teams.');");
        expect(loadTeamsSource).toContain('setTeamsLoadError(appError);');
        expect(loadTeamsSource).toContain('if (!hasExistingTeams) {');
        expect(loadTeamsSource).toContain('setHome(emptyHome());');
        expect(loadTeamsSource).toContain('const hasFastTeams = fastHome.teams.length > 0;');
        expect(loadTeamsSource).toContain("getTeamsLoadErrorMessage(toAppServiceError(enrichError, 'Unable to load teams.'), true)");
        expect(loadTeamsSource).toContain('shouldHandleError: () => loadId === activeLoadIdRef.current');
        expect(loadTeamsSource).toContain('if (!hasExistingTeams && !hasFastTeams) {');
        expect(loadTeamsSource).toContain('setHome((current) => mergeTeamSummary(current, enrichedHome));');
    });
});
