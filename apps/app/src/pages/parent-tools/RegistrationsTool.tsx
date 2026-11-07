import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, RefreshCw, Share2, Ticket } from 'lucide-react';
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
  const [applicationErrors, setApplicationErrors] = useState<ParentRegistrationApplicationError[]>([]);
  const [nextCursor, setNextCursor] = useState<ParentRegistrationApplicationCursor | null>(null);
  const [retryCursor, setRetryCursor] = useState<ParentRegistrationApplicationCursor | null>(null);
  const [applicationsLoaded, setApplicationsLoaded] = useState(false);
  const applicationUserIdRef = useRef(auth.user?.uid);
  const { loading: registrationsLoading, error: registrationsError, run: runRegistrationsLoad } = useParentToolAsyncOperation();
  const { loading: applicationsLoading, error: applicationsLoadError, run: runApplicationsLoad } = useParentToolAsyncOperation();

  const refreshRegistrations = useCallback(async () => {
    return runRegistrationsLoad(() => loadParentRegistrations(auth.user), 'Unable to load registrations.', {
      onSuccess: (result) => {
        setCards(result);
      }
    });
  }, [auth.user, runRegistrationsLoad]);

  const loadApplications = useCallback(
    async (cursor: ParentRegistrationApplicationCursor | null, replace = false) => {
      return runApplicationsLoad(
        () => loadParentRegistrationApplicationsPage(auth.user, { cursor }),
        'Unable to load submitted applications.',
        {
          onSuccess: (page) => {
            setApplications((current) => mergeRegistrationApplications(replace ? [] : current, page.applications || []));
            setApplicationErrors(page.errors || []);
            setNextCursor(page.nextCursor || null);
            setRetryCursor(page.errors?.length ? (page.retryCursor ?? cursor) : null);
            setApplicationsLoaded(true);
          },
          onError: () => {
            setApplicationErrors([]);
            setRetryCursor(cursor);
            setApplicationsLoaded(true);
          }
        }
      );
    },
    [auth.user, runApplicationsLoad]
  );

  const refreshApplications = useCallback(() => loadApplications(null, true), [loadApplications]);

  const refresh = useCallback(async () => {
    await Promise.all([refreshRegistrations(), refreshApplications()]);
  }, [refreshApplications, refreshRegistrations]);

  useEffect(() => {
    if (applicationUserIdRef.current !== auth.user?.uid) {
      applicationUserIdRef.current = auth.user?.uid;
      setApplications([]);
      setApplicationErrors([]);
      setNextCursor(null);
      setRetryCursor(null);
      setApplicationsLoaded(false);
    }
    void refresh();
  }, [auth.user?.uid, refresh, refreshVersion]);

  const applicationErrorMessage = applicationErrors[0]?.message || 'Unable to load submitted applications.';
  const hasApplicationError = Boolean(applicationsLoadError || applicationErrors.length);
  const retryApplications = useCallback(() => {
    void loadApplications(retryCursor);
  }, [loadApplications, retryCursor]);

  return (
    <div className="space-y-3">
      <section className="app-card p-4">
        <ToolHeader
          icon={Ticket}
          title="Registrations"
          detail="Published team registration forms linked to your family."
          action={
            <button
              type="button"
              className="ghost-button !min-h-9 text-xs"
              onClick={refresh}
              disabled={registrationsLoading || applicationsLoading}
            >
              <RefreshCw className={`h-4 w-4 ${registrationsLoading || applicationsLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </button>
          }
        />
        {registrationsError ? (
          <RetryableStatus
            error={registrationsError}
            fallbackMessage="Unable to load registrations."
            onRetry={refreshRegistrations}
            retrying={registrationsLoading}
          />
        ) : null}
      </section>
      {!registrationsError &&
        (registrationsLoading ? (
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
      <section className="space-y-3" aria-labelledby="submitted-applications-heading">
        <div className="app-card p-4">
          <h3 id="submitted-applications-heading" className="text-sm font-black text-gray-950">
            Submitted applications
          </h3>
          <p className="mt-0.5 text-xs leading-5 font-semibold text-gray-500">
            Review the read-only status of registration applications you submitted.
          </p>
          {hasApplicationError ? (
            <RetryableStatus
              error={applicationsLoadError}
              fallbackMessage={applicationErrorMessage}
              onRetry={retryApplications}
              retrying={applicationsLoading}
              buttonLabel={applicationsLoading ? 'Retrying...' : 'Retry'}
            />
          ) : null}
        </div>
        {!applicationsLoaded && applications.length === 0 ? (
          <LoadingBlock label="Loading submitted applications" />
        ) : applications.length === 0 && !hasApplicationError && !applicationsLoading ? (
          <EmptyState icon={Ticket} title="No submitted applications" detail="Submitted registration applications will appear here." />
        ) : (
          <>
            <div className="grid gap-3 lg:grid-cols-2">
              {applications.map((application) => (
                <RegistrationApplicationCard key={getRegistrationApplicationKey(application)} application={application} />
              ))}
            </div>
            {nextCursor && !hasApplicationError ? (
              <button
                type="button"
                className="secondary-button w-full justify-center text-sm"
                onClick={() => void loadApplications(nextCursor)}
                disabled={applicationsLoading}
              >
                <RefreshCw className={`h-4 w-4 ${applicationsLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
                {applicationsLoading ? 'Loading...' : 'Load more'}
              </button>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

export function mergeRegistrationApplications(
  existing: ParentRegistrationApplication[],
  incoming: ParentRegistrationApplication[]
): ParentRegistrationApplication[] {
  const applicationsByKey = new Map<string, ParentRegistrationApplication>();
  [...existing, ...incoming].forEach((application) => {
    applicationsByKey.set(getRegistrationApplicationKey(application), application);
  });
  return [...applicationsByKey.values()].sort((left, right) => {
    const submittedAtDifference = getRegistrationApplicationSubmittedAt(right) - getRegistrationApplicationSubmittedAt(left);
    if (submittedAtDifference !== 0) return submittedAtDifference;
    return getRegistrationApplicationKey(right).localeCompare(getRegistrationApplicationKey(left));
  });
}

function getRegistrationApplicationKey(application: ParentRegistrationApplication) {
  return application.registrationKey || `${application.teamId}/${application.formId}/${application.id}`;
}

function getRegistrationApplicationSubmittedAt(application: ParentRegistrationApplication) {
  const submittedAt = application.submittedAt as
    | {
        toMillis?: () => number;
        seconds?: number;
        nanoseconds?: number;
      }
    | string
    | number
    | Date
    | null;
  if (submittedAt && typeof submittedAt === 'object' && 'toMillis' in submittedAt && typeof submittedAt.toMillis === 'function') {
    return submittedAt.toMillis();
  }
  if (submittedAt && typeof submittedAt === 'object' && 'seconds' in submittedAt && Number.isFinite(submittedAt.seconds)) {
    return Number(submittedAt.seconds) * 1000 + Math.floor(Number(submittedAt.nanoseconds || 0) / 1_000_000);
  }
  const milliseconds = submittedAt ? new Date(submittedAt as string | number | Date).getTime() : 0;
  return Number.isFinite(milliseconds) ? milliseconds : 0;
}

function RegistrationApplicationCard({ application }: { application: ParentRegistrationApplication }) {
  const statusClassName =
    {
      pending: 'border-amber-200 bg-amber-50 text-amber-700',
      waitlisted: 'border-purple-200 bg-purple-50 text-purple-700',
      'offer-extended': 'border-blue-200 bg-blue-50 text-blue-700',
      'offer-accepted': 'border-indigo-200 bg-indigo-50 text-indigo-700',
      enrolled: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      released: 'border-gray-200 bg-gray-50 text-gray-700',
      rejected: 'border-rose-200 bg-rose-50 text-rose-700'
    }[application.status] || 'border-gray-200 bg-gray-50 text-gray-700';

  return (
    <section className="app-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-black text-gray-950">{application.playerName}</div>
          <div className="mt-0.5 truncate text-xs font-semibold text-gray-500">{application.programName}</div>
          <div className="truncate text-xs font-semibold text-gray-500">{application.teamName}</div>
          {application.selectedOptionLabel ? (
            <div className="mt-2 text-xs font-semibold text-gray-600">Option: {application.selectedOptionLabel}</div>
          ) : null}
        </div>
        <span className={`inline-flex flex-none rounded-full border px-2.5 py-1 text-xs font-black ${statusClassName}`}>
          {application.statusLabel}
        </span>
      </div>
      <div className="mt-3 text-[11px] font-semibold text-gray-400">Status is read-only and controlled by the team admin.</div>
    </section>
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
