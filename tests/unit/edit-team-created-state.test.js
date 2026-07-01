import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readEditTeamSource() {
    return readFileSync(new URL('../../edit-team.html', import.meta.url), 'utf8');
}

describe('edit team created-state next actions', () => {
    it('starts Team Management hidden so new-team create mode has no dead roster or schedule links', () => {
        const html = readEditTeamSource();

        expect(html).toContain('id="team-management-card" class="hidden bg-indigo-50');
        expect(html).toContain('id="manage-roster-btn" href="#"');
        expect(html).toContain('id="manage-schedule-btn" href="#"');
    });

    it('consumes created=1 to show post-create roster and schedule actions', () => {
        const html = readEditTeamSource();

        expect(html).toContain('const initialUrlParams = getUrlParams();');
        expect(html).toContain("const isInitialCreatedState = initialUrlParams.created === '1';");
        expect(html).toContain('id="post-create-next-steps" class="hidden');
        expect(html).toContain('id="post-create-roster-btn"');
        expect(html).toContain('id="post-create-schedule-btn"');
        expect(html).toContain('const showCreatedNextSteps = Boolean(teamId && options.created);');
        expect(html).toContain("createdNextSteps.classList.toggle('hidden', !showCreatedNextSteps);");
        expect(html).toContain('updateTeamManagementActions(initialTeamId, { created: isInitialCreatedState });');
    });

    it('keeps normal management links for existing-team edits while deferring them in the created state', () => {
        const html = readEditTeamSource();

        expect(html).toContain("managementCard.classList.toggle('hidden', !teamId || showCreatedNextSteps);");
        expect(html).toContain("const rosterUrl = teamId ? `edit-roster.html?teamId=${teamId}` : '#';");
        expect(html).toContain("const scheduleUrl = teamId ? `edit-schedule.html?teamId=${teamId}` : '#';");
        expect(html).toContain("document.getElementById('post-create-roster-btn').href = rosterUrl;");
        expect(html).toContain("document.getElementById('post-create-schedule-btn').href = scheduleUrl;");
    });
});
