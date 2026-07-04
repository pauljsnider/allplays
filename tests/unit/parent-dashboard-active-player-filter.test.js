import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readDbSource() {
    return readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
}

function readParentDashboardSource() {
    return readFileSync(new URL('../../parent-dashboard.html', import.meta.url), 'utf8');
}

function getFunctionSource(source, functionName) {
    const start = source.indexOf(`export async function ${functionName}`);
    expect(start).toBeGreaterThanOrEqual(0);
    const nextExport = source.indexOf('\nexport async function ', start + 1);
    return source.slice(start, nextExport === -1 ? source.length : nextExport);
}

describe('parent dashboard active player filtering', () => {
    it('normalizes parent scope links before backfilling access fields or rendering children', () => {
        const source = readDbSource();
        const dashboardSource = readParentDashboardSource();
        const functionSource = getFunctionSource(source, 'getParentDashboardData');

        expect(source).toContain('export async function normalizeParentScopeLinks(parentLinks = [])');
        expect(functionSource).toContain('const normalizedParentScope = await normalizeParentScopeLinks(userProfile.parentOf);');
        expect(functionSource).toContain('const children = normalizedParentScope.activeLinks;');
        expect(functionSource).toContain('const normalizedParentTeamIds = normalizedParentScope.parentTeamIds;');
        expect(functionSource).toContain('const expectedParentPlayerKeys = normalizedParentScope.parentPlayerKeys;');
        expect(functionSource).toContain('await updateUserProfile(userId, {');
        expect(functionSource).toContain('parentTeamIds: normalizedParentTeamIds');
        expect(functionSource).toContain('parentPlayerKeys: expectedParentPlayerKeys');
        expect(functionSource).toContain('activeChildren.push(child);');
        expect(functionSource).not.toContain('const team = await getTeam(child.teamId);');
        expect(functionSource).toContain('childName: child.playerName');
        expect(functionSource).not.toContain('const playerRef = doc(db, `teams/${child.teamId}/players`, child.playerId);');
        expect(functionSource).toContain("dashboardState.kind = 'degraded';");
        expect(dashboardSource).toContain('renderPlayers(data.children, data.dashboardState || null);');
        expect(dashboardSource).toContain("./js/db.js?v=79");
    });
});
