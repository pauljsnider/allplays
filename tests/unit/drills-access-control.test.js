import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const drillsHtml = readFileSync(path.resolve(process.cwd(), 'drills.html'), 'utf8');

describe('drills planning access control', () => {
    it('allows read-only users to stay on drills planning after passing access checks', () => {
        expect(drillsHtml).toContain("if (!access.hasAccess) { location.href = access.exitUrl; return; }");
        expect(drillsHtml).not.toContain("if (state.accessLevel !== 'full') { location.href = access.exitUrl; return; }");
    });

    it('guards team planning save paths behind full access', () => {
        expect(drillsHtml).toContain("if (!requireFullPlanningAccess('Saving practice plans')) return;");
        expect(drillsHtml).toContain("if (!requireFullPlanningAccess('Saving home packets')) return;");
        expect(drillsHtml).toContain("if (!requireFullPlanningAccess('Home packets')) return;");
    });

    it('persists the session-date reminder timestamp when saving legacy home packets', () => {
        expect(drillsHtml).toContain("const homePacketReminderDueAt = new Date(document.getElementById('session-date').value);");
        expect(drillsHtml).toContain('homePacketReminderDueAt,\n                homePacketContent: {');
    });

    it('hides admin-only controls for read-only users', () => {
        expect(drillsHtml).toContain("document.getElementById('btn-new-drill').classList.add('hidden');");
        expect(drillsHtml).toContain("document.getElementById('session-meta-bar').classList.add('hidden');");
    });

    it('passes the active team id into drill diagram uploads', () => {
        expect(drillsHtml).toContain("uploadDrillDiagram(state.teamId, drillId, file)");
        expect(drillsHtml).not.toContain("uploadDrillDiagram(state.currentTeamId, drillId, file)");
    });
});
