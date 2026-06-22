import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Copy, Download, Loader2, RefreshCw } from 'lucide-react';
import { exportCalendarIcsFile, openPublicUrl } from '../../lib/publicActions';
import { buildParentScheduleIcs, getAppleCalendarFeedUrl, getCalendarEventShareText, getGoogleCalendarFeedUrl, getPrivateTeamCalendarFeedUrl, loadParentCalendarTools, type ParentCalendarTeam } from '../../lib/parentToolsService';
import { useAsyncOperation } from '../../lib/useAsyncOperation';
import type { ParentScheduleEvent } from '../../lib/scheduleLogic';
import type { AuthState } from '../../lib/types';
import { LoadingBlock, MetricCard, RetryableStatus, Status, ToolHeader, copyText } from './shared';
import { toAppServiceError, type AppServiceError } from '../../lib/appErrors';

export function CalendarTool({ auth, refreshVersion }: { auth: AuthState; refreshVersion: number }) {
    const [events, setEvents] = useState<ParentScheduleEvent[]>([]);
    const [teams, setTeams] = useState<ParentCalendarTeam[]>([]);
    const [busyTeamId, setBusyTeamId] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState<AppServiceError | null>(null);
    const loadOperation = useAsyncOperation();
    const exportOperation = useAsyncOperation();
    const feedOperation = useAsyncOperation();
    const runLoad = loadOperation.run;
    const runExport = exportOperation.run;
    const runFeed = feedOperation.run;
    const loading = loadOperation.loading;
    const exporting = exportOperation.loading;

    const refresh = useCallback(async (options: { force?: boolean } = {}) => {
        setError(null);
        setMessage('');
        return runLoad(
            () => loadParentCalendarTools(auth.user, options),
            {
                rethrow: false,
                getErrorMessage: (loadError) => String(toAppServiceError(loadError, 'Unable to load calendar tools.').message || 'Unable to load calendar tools.'),
                onSuccess: (model) => {
                    setEvents(model.events);
                    setTeams(model.teams);
                },
                onError: (loadError) => {
                    setError(toAppServiceError(loadError, 'Unable to load calendar tools.'));
                }
            }
        );
    }, [auth.user, runLoad]);

    useEffect(() => {
        void refresh(refreshVersion > 0 ? { force: true } : {});
    }, [auth.user?.uid, refresh, refreshVersion]);

    const download = async () => {
        if (!events.length) {
            setMessage('No events to export yet.');
            return;
        }
        setError(null);
        setMessage('');
        await runExport(
            () => exportCalendarIcsFile('all-plays-family-schedule.ics', buildParentScheduleIcs(events)),
            {
                rethrow: false,
                getErrorMessage: (downloadError) => String(toAppServiceError(downloadError, 'Unable to export the calendar file. Try again or use the Apple or Google calendar links instead.').message || 'Unable to export the calendar file. Try again or use the Apple or Google calendar links instead.'),
                onSuccess: () => {
                    setMessage('Calendar file ready to share.');
                },
                onError: (downloadError) => {
                    setError(toAppServiceError(downloadError, 'Unable to export the calendar file. Try again or use the Apple or Google calendar links instead.'));
                }
            }
        );
    };

    const copyAgenda = async () => {
        const text = events.slice(0, 20).map(getCalendarEventShareText).join('\n');
        if (!text) {
            setMessage('No events to copy yet.');
            return;
        }
        await copyText(text, setMessage);
    };

    const openFeed = async (team: ParentCalendarTeam, target: 'copy' | 'apple' | 'google') => {
        setBusyTeamId(team.teamId);
        setError(null);
        setMessage('');
        await runFeed(
            async () => {
                const feedUrl = await getPrivateTeamCalendarFeedUrl(team.teamId);
                if (!feedUrl) throw new Error('Unable to create private calendar feed. Sign in again and retry.');
                if (target === 'copy') {
                    await copyText(feedUrl, setMessage);
                    return;
                }
                await openPublicUrl(target === 'apple' ? getAppleCalendarFeedUrl(feedUrl) : getGoogleCalendarFeedUrl(feedUrl));
            },
            {
                rethrow: false,
                getErrorMessage: (feedError) => String(toAppServiceError(feedError, 'Unable to open calendar feed.').message || 'Unable to open calendar feed.'),
                onError: (feedError) => {
                    setError(toAppServiceError(feedError, 'Unable to open calendar feed.'));
                },
                onFinally: () => {
                    setBusyTeamId('');
                }
            }
        );
    };

    return (
        <div className="space-y-3">
            <section className="app-card p-4">
                <ToolHeader icon={CalendarDays} title="Calendar tools" detail="Download your family schedule or subscribe by team." action={<button type="button" className="ghost-button !min-h-9 text-xs" onClick={() => { void refresh({ force: true }); }} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh</button>} />
                {error ? <RetryableStatus error={error} fallbackMessage="Unable to load calendar tools." onRetry={loading ? undefined : () => refresh({ force: true })} retrying={loading} /> : null}
                {message ? <Status tone="success" message={message} /> : null}
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <button type="button" className="secondary-button justify-center" onClick={() => { void download(); }} disabled={loading || exporting}>
                        {exporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
                        {exporting ? 'Preparing .ics' : 'Download .ics'}
                    </button>
                    <button type="button" className="secondary-button justify-center" onClick={copyAgenda} disabled={loading}>
                        <Copy className="h-4 w-4" aria-hidden="true" />
                        Copy agenda
                    </button>
                    <MetricCard label="Events" value={String(events.length)} />
                </div>
            </section>

            {loading ? <LoadingBlock label="Loading calendar teams" /> : (
                <section className="grid gap-3 lg:grid-cols-2">
                    {teams.length ? teams.map((team) => (
                        <div key={team.teamId} className="app-card p-4">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="truncate text-sm font-black text-gray-950">{team.teamName}</div>
                                    <div className="mt-0.5 text-xs font-semibold text-gray-500">{team.eventCount} event{team.eventCount === 1 ? '' : 's'} on this schedule</div>
                                </div>
                                {busyTeamId === team.teamId ? <Loader2 className="h-5 w-5 animate-spin text-primary-600" aria-hidden="true" /> : <CalendarDays className="h-5 w-5 text-primary-600" aria-hidden="true" />}
                            </div>
                            <div className="mt-3 grid grid-cols-3 gap-2">
                                <button type="button" className="secondary-button !min-h-9 justify-center text-xs" onClick={() => openFeed(team, 'copy')} disabled={busyTeamId === team.teamId}>Copy</button>
                                <button type="button" className="secondary-button !min-h-9 justify-center text-xs" onClick={() => openFeed(team, 'apple')} disabled={busyTeamId === team.teamId}>Apple</button>
                                <button type="button" className="secondary-button !min-h-9 justify-center text-xs" onClick={() => openFeed(team, 'google')} disabled={busyTeamId === team.teamId}>Google</button>
                            </div>
                        </div>
                    )) : <div className="app-card p-5 text-center"><CalendarDays className="mx-auto h-8 w-8 text-gray-400" aria-hidden="true" /><div className="mt-3 text-sm font-black text-gray-950">No team schedules</div><div className="mt-1 text-xs font-semibold text-gray-500">Schedules appear after a player or team is linked.</div></div>}
                </section>
            )}
        </div>
    );
}
