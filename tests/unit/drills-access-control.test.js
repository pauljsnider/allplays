import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const drillsHtml = readFileSync(path.resolve(process.cwd(), 'drills.html'), 'utf8');

describe('drills planning access control', () => {
    it('redirects non-full users out of drills planning during init', () => {
        expect(drillsHtml).toContain("if (state.accessLevel !== 'full') { location.href = access.exitUrl; return; }");
    });

    it('guards team planning save paths behind full access', () => {
        expect(drillsHtml).toContain("if (!requireFullPlanningAccess('Saving practice plans')) return;");
        expect(drillsHtml).toContain("if (!requireFullPlanningAccess('Saving home packets')) return;");
        expect(drillsHtml).toContain("if (!requireFullPlanningAccess('Home packets')) return;");
    });
});
