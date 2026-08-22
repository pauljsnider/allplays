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
        expect(refreshScheduleSource).toContain('const verifiedParentScope = await parentScopePromise;');
        expect(refreshScheduleSource).toContain('return loadCachedAppData(');
        expect(refreshScheduleSource).toContain('return loadParentSchedule(auth.user, {');
        expect(refreshScheduleSource).toContain('...(verifiedParentScope && verifiedParentScope.isPartial !== true ? { parentScope: verifiedParentScope } : {})');
        expect(refreshScheduleSource).toContain('shouldCache: (loadedResult) => isParentScheduleCacheSafe(loadedResult)');
        expect(refreshScheduleSource).not.toContain('setLoading(');
    });

    it('maps Schedule load failures into typed retry copy while preserving stale data', () => {
        const refreshScheduleSource = getRefreshScheduleSource();

        expect(scheduleSource).toContain("import { toAppServiceError, type AppServiceError } from '../lib/appErrors';");
        expect(refreshScheduleSource).toContain("getScheduleLoadErrorMessage(toAppServiceError(loadError, 'Unable to load schedule.'), hasExistingSchedule)");
        expect(refreshScheduleSource).toContain("const mappedError = toAppServiceError(loadError, 'Unable to load schedule.');");
        expect(refreshScheduleSource).toContain('if (!hasExistingSchedule && !hasAppliedSettledPartialEvidence) {');
        expect(refreshScheduleSource).toContain('applyScheduleResult({ children: [], events: [] });');
        expect(refreshScheduleSource).toContain('setLoadedScheduleUserId(auth.user?.uid || null);');
    });

    it('keeps resume refresh and first meaningful render on the shared loading state', () => {
        expect(scheduleSource).toContain('useRefreshOnResume(() => refreshSchedule(true), { enabled: Boolean(auth.user?.uid) });');
        expect(scheduleSource).toContain("recordFirstMeaningfulRender('schedule');");
        expect(scheduleSource).toContain('if (!hasStartedInitialScheduleLoadRef.current || scheduleReadLoading || isInitialScheduleLoad) {');
    });

    it('cancels superseded screen and initial-load timers', () => {
        const refreshScheduleSource = getRefreshScheduleSource();

        expect(refreshScheduleSource).toContain("timer.cancel({ reason: 'superseded' });");
        expect(refreshScheduleSource).toContain("initialLoadTimer?.cancel({ reason: 'superseded' });");
    });
});
