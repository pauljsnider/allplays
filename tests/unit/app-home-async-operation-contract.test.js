import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const homeSource = readFileSync(new URL('../../apps/app/src/pages/Home.tsx', import.meta.url), 'utf8');
const homeServiceSource = readFileSync(new URL('../../apps/app/src/lib/homeService.ts', import.meta.url), 'utf8');

function getRefreshHomeSource() {
    const start = homeSource.indexOf('  const refreshHome = async');
    const end = homeSource.indexOf('\n\n  useEffect(() => {', start);
    if (start === -1 || end === -1) {
        throw new Error('Unable to extract Home refreshHome source.');
    }
    return homeSource.slice(start, end);
}

describe('Home async operation contract', () => {
    it('runs primary and secondary Home loads through shared async operations', () => {
        const refreshHomeSource = getRefreshHomeSource();

        expect(homeSource).toContain("import { useAsyncOperation } from '../lib/useAsyncOperation';");
        expect(homeSource).toContain('const { loading, error, clearError, run: runPrimaryLoad } = useAsyncOperation();');
        expect(homeSource).toContain('const { loading: socialLoading, run: runSecondaryLoad } = useAsyncOperation();');
        expect(refreshHomeSource).toContain('return runPrimaryLoad(');
        expect(refreshHomeSource).toContain('void runSecondaryLoad(');
        expect(refreshHomeSource).toContain('getErrorMessage: (loadError)');
        expect(refreshHomeSource).toContain('getErrorMessage: (secondaryError)');
        expect(refreshHomeSource).not.toContain('finally {');
        expect(refreshHomeSource).not.toContain('setLoading(');
    });

    it('keeps Home summary, hydration, and refresh failures on the typed async path', () => {
        const refreshHomeSource = getRefreshHomeSource();

        expect(refreshHomeSource).toContain('const hasExistingHome = loadedHomeDetailsUserId === user.uid;');
        expect(refreshHomeSource).toContain("const timer = startScreenMountTimer('home', {");
        expect(refreshHomeSource).toContain('const summary = await loadParentHomeSummaryBootstrap(user, { force });');
        expect(refreshHomeSource).toContain('setHome(summary.home);');
        expect(refreshHomeSource).toContain('const secondaryHome = await loadParentHomeWithSecondaryData(user, {');
        expect(refreshHomeSource).toContain('schedule: summary.schedule');
        expect(refreshHomeSource).toContain('onPartial: (partial) => setHome(partial)');
        expect(refreshHomeSource).toContain("getErrorMessage: (loadError) => getHomeLoadErrorMessage(toAppServiceError(loadError, 'Unable to load Home.'), hasExistingHome)");
        expect(refreshHomeSource).toContain("const appError = toAppServiceError(loadError, 'Unable to load Home.');");
        expect(refreshHomeSource).toContain('if (!hasExistingHome) {');
        expect(refreshHomeSource).toContain('setHome(emptyHome());');
        expect(refreshHomeSource).toContain('setSocial(emptySocialHome());');
        expect(refreshHomeSource).toContain("getErrorMessage: (secondaryError) => getHomeSecondaryErrorMessage(toAppServiceError(secondaryError, 'Unable to refresh Home details.'))");
        expect(refreshHomeSource).toContain("const appError = toAppServiceError(secondaryError, 'Unable to refresh Home details.');");
        expect(refreshHomeSource).toContain("setSocialStatus({ tone: 'error', message: getHomeSecondaryErrorMessage(appError) });");
    });

    it('surfaces typed, retryable Home load copy for network and permission failures', () => {
        expect(homeSource).toContain("import { toAppServiceError, type AppServiceError } from '../lib/appErrors';");
        expect(homeSource).toContain("if (error.type === 'network') return 'Unable to load Home while offline. Check your connection and try again.';");
        expect(homeSource).toContain("if (error.type === 'permission') return 'You do not have permission to load this Home data.';");
        expect(homeSource).toContain("if (error.type === 'network') return 'Unable to refresh Home while offline. Showing the last loaded Home.';");
        expect(homeSource).toContain("if (error.type === 'permission') return 'Unable to refresh Home because access was denied. Showing the last loaded Home.';");
        expect(homeSource).toContain('function HomeLoadErrorState({ error, onRetry, retrying }');
        expect(homeSource).toContain('aria-label="Retry loading Home"');
    });

    it('keeps secondary Home hydration partial while classifying service failures', () => {
        expect(homeServiceSource).toContain("throw toAppServiceError(error, 'Unable to load Home chat.');");
        expect(homeServiceSource).toContain("throw toAppServiceError(error, 'Unable to load Home fees.');");
        expect(homeServiceSource).toContain("console.warn('[home] Schedule hydration failed:', rethrowIfPermissionError(error, 'Unable to hydrate Home schedule.'));");
        expect(homeServiceSource).toContain("console.warn('[home] Chat inbox failed:', rethrowIfPermissionError(error, 'Unable to load Home chat.'));");
        expect(homeServiceSource).toContain("console.warn('[home] Fees failed:', rethrowIfPermissionError(error, 'Unable to load Home fees.'));");
        expect(homeServiceSource).toContain('onPartial?.(buildParentHomeModel(partialState));');
    });
});
