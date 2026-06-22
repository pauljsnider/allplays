import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const teamDrillsPageSource = readFileSync(new URL('../../apps/app/src/pages/TeamDrills.tsx', import.meta.url), 'utf8');
const teamDrillsServiceSource = readFileSync(new URL('../../apps/app/src/lib/teamDrillsService.ts', import.meta.url), 'utf8');
const scheduleEventDetailSource = readFileSync(new URL('../../apps/app/src/pages/ScheduleEventDetail.tsx', import.meta.url), 'utf8');
const practiceTimelineServiceTestSource = readFileSync(new URL('../../apps/app/src/lib/practiceTimelineService.test.ts', import.meta.url), 'utf8');
const teamDrillsPageTestSource = readFileSync(new URL('../../apps/app/src/pages/TeamDrills.test.tsx', import.meta.url), 'utf8');
const scheduleEventDetailTestSource = readFileSync(new URL('../../apps/app/src/pages/ScheduleEventDetail.test.tsx', import.meta.url), 'utf8');

describe('issue 2026 team drills picker source contract', () => {
    it('keeps the native team drill library wired to search, filters, pagination, and favorites', () => {
        expect(teamDrillsPageSource).toContain("type DrillTab = 'community' | 'favorites';");
        expect(teamDrillsPageSource).toContain('loadTeamDrillLibraryPage(teamId, auth.user, {');
        expect(teamDrillsPageSource).toContain('loadFavoriteDrills(teamId, auth.user)');
        expect(teamDrillsPageSource).toContain('filterDrillSummaries(favoriteDrills || [], {');
        expect(teamDrillsPageSource).toContain('await setTeamDrillFavorite(teamId, auth.user, drill.id, !isFavorite);');
        expect(teamDrillsPageSource).toContain('Team-scoped favorites sync with drills.html automatically.');
    });

    it('keeps drill service pagination and AI practice-coach prompt inputs available', () => {
        expect(teamDrillsServiceSource).toContain('const drillLibraryPageSize = 12;');
        expect(teamDrillsServiceSource).toContain('export function filterDrillSummaries');
        expect(teamDrillsServiceSource).toContain('export function buildPracticeAiCoachPrompt');
        expect(teamDrillsServiceSource).toContain('Favorite drills to prefer when they fit:');
        expect(teamDrillsServiceSource).toContain('export async function loadTeamDrillLibraryPage');
        expect(teamDrillsServiceSource).toContain('export async function loadFavoriteDrills');
    });

    it('keeps the practice timeline picker using loaded drill options', () => {
        expect(scheduleEventDetailSource).toContain('const [drillOptions, setDrillOptions] = useState<PracticeTimelineDrillOption[]>([]);');
        expect(scheduleEventDetailSource).toContain('setSelectedDrillId((current) => current || model.drillOptions[0]?.id || \'\');');
        expect(scheduleEventDetailSource).toContain('const option = drillOptions.find((candidate) => candidate.id === selectedDrillId) || drillOptions[0];');
        expect(scheduleEventDetailSource).toContain('createPracticeTimelineBlockFromOption(option, blocks.length)');
        expect(scheduleEventDetailSource).toContain('No drills available');
    });

    it('keeps focused tests for the library and picker workflows', () => {
        expect(teamDrillsPageTestSource).toContain('shows the access guard when the user cannot manage team drills');
        expect(practiceTimelineServiceTestSource).toContain("community:Warm-up', 'team:Pattern play");
        expect(scheduleEventDetailTestSource).toContain('lets team admins manage the practice timeline and save live notes');
        expect(scheduleEventDetailTestSource).toContain("screen.getByRole('button', { name: 'Add drill' })");
    });
});
