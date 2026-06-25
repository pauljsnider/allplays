import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Copy, Download, Loader2, RefreshCw } from 'lucide-react';
import { exportCalendarIcsFile, openPublicUrl } from '../../lib/publicActions';
import { buildParentScheduleIcs, getAppleCalendarFeedUrl, getCalendarEventShareText, getGoogleCalendarFeedUrl, getPrivateTeamCalendarFeedUrl, loadParentCalendarTools, type ParentCalendarTeam } from '../../lib/parentCalendarService';
import type { ParentScheduleEvent } from '../../lib/scheduleLogic';
import type { AuthState } from '../../lib/types';
import { LoadingBlock, MetricCard, RetryableStatus, Status, ToolHeader, copyText, useParentToolAsyncOperation } from './shared';

export function CalendarTool({ auth, refreshVersion }: { auth: AuthState; refreshVersion: number }) {
    const [events, setEvents] = useState<ParentScheduleEvent[]>([]);
    const [teams, setTeams] = useState<ParentCalendarTeam[]>([]);
    const [busyTeamId, setBusyTeamId] = useState('');
    const [message, setMessage] = useState('');
    const loadOperation = useParentToolAsyncOperation();
    const exportOperation = useParentToolAsyncOperation();
    const feedOperation = useParentToolAsyncOperation();
    const runLoad = loadOperation.run;
    const runExport = exportOperation.run;
    const runFeed = feedOperation.run;
    const clearLoadError = loadOperation.clearError;
    const clearExportError = exportOperation.clearError;
    const clearFeedError = feedOperation.clearError;
    const loading = loadOperation.loading;
    const exporting = exportOperation.loading;
    const error = loadOperation.error ?? exportOperation.error ?? feedOperation.error;

    const refresh = useCallback(async (options: { force?: boolean } = {}) => {
        clearLoadError();
        clearExportError();
        clearFeedError();
        setMessage('');
        return runLoad(
            () => loadParentCalendarTools(auth.user, options),
            'Unable to load calendar tools.',
            {
                onSuccess: (model) => {
                    setEvents(model.events);
                    setTeams(model.teams);
                }
            }
        );
    }, [auth.user, clearExportError, clearFeedError, clearLoadError, runLoad]);

    useEffect(() => {
        void refresh(refreshVersion > 0 ? { force: true } : {});
    }, [auth.user?.uid, refresh, refreshVersion]);

    const download = async () => {
        if (!events.length) {
            setMessage('No events to export yet.');
            return;
        }
        clearExportError();
        clearFeedError();
        setMessage('');
        await runExport(
            () => exportCalendarIcsFile('all-plays-family-schedule.ics', buildParentScheduleIcs(events)),
            'Unable to export the calendar file. Try again or use the Apple or Google calendar links instead.',
            {
                onSuccess: () => {
                    setMessage('Calendar file ready to share.');
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
        clearExportError();
        clearFeedError();
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
            'Unable to open calendar feed.',
            {
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
