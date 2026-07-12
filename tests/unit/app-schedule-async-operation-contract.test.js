import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const scheduleSource = readFileSync(new URL('../../apps/app/src/pages/Schedule.tsx', import.meta.url), 'utf8');

function getRefreshScheduleSource() {
    const start = scheduleSource.indexOf('  const refreshSchedule = async');
    const end = scheduleSource.indexOf('\n\n  useEffect(() => {', start);
    if (start === -1 || end === -1) {
        throw new Error('Unable to extract Schedule refreshSchedule source.');
    }
    return scheduleSource.slice(start, end);
}

describe('Schedule async operation contract', () => {
    it('loads the primary Schedule read through the shared async operation runner', () => {
        const refreshScheduleSource = getRefreshScheduleSource();

        expect(scheduleSource).toContain("import { useAsyncOperation } from '../lib/useAsyncOperation';");
        expect(scheduleSource).toContain('loading: scheduleReadLoading');
        expect(scheduleSource).toContain('error: scheduleReadError');
        expect(scheduleSource).toContain('clearError: clearScheduleReadError');
        expect(scheduleSource).toContain('run: runScheduleRead');
        expect(scheduleSource).toContain('loading: loadingPastHistory');
        expect(scheduleSource).toContain('run: runPastHistoryRead');
        expect(refreshScheduleSource).toContain('return runScheduleRead(');
        expect(refreshScheduleSource).toContain('() => loadCachedAppData(');
        expect(refreshScheduleSource).toContain('() => loadParentSchedule(auth.user, { hydrateDetails: false, expandStaffPlayers: false })');
        expect(refreshScheduleSource).toContain('{ ttlMs: scheduleCacheTtlMs, force }');
        expect(refreshScheduleSource).not.toContain('setLoading(');
    });

    it('maps Schedule load failures into typed retry copy while preserving stale data', () => {
        const refreshScheduleSource = getRefreshScheduleSource();

        expect(scheduleSource).toContain("import { toAppServiceError, type AppServiceError } from '../lib/appErrors';");
        expect(refreshScheduleSource).toContain("getScheduleLoadErrorMessage(toAppServiceError(loadError, 'Unable to load schedule.'), hasExistingSchedule)");
        expect(refreshScheduleSource).toContain("const mappedError = toAppServiceError(loadError, 'Unable to load schedule.');");
        expect(refreshScheduleSource).toContain('if (!hasExistingSchedule) {');
        expect(refreshScheduleSource).toContain('applyScheduleResult({ children: [], events: [], staffTeamIds: [] });');
        expect(refreshScheduleSource).toContain('setLoadedScheduleUserId(auth.user?.uid || null);');
    });

    it('keeps resume refresh and first meaningful render on the shared loading state', () => {
        expect(scheduleSource).toContain('useRefreshOnResume(() => { void refreshSchedule(true); }, { enabled: Boolean(auth.user?.uid) });');
        expect(scheduleSource).toContain("recordFirstMeaningfulRender('schedule');");
        expect(scheduleSource).toContain('if (!hasStartedInitialScheduleLoadRef.current || scheduleReadLoading || isInitialScheduleLoad) {');
    });
});
