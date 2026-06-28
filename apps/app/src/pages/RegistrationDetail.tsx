import { useEffect, useMemo, useRef, useState, type InputHTMLAttributes, type SyntheticEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import * as parentToolsService from '../lib/parentToolsService';
import { AlertCircle, CheckCircle2, ChevronLeft, ExternalLink, Loader2, Send, Ticket, UserPlus, XCircle, type LucideIcon } from 'lucide-react';
import { openPublicUrl } from '../lib/publicActions';
import type {
  ParentRegistrationCard,
  ParentRegistrationDetailModel,
  TeamRegistrationQueueModel
} from '../lib/parentToolsService';
import {
  calculateRegistrationFeeSnapshot,
  decideRegistrationPlacement,
  formatFeeSnapshotLines,
  getActiveRegistrationOptions,
  getPaymentPlanChoices,
  requiresRegistrationOption,
  hasQuantityDiscountRule
} from '../lib/adapters/legacyRegistration';
import type { AuthState } from '../lib/types';

type FieldErrors = Record<string, string>;
type FeeSummaryLine = { label: string; amountCents: number; strong?: boolean };
type FieldInputHints = Pick<InputHTMLAttributes<HTMLInputElement>, 'inputMode' | 'autoComplete' | 'enterKeyHint'>;

export function selectInitialRegistrationOption(form: ParentRegistrationCard | null, options: any[]) {
  if (!form || !Array.isArray(options) || !options.length) return '';
  const counts = form.registrationOptionCounts || {};
  const preferredOption = options.find((option) => {
    if (!option?.id) return false;
    const placement = decideRegistrationPlacement({ form, selectedOptionId: option.id, counts });
    return placement?.status === 'pending';
  });
  return preferredOption?.id || options[0]?.id || '';
}

export function RegistrationDetail({ auth, publicAccess = false }: { auth: AuthState; publicAccess?: boolean }) {
  return <RegistrationDetailPage auth={auth} publicAccess={publicAccess} staffReview={false} />;
}

export function TeamRegistrationReview({ auth }: { auth: AuthState }) {
  return <RegistrationDetailPage auth={auth} publicAccess={false} staffReview />;
}

function RegistrationDetailPage({ auth, publicAccess = false, staffReview = false }: { auth: AuthState; publicAccess?: boolean; staffReview?: boolean }) {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const teamId = publicAccess ? (searchParams.get('teamId') || '') : (params.teamId || '');
  const formId = publicAccess ? (searchParams.get('formId') || '') : (params.formId || '');
  const returnRegistrationId = searchParams.get('registrationId') || '';
  const returnCheckoutAttemptToken = searchParams.get('checkoutAttemptToken') || '';
  const returnPublicCheckoutCapability = searchParams.get('publicCheckoutCapability') || '';
  const retryPaymentRequested = searchParams.get('retryPayment') === '1' && Boolean(returnPublicCheckoutCapability || returnRegistrationId);
  const successfulPaymentPlanId = normalizePaymentPlanId(searchParams.get('paymentPlanId'));
  const successfulPaidInstallmentCount = normalizePaidInstallmentCount(searchParams.get('paidInstallmentCount'));
  const returnStatus = normalizeRegistrationReturnStatus(searchParams.get('status'));
  const isPaymentSuccessReturn = returnStatus === 'success' && Boolean(returnPublicCheckoutCapability || returnRegistrationId);
  const isRetryPaymentMode = retryPaymentRequested && !isPaymentSuccessReturn;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ParentRegistrationCard | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [participant, setParticipant] = useState<Record<string, string>>({});
  const [guardian, setGuardian] = useState<Record<string, string>>({});
  const [waiverAccepted, setWaiverAccepted] = useState(false);
  const [selectedOptionId, setSelectedOptionId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [selectedPaymentPlanId, setSelectedPaymentPlanId] = useState('pay_full');
  const [currentPublicCheckoutCapability, setCurrentPublicCheckoutCapability] = useState(returnPublicCheckoutCapability);
  const [queue, setQueue] = useState<TeamRegistrationQueueModel | null>(null);
  const [selectedReviewId, setSelectedReviewId] = useState('');
  const [selectedMergePlayerId, setSelectedMergePlayerId] = useState('');
  const [lastDoc, setLastDoc] = useState<any>(null);
  const [hasMore, setHasMore] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const formRef = useRef<HTMLFormElement | null>(null);
  const cancelledCheckoutReleaseKeyRef = useRef('');

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      setLoading(true);
      setError('');
      try {
        const nextForm = await loadRegistrationForm(auth.user, teamId, formId, publicAccess, staffReview);
        if (cancelled) return;
        if (!nextForm) {
          setError('Registration form not found or not active.');
          setForm(null);
          return;
        }
        if (!staffReview && nextForm.isPublished === false) {
          setError('This linked registration form is not published right now.');
          setForm(null);
          return;
        }
        setForm(nextForm);
        if (staffReview) {
          const [nextPage, waitlistedPage, rosterPlayers] = await Promise.all([
            (parentToolsService as any).loadTeamRegistrationQueuePage(teamId, formId) as Promise<{ reviews: any[]; lastDoc: any; hasMore: boolean }>,
            (parentToolsService as any).loadTeamRegistrationQueuePage(teamId, formId, { status: 'waitlisted' }) as Promise<{ reviews: any[]; lastDoc: any; hasMore: boolean }>,
            (parentToolsService as any).loadTeamRegistrationRosterPlayers(auth.user, teamId).catch(() => [])
          ]);
          if (cancelled) return;
          const nextQueue: TeamRegistrationQueueModel = {
            reviews: nextPage.reviews,
            rosterPlayers,
            waitlistedReviews: waitlistedPage.reviews,
            totalWaitlisted: getTotalWaitlistedCount(nextForm.registrationOptionCounts, waitlistedPage.reviews.length)
          };
          setQueue(nextQueue);
          setLastDoc(nextPage.lastDoc);
          setHasMore(nextPage.hasMore);
          const firstReviewId = nextQueue.reviews[0]?.id || nextQueue.waitlistedReviews?.[0]?.id || '';
          setSelectedReviewId((current) => current && [...nextQueue.reviews, ...(nextQueue.waitlistedReviews || [])].some((review) => review.id === current) ? current : firstReviewId);
        } else {
          setQueue(null);
          setLastDoc(null);
          setHasMore(false);
        }
        const initialOptions = (Array.isArray(nextForm.options) && nextForm.options.length) ? nextForm.options : getActiveRegistrationOptions(nextForm, nextForm.registrationOptionCounts || {});
        const initialOptionId = selectInitialRegistrationOption(nextForm, initialOptions);
        setSelectedOptionId((current) => {
          if (!current) return initialOptionId;
          if (initialOptions.length === 1) return initialOptionId;
          return initialOptions.some((option) => option?.id === current) ? current : initialOptionId;
        });
      } catch (loadError: any) {
        if (!cancelled) setError(loadError?.message || 'Unable to load registration form.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void refresh();
    return () => {
      cancelled = true;
    };
  }, [auth.user?.uid, teamId, formId, publicAccess, reloadKey, staffReview]);

  const activeOptions: any[] = useMemo(() => form ? ((Array.isArray(form.options) && form.options.length) ? form.options : getActiveRegistrationOptions(form, form.registrationOptionCounts || {})) : [], [form]);
  const paymentPlanChoices: any[] = useMemo(() => form ? ((Array.isArray(form.paymentPlans) && form.paymentPlans.length) ? form.paymentPlans : getPaymentPlanChoices(form)) : [], [form]);
  const showPaymentPlanSelector = paymentPlanChoices.length > 1;
  const showRegistrationOptionSelector = activeOptions.length > 1;
  const singleActiveOption = activeOptions.length === 1 ? activeOptions[0] : null;
  const selectedOption = activeOptions.find((option) => option.id === selectedOptionId) || singleActiveOption || null;
  const placement = useMemo(() => {
    if (!form || !requiresRegistrationOption(form) || !selectedOptionId) return null;
    return decideRegistrationPlacement({ form, selectedOptionId, counts: form.registrationOptionCounts || {} });
  }, [form, selectedOptionId]);
  const hasQuantityDiscount = useMemo(() => form ? hasQuantityDiscountRule(form.discountRules) : false, [form]);
  const effectiveQuantity = useMemo(() => hasQuantityDiscount ? quantity : 1, [hasQuantityDiscount, quantity]);
  const displayFeeSnapshot = useMemo(() => form ? calculateRegistrationFeeSnapshot(form, { quantity: effectiveQuantity, now: new Date() }) : null, [form, effectiveQuantity]);
  const displayFeeLines = useMemo<FeeSummaryLine[]>(() => displayFeeSnapshot ? formatFeeSnapshotLines(displayFeeSnapshot) : [], [displayFeeSnapshot]);
  const selectedPaymentPlanSummary = useMemo(() => {
    if (!form || !displayFeeSnapshot) return null;
    return buildRegistrationPaymentPlanSummary(form, displayFeeSnapshot, selectedPaymentPlanId, 0);
  }, [displayFeeSnapshot, form, selectedPaymentPlanId]);
  const successfulPaymentPlanSummary = useMemo(() => {
    if (!form || !displayFeeSnapshot || !isPaymentSuccessReturn) return null;
    const paymentPlanId = successfulPaymentPlanId || selectedPaymentPlanId;
    const paidInstallmentCount = paymentPlanId === 'installments' ? Math.max(1, successfulPaidInstallmentCount) : 0;
    return buildRegistrationPaymentPlanSummary(form, displayFeeSnapshot, paymentPlanId, paidInstallmentCount);
  }, [displayFeeSnapshot, form, isPaymentSuccessReturn, selectedPaymentPlanId, successfulPaidInstallmentCount, successfulPaymentPlanId]);
  const selectedReview = useMemo(() => {
    const allReviews = [...(queue?.reviews || []), ...(queue?.waitlistedReviews || [])];
    return allReviews.find((review) => review.id === selectedReviewId) || allReviews[0] || null;
  }, [queue, selectedReviewId]);
  const waitlistedReviews = useMemo(() => queue?.waitlistedReviews || (queue?.reviews || []).filter((review) => review.status === 'waitlisted'), [queue]);
  const totalWaitlisted = queue?.totalWaitlisted ?? waitlistedReviews.length;
  const canApproveSelectedReview = selectedReview ? ['pending', 'offer-accepted'].includes(selectedReview.status) : false;
  const canPromoteSelectedReview = selectedReview?.status === 'waitlisted';
  const canAcceptOfferSelectedReview = selectedReview?.status === 'offer-extended';
  const canDeclineSelectedReview = selectedReview ? ['pending', 'waitlisted', 'offer-extended', 'offer-accepted'].includes(selectedReview.status) : false;
  const selectedReviewOptionAvailability = useMemo(() => {
    if (!form || !selectedReview) return '';
    const reviewOptionId = String(selectedReview.selectedOption?.id || selectedReview.selectedOption?.countKey || '');
    const reviewOptionTitle = String(selectedReview.selectedOptionLabel || '').trim();
    const reviewOption = (form.options || []).find((option: any) => (
      String(option?.id || '') === reviewOptionId
      || String(option?.countKey || '') === reviewOptionId
      || String(option?.title || '').trim() === reviewOptionTitle
    ));
    return reviewOption ? formatOptionAvailability(reviewOption, form.registrationOptionCounts || {}) : '';
  }, [form, selectedReview]);

  useEffect(() => {
    if (!selectedReview) return;
    setSelectedMergePlayerId(selectedReview.linkedPlayerId || '');
  }, [selectedReview?.id]);

  useEffect(() => {
    if (staffReview || returnStatus !== 'cancelled' || (!returnPublicCheckoutCapability && !returnRegistrationId)) return;

    const releaseAuthority = returnPublicCheckoutCapability || `${returnRegistrationId}:${returnCheckoutAttemptToken}`;
    if (!releaseAuthority) return;
    const releaseKey = `${teamId}:${formId}:${releaseAuthority}`;
    if (cancelledCheckoutReleaseKeyRef.current === releaseKey) return;
    cancelledCheckoutReleaseKeyRef.current = releaseKey;

    setMessage('');
    setError(retryPaymentRequested
      ? 'Stripe payment was cancelled. You can retry payment for this registration.'
      : 'Stripe payment was cancelled.');

    void parentToolsService.cancelRegistrationCheckout(
      teamId,
      formId,
      returnRegistrationId,
      returnCheckoutAttemptToken,
      returnPublicCheckoutCapability
    ).then((result: any) => {
      if (result?.nextPublicCheckoutCapability) {
        setCurrentPublicCheckoutCapability(result.nextPublicCheckoutCapability);
      }
    }).catch(() => {
      // Keep the retry path available even if release cleanup fails.
    });
  }, [formId, returnCheckoutAttemptToken, returnPublicCheckoutCapability, returnRegistrationId, returnStatus, retryPaymentRequested, staffReview, teamId]);

  useEffect(() => {
    setCurrentPublicCheckoutCapability(returnPublicCheckoutCapability);
  }, [returnPublicCheckoutCapability]);

  const updateParticipant = (fieldId: string, value: string) => setParticipant((current) => ({ ...current, [fieldId]: value }));
  const updateGuardian = (fieldId: string, value: string) => setGuardian((current) => ({ ...current, [fieldId]: value }));

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    if (!form || saving) return;

    const currentParticipant = collectFieldValues(formRef.current, 'participant', participant);
    const currentGuardian = collectFieldValues(formRef.current, 'guardian', guardian);
    const currentWaiverAccepted = Boolean((formRef.current?.querySelector('[data-waiver-field]') as HTMLInputElement | null)?.checked ?? waiverAccepted);
    const selectedOptionInput = formRef.current?.querySelector('[data-selected-option]') as HTMLSelectElement | null;
    const currentSelectedOptionId = selectedOptionInput ? String(selectedOptionInput.value) : selectedOptionId;
    const currentQuantity = hasQuantityDiscount ? Math.max(1, Number((formRef.current?.querySelector('[data-quantity-field]') as HTMLInputElement | null)?.value || quantity) || 1) : 1;
    const currentSelectedPaymentPlanId = String((formRef.current?.querySelector('[data-payment-plan]') as HTMLSelectElement | null)?.value || selectedPaymentPlanId);
    const currentSelectedOption = activeOptions.find((option) => option.id === currentSelectedOptionId) || selectedOption;
    const currentPlacement = placement;
    setParticipant(currentParticipant);
    setGuardian(currentGuardian);
    setWaiverAccepted(currentWaiverAccepted);
    setSelectedOptionId(currentSelectedOptionId);
    setQuantity(currentQuantity);
    setSelectedPaymentPlanId(currentSelectedPaymentPlanId);

    const nextErrors = validate(form, currentParticipant, currentGuardian, currentWaiverAccepted, currentSelectedOptionId, currentQuantity, currentSelectedPaymentPlanId, hasQuantityDiscount);
    setFieldErrors(nextErrors);
    setError('');
    setMessage('');
    if (Object.keys(nextErrors).length) return;
    if (currentPlacement?.status === 'blocked') {
      setError(currentPlacement.message || 'This registration option is not available.');
      return;
    }

    setSaving(true);
    try {
      const currentFeeSnapshot = calculateRegistrationFeeSnapshot(form, { quantity: currentQuantity, now: new Date() }); // currentQuantity is already effective
      const checkoutAttemptToken = isRetryPaymentMode ? returnCheckoutAttemptToken : createCheckoutAttemptToken();
      if (form.onlineCheckout && Number(currentFeeSnapshot.finalAmountDueCents || 0) > 0) {
        if (isRetryPaymentMode) {
          if (!currentPublicCheckoutCapability && !checkoutAttemptToken) {
            setError('We could not restore your previous checkout attempt. Please restart registration or contact the organizer.');
            return;
          }
          const checkout = await parentToolsService.initiateRegistrationCheckout(
            form.teamId,
            form.id,
            currentPublicCheckoutCapability ? '' : returnRegistrationId,
            requiresRegistrationOption(form) ? currentSelectedOptionId : currentSelectedOptionId || '',
            currentSelectedPaymentPlanId,
            currentQuantity,
            currentFeeSnapshot.finalAmountDueCents,
            currentFeeSnapshot.currency || form.currency || 'USD',
            {
              checkoutAttemptToken,
              retryPayment: true,
              publicCheckoutCapability: currentPublicCheckoutCapability || ''
            }
          );
          await openPublicUrl(checkout.checkoutUrl);
          setMessage('Opening Stripe checkout.');
          return;
        }
      }

      const result = await parentToolsService.submitOfflineRegistration(form.teamId, form.id, {
        participant: currentParticipant,
        guardian: currentGuardian,
        waiverAccepted: currentWaiverAccepted,
        selectedOption: currentSelectedOption,
        selectedOptionId: currentSelectedOptionId,
        selectedPaymentPlanId: currentSelectedPaymentPlanId,
        quantity: currentQuantity,
        feeSnapshot: currentFeeSnapshot,
        checkoutAttemptToken
      });
      if (result.status === 'waitlisted') {
        setMessage('Registration submitted. You have been added to the waitlist.');
        return;
      }
      const serverFeeSnapshot = (result as any)?.feeSnapshot || (result as any)?.registration?.feeSnapshot || null;
      const checkoutFeeSnapshot = serverFeeSnapshot || currentFeeSnapshot;
      if (form.onlineCheckout && Number(checkoutFeeSnapshot.finalAmountDueCents || 0) > 0) {
        try {
          const checkout = await parentToolsService.initiateRegistrationCheckout(
            form.teamId,
            form.id,
            result.registrationId,
            requiresRegistrationOption(form) ? currentSelectedOptionId : currentSelectedOptionId || '',
            currentSelectedPaymentPlanId,
            currentQuantity, // currentQuantity is already effective
            checkoutFeeSnapshot.finalAmountDueCents,
            checkoutFeeSnapshot.currency || form.currency || 'USD',
            {
              checkoutAttemptToken
            }
          );
          await openPublicUrl(checkout.checkoutUrl);
          setMessage('Registration submitted. Opening Stripe checkout.');
        } catch (checkoutError: any) {
          setError(checkoutError?.message
            ? `Registration created, but checkout could not be opened. ${checkoutError.message}`
            : 'Registration created, but checkout could not be opened. Please check your email for the payment link.');
        }
        return;
      }
      setMessage('Registration submitted. Your registration is pending review.');
    } catch (submitError: any) {
      setError(submitError?.code === 'option-full'
        ? submitError.message
        : submitError?.message || 'Registration could not be submitted. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!selectedReview || saving) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await (parentToolsService as any).approveTeamRegistrationForApp(auth.user, teamId, formId, selectedReview.id, {
        playerId: selectedMergePlayerId || undefined
      });
      setMessage('Registration approved. Roster and parent links were updated using the legacy approval flow.');
      setReloadKey((current) => current + 1);
    } catch (actionError: any) {
      setError(actionError?.message || 'Registration could not be approved.');
    } finally {
      setSaving(false);
    }
  };

  const handleDecline = async () => {
    if (!selectedReview || saving) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await (parentToolsService as any).rejectTeamRegistrationForApp(auth.user, teamId, formId, selectedReview.id);
      setMessage('Registration declined.');
      setReloadKey((current) => current + 1);
    } catch (actionError: any) {
      setError(actionError?.message || 'Registration could not be declined.');
    } finally {
      setSaving(false);
    }
  };

  const handlePromote = async () => {
    if (!selectedReview || saving) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await (parentToolsService as any).extendTeamRegistrationOfferForApp(auth.user, teamId, formId, selectedReview.id);
      setMessage('Waitlist offer extended using the legacy registration flow.');
      setReloadKey((current) => current + 1);
    } catch (actionError: any) {
      setError(actionError?.message || 'Waitlist offer could not be extended.');
    } finally {
      setSaving(false);
    }
  };

  const handleAcceptOffer = async () => {
    if (!selectedReview || saving) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await (parentToolsService as any).acceptTeamRegistrationOfferForApp(auth.user, teamId, formId, selectedReview.id);
      setMessage('Waitlist offer marked accepted. This registration can now be approved to the roster.');
      setReloadKey((current) => current + 1);
    } catch (actionError: any) {
      setError(actionError?.message || 'Waitlist offer could not be marked accepted.');
    } finally {
      setSaving(false);
    }
  };

  const handleLoadMore = async () => {
    if (!lastDoc || !hasMore || saving) return;
    setSaving(true);
    setError('');
    try {
      const nextPage = await (parentToolsService as any).loadTeamRegistrationQueuePage(teamId, formId, { afterDoc: lastDoc }) as { reviews: any[]; lastDoc: any; hasMore: boolean };
      setQueue((current: TeamRegistrationQueueModel | null) => current ? { ...current, reviews: [...current.reviews, ...nextPage.reviews] } : { reviews: nextPage.reviews, rosterPlayers: [] });
      setLastDoc(nextPage.lastDoc);
      setHasMore(nextPage.hasMore);
    } catch (loadError: any) {
      setError(loadError?.message || 'Unable to load more registrations.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingBlock label="Loading registration" />;
  if (!form) return <EmptyState icon={Ticket} title="Registration unavailable" detail={error || 'This registration form could not be loaded.'} actionLabel={error ? 'Retry' : ''} onAction={error ? () => setReloadKey((current) => current + 1) : undefined} />;

  if (staffReview) {
    return (
      <div className="space-y-3">
        <section className="app-card overflow-hidden">
          <div className="flex items-center gap-3 px-3 py-3 sm:px-4">
            <Link to={`/teams/${encodeURIComponent(teamId)}`} className="ghost-button !h-9 !min-h-9 !w-9 !flex-none !p-0" aria-label="Back to team" title="Back to team">
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Link>
            <div className="min-w-0 flex-1">
              <div className="app-label">Registration review</div>
              <h1 className="truncate text-xl font-black leading-tight text-gray-950">{form.programName}</h1>
              <p className="mt-0.5 truncate text-xs font-semibold text-gray-600">{form.teamName}{form.season ? ` - ${form.season}` : ''}</p>
            </div>
            {form.url ? (
              <button type="button" className="secondary-button !min-h-9 text-xs" onClick={() => openPublicUrl(form.url)}>
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                Legacy review
              </button>
            ) : null}
          </div>
        </section>

        {message ? <Status tone="success" message={message} /> : null}
        {error ? <Status tone="error" message={error} /> : null}

        <section className="grid gap-3 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <div className="app-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-black text-gray-950">Applications</div>
                <div className="text-xs font-semibold text-gray-500">Submitted registrations and their current review state.</div>
              </div>
              <button type="button" className="ghost-button !min-h-9 text-xs" onClick={() => setReloadKey((current) => current + 1)} disabled={loading || saving}>Refresh</button>
            </div>
            <div className="mt-3 grid gap-2">
              {waitlistedReviews.length ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                  <div className="text-sm font-black text-amber-950">Waitlisted applicants ({totalWaitlisted})</div>
                  <div className="mt-1 text-xs font-semibold text-amber-800">Promote a waitlisted applicant into the same offer and payment path used on the legacy site.</div>
                  <div className="mt-3 grid gap-2" data-waitlist-list>
                    {waitlistedReviews.map((review) => (
                      <button
                        key={`waitlist-${review.id}`}
                        type="button"
                        onClick={() => setSelectedReviewId(review.id)}
                        className={`rounded-2xl border p-3 text-left ${selectedReview?.id === review.id ? 'border-amber-300 bg-white' : 'border-amber-200 bg-white/80'}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-black text-gray-950">{review.participantName}</div>
                            <div className="truncate text-xs font-semibold text-gray-500">{review.guardianLabel || 'Guardian details unavailable'}</div>
                          </div>
                          <StatusPill value={review.status} />
                        </div>
                        <div className="mt-2 text-xs font-semibold text-gray-500">{review.selectedOptionLabel || 'No option selected'} · {review.paymentLabel}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {queue?.reviews.length ? queue.reviews.map((review) => (
                <button
                  key={review.id}
                  type="button"
                  onClick={() => setSelectedReviewId(review.id)}
                  className={`rounded-2xl border p-3 text-left ${selectedReview?.id === review.id ? 'border-primary-300 bg-primary-50' : 'border-gray-200 bg-white'}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-gray-950">{review.participantName}</div>
                      <div className="truncate text-xs font-semibold text-gray-500">{review.guardianLabel || 'Guardian details unavailable'}</div>
                    </div>
                    <StatusPill value={review.status} />
                  </div>
                  <div className="mt-2 text-xs font-semibold text-gray-500">{review.selectedOptionLabel || 'No option selected'} · {review.paymentLabel}</div>
                </button>
              )) : <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500">No applications are available for this form yet.</div>}
              {hasMore ? (
                <button type="button" className="secondary-button w-full text-xs" onClick={handleLoadMore} disabled={saving}>
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
                  Load more
                </button>
              ) : null}
            </div>
          </div>

          <div className="app-card p-4">
            {selectedReview ? (
              <div className="grid gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-black text-gray-950">{selectedReview.participantName}</h2>
                    <StatusPill value={selectedReview.status} />
                  </div>
                  <div className="mt-1 text-sm font-semibold text-gray-500">{selectedReview.selectedOptionLabel || 'No option selected'} · {selectedReview.paymentLabel}</div>
                </div>

                <DetailBlock title="Participant details" values={selectedReview.participant} />
                <DetailBlock title="Guardian details" values={selectedReview.guardian} />

                <div className="grid gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm font-semibold text-gray-700">
                  <div className="flex items-center justify-between gap-3"><span>Waiver accepted</span><span className="font-black text-gray-950">{selectedReview.waiverAccepted ? 'Yes' : 'No'}</span></div>
                  {selectedReviewOptionAvailability ? <div className="flex items-center justify-between gap-3"><span>Current capacity</span><span className="text-right font-black text-gray-950">{selectedReviewOptionAvailability}</span></div> : null}
                  {selectedReview.decisionNote ? <div className="flex items-start justify-between gap-3"><span>Decision note</span><span className="text-right font-black text-gray-950">{selectedReview.decisionNote}</span></div> : null}
                </div>

                {canApproveSelectedReview ? (
                  <label className="min-w-0">
                    <span className="app-label">Merge into existing roster player</span>
                    <select className="auth-input mt-1" aria-label="Merge into existing roster player" value={selectedMergePlayerId} onChange={(event) => setSelectedMergePlayerId(event.target.value)} disabled={saving}>
                      <option value="">Create a new roster player</option>
                      {(queue?.rosterPlayers || []).map((player) => <option key={player.id} value={player.id}>{player.number ? `#${player.number} ` : ''}{player.name}</option>)}</select>
                  </label>
                ) : null}

                <div className="grid gap-2 sm:grid-cols-2">
                  {canPromoteSelectedReview ? (
                    <button type="button" className="primary-button" onClick={handlePromote} disabled={saving}>
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                      Promote from waitlist
                    </button>
                  ) : canAcceptOfferSelectedReview ? (
                    <button type="button" className="primary-button" onClick={handleAcceptOffer} disabled={saving}>
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                      Mark accepted
                    </button>
                  ) : (
                    <button type="button" className="primary-button" onClick={handleApprove} disabled={saving || !canApproveSelectedReview}>
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <UserPlus className="h-4 w-4" aria-hidden="true" />}
                      Approve application
                    </button>
                  )}
                  <button type="button" className="secondary-button !border-rose-200 !text-rose-700 hover:!bg-rose-50" onClick={handleDecline} disabled={saving || !canDeclineSelectedReview}>
                    <XCircle className="h-4 w-4" aria-hidden="true" />
                    Decline application
                  </button>
                </div>
              </div>
            ) : <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500">Choose an application to review.</div>}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <section className="app-card overflow-hidden">
        <div className="flex items-center gap-3 px-3 py-3 sm:px-4">
          {!publicAccess ? (
            <Link to="/parent-tools/registrations" className="ghost-button !h-9 !min-h-9 !w-9 !flex-none !p-0" aria-label="Back to registrations" title="Back to registrations">
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="app-label">Registration</div>
            <h1 className="truncate text-xl font-black leading-tight text-gray-950">{form.programName}</h1>
            <p className="mt-0.5 truncate text-xs font-semibold text-gray-600">{form.teamName}{form.season ? ` - ${form.season}` : ''}</p>
          </div>
          {form.url ? (
            <button type="button" className="secondary-button !min-h-9 text-xs" onClick={() => openPublicUrl(form.url)}>
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Legacy form
            </button>
          ) : null}
        </div>
      </section>

      {message ? <Status tone="success" message={message} /> : null}
      {error ? <Status tone="error" message={error} /> : null}
      {placement ? <Status tone={placement.status === 'blocked' ? 'error' : 'success'} message={placement.status === 'waitlisted' ? 'This option is full. Submitting will add you to the waitlist.' : placement.status === 'pending' ? 'This option has capacity. Submitting creates a pending registration.' : placement.message || 'This option is not available.'} /> : null}

      {isPaymentSuccessReturn ? (
        <section className="app-card p-5">
          <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
            <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none" aria-hidden="true" />
            <div className="w-full">
              <h2 className="text-base font-black">Payment successful</h2>
              <p className="mt-1 text-sm font-semibold text-emerald-800">{successfulPaymentPlanSummary?.isInstallments ? 'Your installment payment was received. Here is what remains on your payment schedule.' : 'Your registration payment was received. The program organizer will follow up with next steps.'}</p>
              {successfulPaymentPlanSummary?.isInstallments ? (
                <div className="mt-3 rounded-xl border border-emerald-200 bg-white/70 p-3 text-sm text-emerald-950" aria-label="Remaining installment schedule">
                  <div className="flex items-center justify-between gap-3 text-sm font-black">
                    <span>Remaining balance</span>
                    <span>{formatMoney(successfulPaymentPlanSummary.remainingBalanceCents, successfulPaymentPlanSummary.currency)}</span>
                  </div>
                  <div className="mt-2 grid gap-2">
                    {successfulPaymentPlanSummary.remainingSchedule.length ? successfulPaymentPlanSummary.remainingSchedule.map((installment, index) => (
                      <div key={`${installment.label}-${index}`} className="flex items-center justify-between gap-3 text-xs font-semibold text-emerald-900">
                        <span>{installment.label}{installment.dueDate ? ` · Due ${formatDueDateLabel(installment.dueDate)}` : ''}</span>
                        <span>{formatMoney(installment.amountCents, successfulPaymentPlanSummary.currency)}</span>
                      </div>
                    )) : <div className="text-xs font-semibold text-emerald-900">No remaining installments.</div>}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {!isPaymentSuccessReturn ? <section className="app-card p-4">
        <form ref={formRef} className="grid gap-4" onSubmit={submit}>
          <FieldGroup title="Participant information" fields={form.participantFields || []} values={participant} errors={fieldErrors} prefix="participant" onChange={updateParticipant} disabled={saving} />
          <FieldGroup title="Guardian information" fields={form.guardianFields || []} values={guardian} errors={fieldErrors} prefix="guardian" onChange={updateGuardian} disabled={saving} />

          {showRegistrationOptionSelector ? (
            <fieldset className="grid gap-2">
              <legend className="text-sm font-black text-gray-950">Registration options</legend>
              <label className="min-w-0">
                <span className="app-label">Registration option</span>
                <select className="auth-input mt-1" data-selected-option value={selectedOptionId} onChange={(event) => setSelectedOptionId(event.target.value)} disabled={saving}>
                  <option value="">Select an option</option>
                  {activeOptions.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}</select>
              </label>
              {selectedOption ? <div className="text-xs font-semibold text-gray-500">{formatOptionAvailability(selectedOption, form.registrationOptionCounts || {})}</div> : null}
              {fieldErrors.selectedOption ? <InlineError message={fieldErrors.selectedOption} /> : null}
            </fieldset>
          ) : singleActiveOption ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3" aria-label="Selected registration option">
              <div className="app-label">Registration option</div>
              <div className="mt-1 text-sm font-black text-gray-950">{singleActiveOption.title}</div>
              <div className="mt-1 text-xs font-semibold text-gray-500">{formatOptionAvailability(singleActiveOption, form.registrationOptionCounts || {})}</div>
            </div>
          ) : null}

          {hasQuantityDiscount ? (
            <label className="min-w-0">
              <span className="app-label">Quantity</span>
              <input className="auth-input mt-1" data-quantity-field type="number" inputMode="numeric" enterKeyHint="next" min="1" value={quantity} onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))} disabled={saving} />
              {fieldErrors.quantity ? <InlineError message={fieldErrors.quantity} /> : null}
            </label>
          ) : null}

          {showPaymentPlanSelector ? (
            <label className="min-w-0">
              <span className="app-label">Payment plan</span>
              <select className="auth-input mt-1" data-payment-plan value={selectedPaymentPlanId} onChange={(event) => setSelectedPaymentPlanId(event.target.value)} disabled={saving}>
                {paymentPlanChoices.map((plan) => <option key={plan.id} value={plan.id}>{plan.title}</option>)}
              </select>
              {fieldErrors.paymentPlan ? <InlineError message={fieldErrors.paymentPlan} /> : null}
            </label>
          ) : null}

          {String(form.paymentNotice || '').trim() ? (
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950" aria-label="Registration payment notice">
              <h2 className="text-sm font-black text-sky-950">Payment</h2>
              <p className="mt-1 whitespace-pre-line font-semibold leading-5 text-sky-900">{form.paymentNotice}</p>
            </div>
          ) : null}

          {selectedPaymentPlanSummary?.isInstallments ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" aria-label="Installment payment summary">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-black">Amount due now</h2>
                  <p className="mt-1 text-xs font-semibold text-amber-900">Pay the first installment now. The rest of the schedule stays due on the dates below.</p>
                </div>
                <div className="text-right">
                  <div className="text-lg font-black tabular-nums">{formatMoney(selectedPaymentPlanSummary.currentInstallment?.amountCents || 0, selectedPaymentPlanSummary.currency)}</div>
                  {selectedPaymentPlanSummary.currentInstallment?.dueDate ? <div className="text-xs font-semibold text-amber-900">Due {formatDueDateLabel(selectedPaymentPlanSummary.currentInstallment.dueDate)}</div> : null}
                </div>
              </div>
              <div className="mt-3 grid gap-2">
                <div className="text-xs font-black uppercase tracking-wide text-amber-700">Remaining schedule</div>
                {selectedPaymentPlanSummary.remainingSchedule.map((installment, index) => (
                  <div key={`${installment.label}-${index}`} className="flex items-center justify-between gap-3 text-xs font-semibold text-amber-900">
                    <span>{installment.label}{installment.dueDate ? ` · Due ${formatDueDateLabel(installment.dueDate)}` : ''}</span>
                    <span>{formatMoney(installment.amountCents, selectedPaymentPlanSummary.currency)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {form.waiverText ? (
            <div className="space-y-2">
              <h2 className="text-sm font-black text-gray-950">Waiver</h2>
              <div className="max-h-36 overflow-y-auto rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs font-semibold leading-5 text-gray-600">{form.waiverText}</div>
              <label className="flex items-start gap-2 text-sm font-semibold text-gray-700">
                <input type="checkbox" className="mt-1" data-waiver-field checked={waiverAccepted} onChange={(event) => setWaiverAccepted(event.target.checked)} disabled={saving} />
                <span>I accept the waiver.</span>
              </label>
              {fieldErrors.waiver ? <InlineError message={fieldErrors.waiver} /> : null}
            </div>
          ) : null}

          {displayFeeSnapshot ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-900" aria-label="Registration fee summary">
              <div className="mb-2 text-xs font-black uppercase tracking-wide text-gray-500">Fee summary</div>
              <div className="grid gap-1.5">
                {displayFeeLines.map((line, index) => (
                  <div key={`${line.label}-${index}`} className={`flex items-center justify-between gap-3 ${line.strong ? 'border-t border-gray-200 pt-2 text-base font-black text-gray-950' : 'font-semibold text-gray-700'}`}>
                    <span>{line.label}</span>
                    <span className="tabular-nums">{formatMoney(line.amountCents, displayFeeSnapshot.currency || form.currency)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <button type="button" className="primary-button" onClick={submit} disabled={saving || Boolean(message)}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            {saving ? (form.onlineCheckout ? 'Opening checkout...' : 'Submitting registration...') : (form.onlineCheckout ? (isRetryPaymentMode ? 'Retry payment with Stripe' : 'Pay registration with Stripe') : 'Submit registration')}
          </button>
        </form>
      </section> : null}
    </div>
  );
}

function createCheckoutAttemptToken() {
  const bytes = new Uint8Array(16);
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Crypto API not available. Cannot generate secure checkout token.');
  }
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalizeRegistrationReturnStatus(value: string | null) {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'success' || status === 'cancelled') return status;
  return '';
}

function getTotalWaitlistedCount(registrationOptionCounts: Record<string, any> | undefined, fallback = 0) {
  const total = Object.values(registrationOptionCounts || {}).reduce((sum, counts) => {
    const nextCount = Number((counts as Record<string, any>)?.waitlisted || 0);
    return sum + (Number.isFinite(nextCount) ? nextCount : 0);
  }, 0);
  return total > 0 ? total : fallback;
}

function collectFieldValues(formElement: HTMLFormElement | null, group: string, fallback: Record<string, string>) {
  const values = { ...fallback };
  formElement?.querySelectorAll(`[data-field-group="${group}"]`).forEach((field) => {
    const input = field as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const fieldId = input.getAttribute('data-field-id');
    if (fieldId) values[fieldId] = input.value;
  });
  return values;
}

function validate(form: ParentRegistrationCard, participant: Record<string, string>, guardian: Record<string, string>, waiverAccepted: boolean, selectedOptionId: string, quantity: number, selectedPaymentPlanId: string, hasQuantityDiscount: boolean) {
  const errors: FieldErrors = {};
  (form.participantFields || []).forEach((field: any) => {
    if (field.required && !String(participant[field.id] || '').trim()) errors[`participant.${field.id}`] = `${field.label} is required.`;
  });
  (form.guardianFields || []).forEach((field: any) => {
    if (field.required && !String(guardian[field.id] || '').trim()) errors[`guardian.${field.id}`] = `${field.label} is required.`;
  });
  if (requiresRegistrationOption(form) && !selectedOptionId) errors.selectedOption = 'Select a registration option.';
  // If quantity discount is not active, quantity is implicitly 1, so no validation needed here
  if (hasQuantityDiscount && (!Number.isFinite(quantity) || quantity < 1)) errors.quantity = 'Quantity must be at least 1.'; // Only validate if the field is visible
  if (!selectedPaymentPlanId) errors.paymentPlan = 'Select a payment plan.';
  if (form.waiverText && !waiverAccepted) errors.waiver = 'Accept the waiver to submit.';
  return errors;
}

async function loadRegistrationForm(user: any, teamId: string, formId: string, publicAccess = false, staffReview = false): Promise<ParentRegistrationCard | null> {
  if (staffReview) {
    const detail: ParentRegistrationDetailModel = await (parentToolsService as any).loadStaffRegistrationDetail(user, teamId, formId);
    return toRegistrationCardFromDetail(detail, teamId, formId);
  }
  if (publicAccess) {
    const detail: ParentRegistrationDetailModel = await (parentToolsService as any).loadPublicRegistrationDetail(teamId, formId);
    return toRegistrationCardFromDetail(detail, teamId, formId);
  }

  try {
    const loadDetail = (parentToolsService as any).loadParentRegistrationDetail;
    if (typeof loadDetail === 'function') {
      const detail: ParentRegistrationDetailModel = await loadDetail(user, teamId, formId);
      return toRegistrationCardFromDetail(detail, teamId, formId);
    }
  } catch (error: any) {
    if (!String(error?.message || '').includes('loadParentRegistrationDetail')) throw error;
  }

  const forms = await parentToolsService.loadParentRegistrations(user);
  return forms.find((candidate: ParentRegistrationCard) => candidate.teamId === teamId && candidate.id === formId) || null;
}

function toRegistrationCardFromDetail(detail: ParentRegistrationDetailModel, teamId: string, formId: string): ParentRegistrationCard {
  return {
    ...detail.form,
    id: formId,
    teamId,
    teamName: detail.teamName,
    programName: detail.form.programName || 'Registration',
    description: detail.form.description || '',
    season: detail.form.season || '',
    currency: detail.form.currency || 'USD',
    feeAmountCents: detail.form.feeAmountCents ?? detail.feeSnapshot?.originalFeeAmountCents ?? detail.feeSnapshot?.finalAmountDueCents ?? 0,
    feeLabel: detail.feeSnapshot?.finalAmountDueCents ? formatMoney(detail.feeSnapshot.finalAmountDueCents, detail.form.currency) : '',
    paymentNotice: detail.paymentNotice || '',
    onlineCheckout: detail.onlineCheckout,
    url: detail.legacyUrl,
    options: detail.options || detail.form.options || [],
    registrationOptionCounts: detail.form.registrationOptionCounts || {},
    feeSnapshot: detail.feeSnapshot,
    paymentPlans: detail.paymentPlans || [],
    isPublished: detail.isPublished,
    allowOnlineCheckoutReview: true
  };
}

function FieldGroup({ title, fields, values, errors, prefix, onChange, disabled }: { title: string; fields: any[]; values: Record<string, string>; errors: FieldErrors; prefix: string; onChange: (fieldId: string, value: string) => void; disabled: boolean }) {
  if (!fields.length) return null;
  return (
    <div className="grid gap-3">
      <h2 className="text-sm font-black text-gray-950">{title}</h2>
      {fields.map((field) => {
        const errorKey = `${prefix}.${field.id}`;
        return (
          <label key={field.id} htmlFor={`${prefix}-${field.id}`} className="min-w-0">
            <span className="app-label">{field.label}{field.required ? ' *' : ''}</span>
            {field.type === 'textarea' ? (
              <textarea id={`${prefix}-${field.id}`} className="auth-input mt-1 min-h-24" data-field-group={prefix} data-field-id={field.id} value={values[field.id] || ''} onChange={(event) => onChange(field.id, event.target.value)} disabled={disabled} enterKeyHint="next" />
            ) : field.type === 'select' ? (
              <select id={`${prefix}-${field.id}`} className="auth-input mt-1" data-field-group={prefix} data-field-id={field.id} value={values[field.id] || ''} onChange={(event) => onChange(field.id, event.target.value)} disabled={disabled}>
                <option value="">Select</option>
                {(field.options || []).map((option: string) => <option key={option} value={option}>{option}</option>)}
              </select>
            ) : (
              <input id={`${prefix}-${field.id}`} className="auth-input mt-1" data-field-group={prefix} data-field-id={field.id} type={field.type || 'text'} {...getFieldInputHints(field.type)} value={values[field.id] || ''} onChange={(event) => onChange(field.id, event.target.value)} disabled={disabled} />
            )}
            {errors[errorKey] ? <InlineError message={errors[errorKey]} /> : null}
          </label>
        );
      })}
    </div>
  );
}

function getFieldInputHints(type?: string): FieldInputHints {
  if (type === 'email') return { inputMode: 'email', autoComplete: 'email', enterKeyHint: 'next' };
  if (type === 'tel') return { inputMode: 'tel', autoComplete: 'tel', enterKeyHint: 'next' };
  if (type === 'number') return { inputMode: 'numeric', enterKeyHint: 'next' };
  return { enterKeyHint: 'next' };
}

function InlineError({ message }: { message: string }) {
  return <div className="mt-1 text-xs font-bold text-rose-700">{message}</div>;
}

function Status({ tone, message }: { tone: 'error' | 'success'; message: string }) {
  const Icon = tone === 'error' ? AlertCircle : CheckCircle2;
  return (
    <div className={`flex items-start gap-2 rounded-xl border p-3 text-sm font-semibold ${tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
      <Icon className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <section className="app-card p-6 text-center">
      <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary-600" aria-hidden="true" />
      <div className="mt-3 text-sm font-black text-gray-900">{label}</div>
    </section>
  );
}

function EmptyState({ icon: Icon, title, detail, actionLabel, onAction }: { icon: LucideIcon; title: string; detail: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div className="app-card p-5 text-center">
      <Icon className="mx-auto h-8 w-8 text-gray-400" aria-hidden="true" />
      <div className="mt-3 text-sm font-black text-gray-950">{title}</div>
      <div className="mt-1 text-xs font-semibold text-gray-500">{detail}</div>
      {actionLabel && onAction ? <button type="button" className="secondary-button mx-auto mt-3 text-xs" onClick={onAction}>{actionLabel}</button> : null}
    </div>
  );
}

function formatOptionAvailability(option: any, counts: Record<string, any>) {
  const count = counts[option.countKey || option.id] || {};
  const capacity = Number(option.capacityLimit || option.capacity || 0);
  const enrolled = Number(count.enrolled || 0);
  if (!capacity) return option.description || 'Registration option available';
  const remaining = Math.max(0, capacity - enrolled);
  return `${remaining} ${remaining === 1 ? 'spot' : 'spots'} left`;
}

function normalizePaymentPlanId(value: string | null) {
  return String(value || '').trim() === 'installments' ? 'installments' : 'pay_full';
}

function normalizePaidInstallmentCount(value: string | null) {
  return Math.max(0, Math.floor(Number(value || 0) || 0));
}

function buildRegistrationPaymentPlanSummary(form: ParentRegistrationCard, feeSnapshot: Record<string, any>, paymentPlanId: string, paidInstallmentCount = 0) {
  const totalBalanceDueCents = Math.max(0, Math.round(Number(feeSnapshot?.finalAmountDueCents ?? form.feeAmountCents ?? 0) || 0));
  const currency = String(feeSnapshot?.currency || form.currency || 'USD');
  const useInstallments = paymentPlanId === 'installments' && form.installmentPlan?.enabled === true;
  if (!useInstallments) {
    return {
      isInstallments: false,
      currency,
      totalBalanceDueCents,
      currentInstallment: null,
      remainingSchedule: [],
      remainingBalanceCents: 0
    };
  }

  const count = Math.max(2, Math.min(12, Math.floor(Number(form.installmentPlan?.installmentCount) || 2)));
  const baseAmount = Math.floor(totalBalanceDueCents / count);
  const remainder = totalBalanceDueCents - (baseAmount * count);
  const firstDueDate = parseLocalDate(form.installmentPlan?.firstDueDate);
  const intervalDays = Math.max(1, Math.floor(Number(form.installmentPlan?.intervalDays) || 30));
  const schedule = Array.from({ length: count }, (_, index) => {
    const dueDate = firstDueDate ? addDays(firstDueDate, intervalDays * index) : null;
    return {
      label: `Installment ${index + 1}`,
      dueDate: dueDate ? dueDate.toISOString().slice(0, 10) : String(form.installmentPlan?.firstDueDate || ''),
      amountCents: baseAmount + (index === count - 1 ? remainder : 0)
    };
  });
  const safePaidInstallmentCount = Math.min(schedule.length, Math.max(0, Math.floor(Number(paidInstallmentCount) || 0)));
  const currentInstallment = schedule[safePaidInstallmentCount] || null;
  const remainingSchedule = schedule.slice(safePaidInstallmentCount === 0 ? 1 : safePaidInstallmentCount);
  const remainingBalanceCents = remainingSchedule.reduce((sum, installment) => sum + Math.max(0, Number(installment.amountCents || 0)), 0);
  return {
    isInstallments: true,
    currency,
    totalBalanceDueCents,
    currentInstallment,
    remainingSchedule,
    remainingBalanceCents
  };
}

function parseLocalDate(value: unknown) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function addDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatDueDateLabel(value: string) {
  const date = parseLocalDate(value);
  if (!date) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function formatMoney(cents: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format((Number(cents) || 0) / 100);
}

function StatusPill({ value }: { value: string }) {
  const status = String(value || 'pending').trim().toLowerCase();
  const label = status.replace(/-/g, ' ');
  const className = status === 'approved'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : status === 'declined' || status === 'rejected'
      ? 'border-rose-200 bg-rose-50 text-rose-700'
      : status === 'waitlisted' || status === 'offer-extended' || status === 'offer-accepted'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-sky-200 bg-sky-50 text-sky-700';
  return <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-black uppercase tracking-wide ${className}`}>{label}</span>;
}

function DetailBlock({ title, values }: { title: string; values: Record<string, any> }) {
  const entries = Object.entries(values || {}).filter(([, value]) => String(value ?? '').trim());
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
      <div className="text-sm font-black text-gray-950">{title}</div>
      <div className="mt-3 grid gap-2">
        {entries.length ? entries.map(([key, value]) => (
          <div key={key} className="flex items-start justify-between gap-3 text-sm font-semibold text-gray-700">
            <span className="text-gray-500">{formatReviewFieldLabel(key)}</span>
            <span className="text-right font-black text-gray-950">{String(value)}</span>
          </div>
        )) : <div className="text-sm font-semibold text-gray-500">No submitted values.</div>}
      </div>
    </div>
  );
}

function formatReviewFieldLabel(value: string) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}
