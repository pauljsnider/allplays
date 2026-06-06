import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import * as parentToolsService from '../lib/parentToolsService';
import { AlertCircle, CheckCircle2, ChevronLeft, ExternalLink, Loader2, Send, Ticket, type LucideIcon } from 'lucide-react';
import { openPublicUrl } from '../lib/publicActions';
import type { ParentRegistrationCard, ParentRegistrationDetailModel, RegistrationDiscountRule } from '../lib/parentToolsService';
import {
  calculateRegistrationFeeSnapshot,
  decideRegistrationPlacement,
  formatFeeSnapshotLines,
  getActiveRegistrationOptions,
  getPaymentPlanChoices,
  requiresRegistrationOption,
  hasQuantityDiscountRule
} from '../../../../js/registration-flow.js';
import type { AuthState } from '../lib/types';

type FieldErrors = Record<string, string>;
type FeeSummaryLine = { label: string; amountCents: number; strong?: boolean };

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
  const params = useParams();
  const [searchParams] = useSearchParams();
  const teamId = publicAccess ? (searchParams.get('teamId') || '') : (params.teamId || '');
  const formId = publicAccess ? (searchParams.get('formId') || '') : (params.formId || '');
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
  const [reloadKey, setReloadKey] = useState(0);
  const formRef = useRef<HTMLFormElement | null>(null);
  const releaseAttemptRef = useRef('');
  const retryRegistrationId = String(searchParams.get('registrationId') || '').trim();
  const retryCheckoutAttemptToken = String(searchParams.get('checkoutAttemptToken') || '').trim();
  const stripeReturnStatus = String(searchParams.get('status') || '').trim().toLowerCase();
  const retryPaymentRequested = searchParams.get('retryPayment') === '1' && Boolean(retryRegistrationId);
  const retryCheckoutReady = Boolean(retryRegistrationId) && (retryPaymentRequested || stripeReturnStatus === 'cancelled');
  const stripeSuccessReturn = Boolean(retryRegistrationId) && stripeReturnStatus === 'success';
  const stripeCancelledReturn = Boolean(retryRegistrationId) && stripeReturnStatus === 'cancelled';

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      setLoading(true);
      setError('');
      setMessage('');
      try {
        const nextForm = await loadRegistrationForm(auth.user, teamId, formId, publicAccess);
        if (cancelled) return;
        if (!nextForm) {
          setError('Registration form not found or not active.');
          setForm(null);
          return;
        }
        if (nextForm.isPublished === false) {
          setError('This linked registration form is not published right now.');
          setForm(null);
          return;
        }
        setForm(nextForm);
        const initialOptions = (Array.isArray(nextForm.options) && nextForm.options.length) ? nextForm.options : getActiveRegistrationOptions(nextForm, nextForm.registrationOptionCounts || {});
        const initialOptionId = selectInitialRegistrationOption(nextForm, initialOptions);
        setSelectedOptionId((current) => current || initialOptionId);
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
  }, [auth.user?.uid, teamId, formId, publicAccess, reloadKey]);

  useEffect(() => {
    if (!stripeCancelledReturn) return;
    const releaseKey = `${teamId}:${formId}:${retryRegistrationId}:${retryCheckoutAttemptToken}`;
    if (!teamId || !formId || releaseAttemptRef.current === releaseKey) return;
    releaseAttemptRef.current = releaseKey;
    void Promise.resolve(parentToolsService.releaseCancelledRegistrationCheckout(
      teamId,
      formId,
      retryRegistrationId,
      retryCheckoutAttemptToken
    )).catch(() => undefined);
  }, [teamId, formId, retryRegistrationId, retryCheckoutAttemptToken, stripeCancelledReturn]);

  const activeOptions: any[] = useMemo(() => form ? ((Array.isArray(form.options) && form.options.length) ? form.options : getActiveRegistrationOptions(form, form.registrationOptionCounts || {})) : [], [form]);
  const paymentPlanChoices: any[] = useMemo(() => form ? ((Array.isArray(form.paymentPlans) && form.paymentPlans.length) ? form.paymentPlans : getPaymentPlanChoices(form)) : [], [form]);
  const showPaymentPlanSelector = paymentPlanChoices.length > 1;
  const selectedOption = activeOptions.find((option) => option.id === selectedOptionId) || null;
  const placement = useMemo(() => {
    if (!form || !requiresRegistrationOption(form) || !selectedOptionId) return null;
    return decideRegistrationPlacement({ form, selectedOptionId, counts: form.registrationOptionCounts || {} });
  }, [form, selectedOptionId]);
  const hasQuantityDiscount = useMemo(() => form ? hasQuantityDiscountRule(form.discountRules) : false, [form]);
  const effectiveQuantity = useMemo(() => hasQuantityDiscount ? quantity : 1, [hasQuantityDiscount, quantity]);
  const displayFeeSnapshot = useMemo(() => form ? calculateRegistrationFeeSnapshot(form, { quantity: effectiveQuantity, now: new Date() }) : null, [form, effectiveQuantity]);
  const displayFeeLines = useMemo<FeeSummaryLine[]>(() => displayFeeSnapshot ? formatFeeSnapshotLines(displayFeeSnapshot) : [], [displayFeeSnapshot]);

  const updateParticipant = (fieldId: string, value: string) => setParticipant((current) => ({ ...current, [fieldId]: value }));
  const updateGuardian = (fieldId: string, value: string) => setGuardian((current) => ({ ...current, [fieldId]: value }));

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    if (!form || saving) return;

    const currentParticipant = collectFieldValues(formRef.current, 'participant', participant);
    const currentGuardian = collectFieldValues(formRef.current, 'guardian', guardian);
    const currentWaiverAccepted = Boolean((formRef.current?.querySelector('[data-waiver-field]') as HTMLInputElement | null)?.checked ?? waiverAccepted);
    const currentSelectedOptionId = String((formRef.current?.querySelector('[data-selected-option]') as HTMLSelectElement | null)?.value || selectedOptionId);
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
      if (retryCheckoutReady) {
        if (!retryCheckoutAttemptToken) {
          setError('This payment retry link is missing its secure checkout token. Please use the latest payment link from the organizer.');
          return;
        }
        const checkout = await parentToolsService.retryRegistrationCheckout(
          form.teamId,
          form.id,
          retryRegistrationId,
          retryCheckoutAttemptToken
        );
        await openPublicUrl(checkout.checkoutUrl);
        setMessage('Opening Stripe checkout for your existing registration.');
        return;
      }

      const currentFeeSnapshot = calculateRegistrationFeeSnapshot(form, { quantity: currentQuantity, now: new Date() }); // currentQuantity is already effective
      const checkoutAttemptToken = form.onlineCheckout ? createCheckoutAttemptToken() : '';
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
            { checkoutAttemptToken, returnToApp: publicAccess }
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

  if (loading) return <LoadingBlock label="Loading registration" />;
  if (!form) return <EmptyState icon={Ticket} title="Registration unavailable" detail={error || 'This registration form could not be loaded.'} actionLabel={error ? 'Retry' : ''} onAction={error ? () => setReloadKey((current) => current + 1) : undefined} />;

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
      {stripeCancelledReturn ? <Status tone="error" message="Stripe payment was canceled. You can retry payment for your existing registration." /> : null}
      {error ? <Status tone="error" message={error} /> : null}
      {placement ? <Status tone={placement.status === 'blocked' ? 'error' : 'success'} message={placement.status === 'waitlisted' ? 'This option is full. Submitting will add you to the waitlist.' : placement.status === 'pending' ? 'This option has capacity. Submitting creates a pending registration.' : placement.message || 'This option is not available.'} /> : null}

      {stripeSuccessReturn ? (
        <section className="app-card p-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-emerald-600" aria-hidden="true" />
            <div>
              <h2 className="text-base font-black text-gray-950">Payment successful</h2>
              <p className="mt-1 text-sm font-semibold leading-6 text-gray-600">Your registration payment was received. The program organizer will follow up with next steps.</p>
            </div>
          </div>
        </section>
      ) : (
      <section className="app-card p-4">
        <form ref={formRef} className="grid gap-4" onSubmit={submit}>
          <FieldGroup title="Participant information" fields={form.participantFields || []} values={participant} errors={fieldErrors} prefix="participant" onChange={updateParticipant} disabled={saving} />
          <FieldGroup title="Guardian information" fields={form.guardianFields || []} values={guardian} errors={fieldErrors} prefix="guardian" onChange={updateGuardian} disabled={saving} />

          {activeOptions.length ? (
            <fieldset className="grid gap-2">
              <legend className="text-sm font-black text-gray-950">Registration options</legend>
              <label className="min-w-0">
                <span className="app-label">Registration option</span>
                <select className="auth-input mt-1" data-selected-option value={selectedOptionId} onChange={(event) => setSelectedOptionId(event.target.value)} disabled={saving}>
                  <option value="">Select an option</option>
                  {activeOptions.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}
                </select>
              </label>
              {selectedOption ? <div className="text-xs font-semibold text-gray-500">{formatOptionAvailability(selectedOption, form.registrationOptionCounts || {})}</div> : null}
              {fieldErrors.selectedOption ? <InlineError message={fieldErrors.selectedOption} /> : null}
            </fieldset>
          ) : null}

          {hasQuantityDiscount ? (
            <label className="min-w-0">
              <span className="app-label">Quantity</span>
              <input className="auth-input mt-1" data-quantity-field type="number" min="1" value={quantity} onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))} disabled={saving} />
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
            {saving ? (form.onlineCheckout ? 'Opening checkout...' : 'Submitting registration...') : retryCheckoutReady ? 'Retry payment with Stripe' : (form.onlineCheckout ? 'Pay registration with Stripe' : 'Submit registration')}
          </button>
        </form>
      </section>
      )}
    </div>
  );
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

