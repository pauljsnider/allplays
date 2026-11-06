import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, RefreshCw, Share2, Ticket } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  loadParentRegistrationApplicationsPage,
  loadParentRegistrations,
  type ParentRegistrationApplication,
  type ParentRegistrationApplicationError,
  type ParentRegistrationCard
} from '../../lib/parentRegistrationsService';
import { openPublicUrl, sharePublicUrl } from '../../lib/publicActions';
import type { AuthState } from '../../lib/types';
import { EmptyState, LoadingBlock, MetricCard, RetryableStatus, ToolHeader, useParentToolAsyncOperation } from './shared';

export function RegistrationsTool({ auth, refreshVersion }: { auth: AuthState; refreshVersion: number }) {
  const [cards, setCards] = useState<ParentRegistrationCard[]>([]);
  const [applications, setApplications] = useState<ParentRegistrationApplication[]>([]);
  const [applicationErrors, setApplicationErrors] = useState<ParentRegistrationApplicationError[]>([]);
  const [nextCursor, setNextCursor] = useState<unknown>(null);
  const [retryCursor, setRetryCursor] = useState<unknown>(null);
  const [lastAttemptedCursor, setLastAttemptedCursor] = useState<unknown>(null);
  const [hasMore, setHasMore] = useState(false);
  const formsOperation = useParentToolAsyncOperation();
  const applicationsOperation = useParentToolAsyncOperation();

  const refreshForms = useCallback(async () => {
    return formsOperation.run(() => loadParentRegistrations(auth.user), 'Unable to load registrations.', { onSuccess: setCards });
  }, [auth.user, formsOperation.run]);

  const loadApplicationsPage = useCallback(
    async (cursor: unknown, mode: 'replace' | 'append') => {
      setLastAttemptedCursor(cursor);
      return applicationsOperation.run(
        () => loadParentRegistrationApplicationsPage(auth.user, { cursor }),
        'Unable to load submitted applications.',
        {
          onSuccess: (page) => {
            setApplications((existing) => (mode === 'replace' ? page.applications : mergeApplications(existing, page.applications)));
            setApplicationErrors(page.errors);
            setNextCursor(page.nextCursor);
            setRetryCursor(page.errors.length > 0 ? (page.retryCursor ?? cursor) : null);
            setHasMore(page.hasMore);
          }
        }
      );
    },
    [applicationsOperation.run, auth.user]
  );

  const refreshApplications = useCallback(() => {
    setApplications([]);
    setApplicationErrors([]);
    setNextCursor(null);
    setRetryCursor(null);
    setHasMore(false);
    return loadApplicationsPage(null, 'replace');
  }, [loadApplicationsPage]);

  const refreshAll = useCallback(() => {
    void refreshForms();
    void refreshApplications();
  }, [refreshApplications, refreshForms]);

  useEffect(() => {
    void refreshForms();
  }, [auth.user?.uid, auth.user?.email, refreshForms, refreshVersion]);

  useEffect(() => {
    void refreshApplications();
  }, [auth.user?.uid, auth.user?.email, refreshApplications, refreshVersion]);

  const retryApplications = () => {
    const cursor = retryCursor ?? lastAttemptedCursor;
    void loadApplicationsPage(cursor, applications.length > 0 ? 'append' : 'replace');
  };

  return (
    <div className="space-y-3">
      <section className="app-card p-4">
        <ToolHeader
          icon={Ticket}
          title="Registrations"
          detail="Review submitted applications and published forms linked to your family."
          action={
            <button
              type="button"
              className="ghost-button !min-h-9 text-xs"
              onClick={refreshAll}
              disabled={formsOperation.loading || applicationsOperation.loading}
            >
              <RefreshCw
                className={`h-4 w-4 ${formsOperation.loading || applicationsOperation.loading ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              Refresh
            </button>
          }
        />
      </section>

      <section className="space-y-3" aria-labelledby="submitted-applications-heading">
        <div className="app-card p-4">
          <h3 id="submitted-applications-heading" className="text-sm font-black text-gray-950">
            Submitted applications
          </h3>
          <p className="mt-1 text-xs font-semibold text-gray-500">Track registration decisions even after a form closes.</p>
          {applicationsOperation.error ? (
            <RetryableStatus
              error={applicationsOperation.error}
              fallbackMessage="Unable to load submitted applications."
              onRetry={retryApplications}
              retrying={applicationsOperation.loading}
              buttonLabel="Retry applications"
            />
          ) : null}
          {applicationErrors.length > 0 ? (
            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">
              <div>{applicationErrors[0].message || 'Some submitted applications could not be loaded.'}</div>
              <button
                type="button"
                className="ghost-button mt-2 !min-h-8 !px-2 text-xs"
                onClick={retryApplications}
                disabled={applicationsOperation.loading}
              >
                <RefreshCw className={`h-4 w-4 ${applicationsOperation.loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                Retry applications
              </button>
            </div>
          ) : null}
        </div>
        {applicationsOperation.loading && applications.length === 0 ? (
          <LoadingBlock label="Loading submitted applications" />
        ) : applications.length > 0 ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {applications.map((application) => (
              <ApplicationCard
                key={application.registrationKey || `${application.teamId}-${application.formId}-${application.id}`}
                application={application}
              />
            ))}
          </div>
        ) : !applicationsOperation.error ? (
          <EmptyState icon={Ticket} title="No submitted applications" detail="Completed registration applications will appear here." />
        ) : null}
        {applicationErrors.length === 0 && hasMore && nextCursor ? (
          <button
            type="button"
            className="secondary-button w-full justify-center text-xs"
            onClick={() => void loadApplicationsPage(nextCursor, 'append')}
            disabled={applicationsOperation.loading}
          >
            {applicationsOperation.loading ? 'Loading applications...' : 'Load more applications'}
          </button>
        ) : null}
      </section>

      <section className="space-y-3" aria-labelledby="available-registrations-heading">
        <div className="app-card p-4">
          <h3 id="available-registrations-heading" className="text-sm font-black text-gray-950">
            Available registrations
          </h3>
          <p className="mt-1 text-xs font-semibold text-gray-500">Published forms currently open to your family.</p>
          {formsOperation.error ? (
            <RetryableStatus
              error={formsOperation.error}
              fallbackMessage="Unable to load registrations."
              onRetry={refreshForms}
              retrying={formsOperation.loading}
            />
          ) : null}
        </div>
        {!formsOperation.error &&
          (formsOperation.loading ? (
            <LoadingBlock label="Loading registrations" />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {cards.length ? (
                cards.map((card) => <RegistrationCard key={`${card.teamId}-${card.id}`} card={card} />)
              ) : (
                <EmptyState icon={Ticket} title="No open registrations" detail="Published registration forms will appear here." />
              )}
            </div>
          ))}
      </section>
    </div>
  );
}

