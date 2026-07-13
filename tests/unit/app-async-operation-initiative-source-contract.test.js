import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readSource(path) {
    return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

const asyncOperationSource = readSource('apps/app/src/lib/useAsyncOperation.ts');
const appErrorsSource = readSource('apps/app/src/lib/appErrors.ts');
const appDataCacheSource = readSource('apps/app/src/lib/appDataCache.ts');
const homeSource = readSource('apps/app/src/pages/Home.tsx');
const scheduleSource = readSource('apps/app/src/pages/Schedule.tsx');
const homeServiceSource = readSource('apps/app/src/lib/homeService.ts');
const scheduleServiceSource = readSource('apps/app/src/lib/scheduleService.ts');

describe('app async operation initiative source contract', () => {
    it('keeps loading, error, callbacks, and retry behavior centralized in useAsyncOperation', () => {
        expect(asyncOperationSource).toContain('export function useAsyncOperation()');
        expect(asyncOperationSource).toContain('const [loading, setLoading] = useState(false);');
        expect(asyncOperationSource).toContain('const [error, setError] = useState<string | null>(null);');
        expect(asyncOperationSource).toContain('onSuccess?: (value: T) => void | Promise<void>;');
        expect(asyncOperationSource).toContain('onError?: (error: unknown) => void | Promise<void>;');
        expect(asyncOperationSource).toContain('onFinally?: () => void | Promise<void>;');
        expect(asyncOperationSource).toContain('rethrow = true');
        expect(asyncOperationSource).toContain('setLoading(false);');
    });

    it('normalizes service failures through typed app service errors', () => {
        expect(appErrorsSource).toContain("export type AppServiceErrorType = 'network' | 'permission' | 'not_found' | 'validation' | 'unknown';");
        expect(appErrorsSource).toContain('export class AppServiceError extends Error');
        expect(appErrorsSource).toContain('export function isAppServiceError(error: unknown): error is AppServiceError');
        expect(appErrorsSource).toContain('export function toAppServiceError(error: unknown, fallbackMessage: string)');
        expect(appErrorsSource).toContain('inferAppServiceErrorType(error)');
        expect(appErrorsSource).toContain('{ status: getStatus(error), cause: error }');
    });

    it('keeps app data loads deduped and cache-aware behind a shared helper', () => {
        expect(appDataCacheSource).toContain('promise?: Promise<T>;');
        expect(appDataCacheSource).toContain('const cache = new Map<string, CacheEntry<unknown>>();');
        expect(appDataCacheSource).toContain('export function getCachedAppData<T>');
        expect(appDataCacheSource).toContain('export function loadCachedAppData<T>');
        expect(appDataCacheSource).toContain('staleWhileRevalidate?: boolean;');
        expect(appDataCacheSource).toContain("logger.warn('Background refresh failed.', { error });");
    });

    it('keeps Home and Schedule on the common async operation and error boundary layer', () => {
        expect(homeSource).toContain("import { toAppServiceError, type AppServiceError } from '../lib/appErrors';");
        expect(homeSource).toContain("import { useAsyncOperation } from '../lib/useAsyncOperation';");
        expect(homeSource).toContain('const { loading, error, clearError, run: runPrimaryLoad } = useAsyncOperation();');
        expect(homeSource).toContain('const { loading: socialLoading, run: runSecondaryLoad } = useAsyncOperation();');
        expect(homeSource).toContain('getHomeLoadErrorMessage(toAppServiceError(loadError, \'Unable to load Home.\'), hasExistingHome)');

        expect(scheduleSource).toContain("import { toAppServiceError, type AppServiceError } from '../lib/appErrors';");
        expect(scheduleSource).toContain("import { useAsyncOperation } from '../lib/useAsyncOperation';");
        expect(scheduleSource).toContain('loading: scheduleReadLoading');
        expect(scheduleSource).toContain('error: scheduleReadError');
        expect(scheduleSource).toContain('clearError: clearScheduleReadError');
        expect(scheduleSource).toContain('run: runScheduleRead');
        expect(scheduleSource).toContain('loading: loadingPastHistory');
        expect(scheduleSource).toContain('run: runPastHistoryRead');
        expect(scheduleSource).toContain('getScheduleLoadErrorMessage(toAppServiceError(loadError, \'Unable to load schedule.\'), hasExistingSchedule)');
    });

    it('keeps high-traffic app services using shared cache and service-error adapters', () => {
        expect(homeServiceSource).toMatch(/import\s+\{[^}]*getParentScheduleSummaryCacheKey[^}]*loadCachedAppData[^}]*\}\s+from '\.\/appDataCache';/);
        expect(homeServiceSource).toContain("import { toAppServiceError, type AppServiceError } from './appErrors';");
        expect(homeServiceSource).toContain('return loadCachedAppData(');
        expect(homeServiceSource).toContain('function rethrowIfPermissionError(error: unknown, fallbackMessage: string)');
        expect(homeServiceSource).toContain("rethrowIfPermissionError(error, 'Unable to load Home chat.')");

        expect(scheduleServiceSource).toContain("import { getCachedAppData, getParentHomeSecondaryCacheKey, getParentScheduleSummaryCacheKey, invalidateCachedAppData, loadCachedAppData } from './appDataCache';");
        expect(scheduleServiceSource).toContain("import { toAppServiceError } from './appErrors';");
        expect(scheduleServiceSource).toContain("throw toAppServiceError(error, 'Unable to load schedule.');");
        expect(scheduleServiceSource).toContain("startUxTimer('parent schedule service load'");
    });
});
