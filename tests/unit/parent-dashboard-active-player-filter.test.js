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
    it('verifies parent links against the player document before rendering children or schedules', () => {
        const source = readDbSource();
        const dashboardSource = readParentDashboardSource();
        const functionSource = getFunctionSource(source, 'getParentDashboardData');

        expect(functionSource).toContain('const expectedParentPlayerKeys = [...new Set(children');
        expect(functionSource).toContain('await updateUserProfile(userId, {');
        expect(functionSource).toContain('parentPlayerKeys: expectedParentPlayerKeys');
        expect(functionSource.indexOf('await updateUserProfile(userId, {')).toBeLessThan(functionSource.indexOf('const playerRef = doc(db, `teams/${child.teamId}/players`, child.playerId);'));
        expect(functionSource).toContain('const playerRef = doc(db, `teams/${child.teamId}/players`, child.playerId);');
        expect(functionSource).toContain('playerSnap = await getDoc(playerRef);');
        expect(functionSource).toContain("if (error?.code === 'permission-denied') {");
        expect(functionSource).toContain('continue;');
        expect(functionSource).toContain('if (!playerSnap.exists()) continue;');
        expect(functionSource).toContain('if (player.active === false) continue;');
        expect(functionSource).toContain('activeChildren.push(activeChild);');
        expect(functionSource).toContain('childName: activeChild.playerName');
        expect(functionSource).not.toContain('activeChildren.push(child);');
        expect(dashboardSource).toContain("./js/db.js?v=36");
    });
});
