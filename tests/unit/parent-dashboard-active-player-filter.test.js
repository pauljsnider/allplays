import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readDbSource() {
    return readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
}

function readParentDashboardSource() {
    return readFileSync(new URL('../../parent-dashboard.html', import.meta.url), 'utf8');
}

function readParentMembershipSource() {
    return readFileSync(new URL('../../js/parent-membership-utils.js', import.meta.url), 'utf8');
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
        const parentMembershipSource = readParentMembershipSource();
        const functionSource = getFunctionSource(source, 'getParentDashboardData');

        expect(parentMembershipSource).toContain('export function resolveCanonicalParentScopeInput(profileOrLinks = [])');
        expect(source).toContain('export async function normalizeParentScopeLinks(profileOrLinks = [])');
        expect(functionSource).toContain('const normalizedParentScope = await normalizeParentScopeLinks(userProfile);');
        expect(functionSource).toContain('const children = normalizedParentScope.activeLinks;');
        expect(functionSource).toContain('if (!normalizedParentScope.hasCanonicalParentTeamIds)');
        expect(functionSource).toContain('parentAccessBackfill.parentTeamIds = normalizedParentScope.parentTeamIds;');
        expect(functionSource).toContain('if (!normalizedParentScope.hasCanonicalParentPlayerKeys)');
        expect(functionSource).toContain('parentAccessBackfill.parentPlayerKeys = normalizedParentScope.parentPlayerKeys;');
        expect(functionSource).toContain('activeChildren.push(child);');
        expect(functionSource).not.toContain('const team = await getTeam(child.teamId);');
        expect(functionSource).toContain('childName: child.playerName');
        expect(functionSource).not.toContain('const playerRef = doc(db, `teams/${child.teamId}/players`, child.playerId);');
        expect(functionSource).toContain("dashboardState.kind = 'degraded';");
        expect(dashboardSource).toContain('renderPlayers(data.children, data.dashboardState || null);');
        expect(dashboardSource).toContain("import { resolveCanonicalParentScopeInput } from './js/parent-membership-utils.js?v=4';");
        expect(dashboardSource).toContain('const canonicalParentScope = resolveCanonicalParentScopeInput(profile);');
        expect(dashboardSource).not.toContain('const merged = [...new Set([...existing, ...teamIds])]');
        expect(dashboardSource).toContain("./js/db.js?v=4433183");
    });
});