function createCheckoutAttemptToken() {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 18)}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
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

async function loadRegistrationForm(user: any, teamId: string, formId: string, publicAccess = false): Promise<ParentRegistrationCard | null> {
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
              <textarea id={`${prefix}-${field.id}`} className="auth-input mt-1 min-h-24" data-field-group={prefix} data-field-id={field.id} value={values[field.id] || ''} onChange={(event) => onChange(field.id, event.target.value)} disabled={disabled} />
            ) : field.type === 'select' ? (
              <select id={`${prefix}-${field.id}`} className="auth-input mt-1" data-field-group={prefix} data-field-id={field.id} value={values[field.id] || ''} onChange={(event) => onChange(field.id, event.target.value)} disabled={disabled}>
                <option value="">Select</option>
                {(field.options || []).map((option: string) => <option key={option} value={option}>{option}</option>)}
              </select>
            ) : (
              <input id={`${prefix}-${field.id}`} className="auth-input mt-1" data-field-group={prefix} data-field-id={field.id} type={field.type || 'text'} value={values[field.id] || ''} onChange={(event) => onChange(field.id, event.target.value)} disabled={disabled} />
            )}
            {errors[errorKey] ? <InlineError message={errors[errorKey]} /> : null}
          </label>
        );
      })}
    </div>
  );
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

function formatMoney(cents: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format((Number(cents) || 0) / 100);
}
