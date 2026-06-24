import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('published registration form query helper source', () => {
    it('uses a bounded published-only Firestore query for parent-facing registration discovery', () => {
        const dbSource = readFileSync(resolve(process.cwd(), 'js/db.js'), 'utf8');
        const parentToolsSource = readFileSync(resolve(process.cwd(), 'apps/app/src/lib/parentToolsService.ts'), 'utf8');

        expect(dbSource).toContain('export async function listPublishedTeamRegistrationForms(teamId, options = {})');
        expect(dbSource).toContain("const pageSize = Math.max(1, Math.min(100, Number(options.pageSize) || 50));");
        expect(dbSource).toContain("getDocs(query(formsRef, where('status', '==', 'published'), limit(pageSize)))");
        expect(dbSource).toContain("getDocs(query(formsRef, where('published', '==', true), limit(pageSize)))");
        expect(parentToolsSource).toContain("listPublishedTeamRegistrationForms(teamId, { pageSize: 50 })");
        expect(parentToolsSource).not.toContain("loadParentRegistrations(user: AuthUser | null): Promise<ParentRegistrationCard[]> {\n  const teamIds = getLinkedTeamIds(user);\n  const cards = await Promise.all(teamIds.map(async (teamId) => {\n    const [team, forms] = await Promise.all([\n      Promise.resolve(getTeam(teamId)).catch(() => null),\n      Promise.resolve(listTeamRegistrationForms(teamId)).catch(() => [])");
    });
});
