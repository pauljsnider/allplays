import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const scheduleSource = readFileSync(new URL('../../apps/app/src/pages/Schedule.tsx', import.meta.url), 'utf8');
const scheduleStaffToolsSource = readFileSync(new URL('../../apps/app/src/components/schedule/ScheduleStaffTools.tsx', import.meta.url), 'utf8');

describe('Schedule lazy-load guards', () => {
    it('does not statically import staff AI or CSV helpers at the route level', () => {
        expect(scheduleSource).not.toContain("from '../lib/scheduleAiImport'");
        expect(scheduleSource).not.toContain("from '../lib/scheduleCsvImport'");
    });

    it('loads the summary workflow through the shared async operation hook', () => {
        expect(scheduleSource).toContain("import { useAsyncOperation } from '../lib/useAsyncOperation'");
        expect(scheduleSource).toContain('loading: scheduleReadLoading');
        expect(scheduleSource).toContain('error: scheduleReadError');
        expect(scheduleSource).toContain('clearError: clearScheduleReadError');
        expect(scheduleSource).toContain('run: runScheduleRead');
        expect(scheduleSource).toContain('loading: loadingPastHistory');
        expect(scheduleSource).toContain('run: runPastHistoryRead');
        expect(scheduleSource).toContain('return runScheduleRead(');
        expect(scheduleSource).toContain('const loaded = await runPastHistoryRead(');
        expect(scheduleSource).not.toContain('const [loading, setLoading] = useState(true);');
        expect(scheduleSource).not.toContain('const [loadingPastHistory, setLoadingPastHistory]');
    });

    it('keeps Schedule reads on the shared async/cache/error path', () => {
        const refreshStart = scheduleSource.indexOf('  const refreshSchedule = async');
        const refreshEnd = scheduleSource.indexOf('\n\n  useEffect(() => {', refreshStart);
        const refreshSource = scheduleSource.slice(refreshStart, refreshEnd);

        expect(refreshSource).toContain("const timer = startScreenMountTimer('schedule', {");
        expect(refreshSource).toContain('const cacheKey = getParentScheduleSummaryCacheKey(auth.user.uid);');
        expect(refreshSource).toContain('const cached = getCachedAppData(cacheKey);');
        expect(refreshSource).toContain('return runScheduleRead(');
        expect(refreshSource).toContain('() => loadCachedAppData(');
        expect(refreshSource).toContain("() => loadParentSchedule(auth.user, { hydrateDetails: false, expandStaffPlayers: false })");
        expect(refreshSource).toContain("getScheduleLoadErrorMessage(toAppServiceError(loadError, 'Unable to load schedule.'), hasExistingSchedule)");
        expect(refreshSource).toContain('onSuccess: (result) => {');
        expect(refreshSource).toContain('applyScheduleResult(result);');
        expect(refreshSource).toContain('cacheHit: Boolean(cached) && !force');
        expect(refreshSource).toContain('onError: (loadError) => {');
        expect(refreshSource).toContain("const mappedError = toAppServiceError(loadError, 'Unable to load schedule.');");
        expect(refreshSource).toContain('if (!hasExistingSchedule) {\n            applyScheduleResult({ children: [], events: [] });\n          }');
        expect(refreshSource).not.toContain('setLoading(');
        expect(refreshSource).not.toContain('finally {');
    });

    it('loads staff AI and CSV helpers through on-demand dynamic imports', () => {
        expect(scheduleStaffToolsSource).toContain("scheduleCsvImportModulePromise = import('../../lib/scheduleCsvImport')");
        expect(scheduleStaffToolsSource).toContain("scheduleAiImportModulePromise = import('../../lib/scheduleAiImport')");
        expect(scheduleStaffToolsSource).toContain('loadScheduleCsvImportModule()');
        expect(scheduleStaffToolsSource).toContain('const [{ parseCsvText, inferScheduleCsvMapping }, csvText] = await Promise.all([');
        expect(scheduleStaffToolsSource).toContain("const { buildScheduleImportPreview } = await loadScheduleCsvImportModule();");
        expect(scheduleStaffToolsSource).toContain("const { generateScheduleAiImportRows } = await loadScheduleAiImportModule();");
    });
});