function mergeApplications(existing: ParentRegistrationApplication[], incoming: ParentRegistrationApplication[]) {
  const merged = new Map<string, ParentRegistrationApplication>();
  [...existing, ...incoming].forEach((application) => {
    const key = application.registrationKey || `${application.teamId}-${application.formId}-${application.id}`;
    merged.set(key, application);
  });
  return [...merged.values()];
}

function ApplicationCard({ application }: { application: ParentRegistrationApplication }) {
  return (
    <article className="app-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-black text-gray-950">{application.playerName}</div>
          <div className="mt-1 truncate text-xs font-semibold text-gray-600">{application.programName}</div>
          <div className="mt-0.5 truncate text-xs font-semibold text-gray-500">{application.teamName}</div>
        </div>
        <span className="flex-none rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-black text-gray-700">
          {application.statusLabel}
        </span>
      </div>
      {application.selectedOptionLabel ? (
        <div className="mt-3 text-xs font-semibold text-gray-500">Option: {application.selectedOptionLabel}</div>
      ) : null}
    </article>
  );
}

function RegistrationCard({ card }: { card: ParentRegistrationCard }) {
  const shareUrl = card.appUrl || card.url;
  return (
    <section className="app-card p-4">
      <div className="flex items-start gap-3">
        <div className="bg-primary-50 text-primary-700 flex h-11 w-11 flex-none items-center justify-center rounded-xl">
          <Ticket className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-black text-gray-950">{card.programName}</div>
          <div className="mt-0.5 truncate text-xs font-semibold text-gray-500">
            {card.teamName}
            {card.season ? ` - ${card.season}` : ''}
          </div>
          {card.description ? (
            <div className="mt-2 line-clamp-2 text-sm leading-5 font-semibold text-gray-600">{card.description}</div>
          ) : null}
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <MetricCard label="Fee" value={card.feeLabel} />
        <MetricCard label="Options" value={String(card.options.length)} />
        <MetricCard label="Checkout" value={card.onlineCheckout ? 'Online' : 'Offline'} />
      </div>
      {card.paymentNotice ? (
        <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs font-semibold text-blue-800">
          {card.paymentNotice}
        </div>
      ) : null}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Link to={`/parent-tools/registrations/${card.teamId}/${card.id}`} className="primary-button justify-center text-xs">
          <Ticket className="h-4 w-4" aria-hidden="true" />
          Review
        </Link>
        <button type="button" className="secondary-button justify-center text-xs" onClick={() => openPublicUrl(card.url)}>
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          Legacy form
        </button>
        <button
          type="button"
          className="secondary-button justify-center text-xs sm:col-span-2"
          onClick={() => sharePublicUrl({ title: card.programName, text: `${card.teamName} registration`, url: shareUrl })}
        >
          <Share2 className="h-4 w-4" aria-hidden="true" />
          Share
        </button>
      </div>
    </section>
  );
}
