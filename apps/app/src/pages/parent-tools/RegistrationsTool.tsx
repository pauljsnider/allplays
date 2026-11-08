import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ExternalLink, RefreshCw, Share2, Ticket } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
    loadParentRegistrationApplicationsPage,
    loadParentRegistrations,
    type ParentRegistrationApplication,
    type ParentRegistrationApplicationCursor,
    type ParentRegistrationApplicationError,
    type ParentRegistrationCard
} from '../../lib/parentRegistrationsService';
import { openPublicUrl, sharePublicUrl } from '../../lib/publicActions';
import type { AuthState } from '../../lib/types';
import { EmptyState, LoadingBlock, MetricCard, RetryableStatus, ToolHeader, useParentToolAsyncOperation } from './shared';

export function RegistrationsTool({ auth, refreshVersion }: { auth: AuthState; refreshVersion: number }) {
    const [cards, setCards] = useState<ParentRegistrationCard[]>([]);
    const [applications, setApplications] = useState<ParentRegistrationApplication[]>([]);
    const [applicationsNextCursor, setApplicationsNextCursor] = useState<ParentRegistrationApplicationCursor | null>(null);
    const [applicationsRetryCursor, setApplicationsRetryCursor] = useState<ParentRegistrationApplicationCursor | null>(null);
    const [applicationsHasMore, setApplicationsHasMore] = useState(false);
    const [applicationPageErrors, setApplicationPageErrors] = useState<ParentRegistrationApplicationError[]>([]);
    const { loading, error, run: runLoad } = useParentToolAsyncOperation();
    const { loading: applicationsLoading, error: applicationsError, run: runApplicationsLoad } = useParentToolAsyncOperation();

    const refresh = useCallback(async () => {
        return runLoad(
            () => loadParentRegistrations(auth.user),
            'Unable to load registrations.',
            {
                onSuccess: (result) => {
                    setCards(result);
                }
            }
        );
    }, [auth.user, runLoad]);

    const loadApplicationsPage = useCallback(async (cursor: ParentRegistrationApplicationCursor | null, replace: boolean) => {
        return runApplicationsLoad(
            () => loadParentRegistrationApplicationsPage(auth.user, { cursor }),
            'Unable to load submitted applications.',
            {
                onError: () => {
                    setApplicationsRetryCursor(cursor);
                },
                onSuccess: (result) => {
                    const pageApplications = result?.applications || [];
                    setApplications((current) => mergeApplications(replace ? [] : current, pageApplications));
                    setApplicationsNextCursor(result?.nextCursor || null);
                    setApplicationsRetryCursor(result?.retryCursor || null);
                    setApplicationsHasMore(Boolean(result?.hasMore));
                    setApplicationPageErrors(result?.errors || []);
                }
            }
        );
    }, [auth.user, runApplicationsLoad]);

    const refreshApplications = useCallback(async () => {
        return loadApplicationsPage(null, true);
    }, [loadApplicationsPage]);

    const loadMoreApplications = useCallback(async () => {
        if (!applicationsNextCursor || applicationsLoading) return;
        return loadApplicationsPage(applicationsNextCursor, false);
    }, [applicationsLoading, applicationsNextCursor, loadApplicationsPage]);

    const retryApplicationPage = useCallback(async () => {
        if (applicationsLoading) return;
        return loadApplicationsPage(applicationsRetryCursor, false);
    }, [applicationsLoading, applicationsRetryCursor, loadApplicationsPage]);

    useEffect(() => {
        void refresh();
        void refreshApplications();
    }, [auth.user?.uid, refresh, refreshApplications, refreshVersion]);

    return (
        <div className="space-y-3">
            <section className="app-card p-4">
                <ToolHeader icon={Ticket} title="Registrations" detail="Published team registration forms linked to your family." action={<button type="button" className="ghost-button !min-h-9 text-xs" onClick={refresh} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh</button>} />
                {error ? <RetryableStatus error={error} fallbackMessage="Unable to load registrations." onRetry={refresh} retrying={loading} /> : null}
            </section>
            {!error && (loading ? <LoadingBlock label="Loading registrations" /> : (
                <div className="grid gap-3 lg:grid-cols-2">
                    {cards.length ? cards.map((card) => <RegistrationCard key={`${card.teamId}-${card.id}`} card={card} />) : (
                        <EmptyState icon={Ticket} title="No open registrations" detail="Published registration forms will appear here." />
                    )}
                </div>
            ))}
            <section className="app-card p-4">
                <ToolHeader icon={Ticket} title="Submitted applications" detail="Read-only history of registration applications submitted by your family." />
                {applicationsError ? <RetryableStatus error={applicationsError} fallbackMessage="Unable to load submitted applications." onRetry={retryApplicationPage} retrying={applicationsLoading} /> : null}
                {applicationPageErrors.length ? (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900" role="alert">
                        <div className="flex items-start gap-3">
                            <AlertCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
                            <div className="min-w-0 flex-1">
                                <div>Some submitted applications could not be loaded.</div>
                                <div className="mt-1 text-xs">{uniqueApplicationErrorMessages(applicationPageErrors).join(' ')}</div>
                            </div>
                            <button type="button" className="ghost-button !min-h-8 !px-2 text-xs" onClick={() => void retryApplicationPage()} disabled={applicationsLoading}>
                                <RefreshCw className={`h-4 w-4 ${applicationsLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
                                Retry incomplete page
                            </button>
                        </div>
                    </div>
                ) : null}
                {applicationsLoading && !applications.length ? <LoadingBlock label="Loading submitted applications" /> : null}
                {applications.length ? <div className="mt-3 grid gap-3 lg:grid-cols-2">{applications.map((application) => <SubmittedApplicationCard key={application.registrationKey || application.id} application={application} />)}</div> : null}
                {!applicationsLoading && !applicationsError && !applicationPageErrors.length && !applications.length ? (
                    <div className="mt-3"><EmptyState icon={Ticket} title="No submitted applications" detail="Applications submitted through registration forms will appear here." /></div>
                ) : null}
                {applicationsHasMore && applicationsNextCursor && !applicationPageErrors.length ? (
                    <button type="button" className="ghost-button mt-3 w-full justify-center" onClick={() => void loadMoreApplications()} disabled={applicationsLoading}>
                        <RefreshCw className={`h-4 w-4 ${applicationsLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
                        {applicationsLoading ? 'Loading more applications' : 'Load more applications'}
                    </button>
                ) : null}
            </section>
        </div>
    );
}

function mergeApplications(current: ParentRegistrationApplication[], additions: ParentRegistrationApplication[]) {
    const applicationsByKey = new Map(current.map((application) => [getApplicationKey(application), application]));
    additions.forEach((application) => applicationsByKey.set(getApplicationKey(application), application));
    return Array.from(applicationsByKey.values());
}

function getApplicationKey(application: ParentRegistrationApplication) {
    return application.registrationKey || `${application.teamId}:${application.formId}:${application.id}`;
}

function uniqueApplicationErrorMessages(errors: ParentRegistrationApplicationError[]) {
    return Array.from(new Set(errors.map((error) => String(error.message || '').trim()).filter(Boolean)));
}

function SubmittedApplicationCard({ application }: { application: ParentRegistrationApplication }) {
    return (
        <section className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="grid gap-2 sm:grid-cols-2">
                <MetricCard label="Player" value={application.playerName || 'Not provided'} />
                <MetricCard label="Program" value={application.programName || 'Not provided'} />
                <MetricCard label="Team" value={application.teamName || 'Not provided'} />
                {application.selectedOptionLabel ? <MetricCard label="Selected option" value={application.selectedOptionLabel} /> : null}
                <MetricCard label="Status" value={application.statusLabel} />
            </div>
        </section>
    );
}

function RegistrationCard({ card }: { card: ParentRegistrationCard }) {
    const shareUrl = card.appUrl || card.url;
    return (
        <section className="app-card p-4">
            <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                    <Ticket className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-black text-gray-950">{card.programName}</div>
                    <div className="mt-0.5 truncate text-xs font-semibold text-gray-500">{card.teamName}{card.season ? ` - ${card.season}` : ''}</div>
                    {card.description ? <div className="mt-2 line-clamp-2 text-sm font-semibold leading-5 text-gray-600">{card.description}</div> : null}
                </div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <MetricCard label="Fee" value={card.feeLabel} />
                <MetricCard label="Options" value={String(card.options.length)} />
                <MetricCard label="Checkout" value={card.onlineCheckout ? 'Online' : 'Offline'} />
            </div>
            {card.paymentNotice ? <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs font-semibold text-blue-800">{card.paymentNotice}</div> : null}
            <div className="mt-3 grid grid-cols-2 gap-2">
                <Link to={`/parent-tools/registrations/${card.teamId}/${card.id}`} className="primary-button justify-center text-xs">
                    <Ticket className="h-4 w-4" aria-hidden="true" />
                    Review
                </Link>
                <button type="button" className="secondary-button justify-center text-xs" onClick={() => openPublicUrl(card.url)}>
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    Legacy form
                </button>
                <button type="button" className="secondary-button justify-center text-xs sm:col-span-2" onClick={() => sharePublicUrl({ title: card.programName, text: `${card.teamName} registration`, url: shareUrl })}>
                    <Share2 className="h-4 w-4" aria-hidden="true" />
                    Share
                </button>
            </div>
        </section>
    );
}
