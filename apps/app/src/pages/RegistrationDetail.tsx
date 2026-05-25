import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import * as parentToolsService from '../lib/parentToolsService';
import { AlertCircle, CheckCircle2, ChevronLeft, ExternalLink, Loader2, Send, Ticket, type LucideIcon } from 'lucide-react';
import { openPublicUrl } from '../lib/publicActions';
import type { ParentRegistrationCard, ParentRegistrationDetailModel } from '../lib/parentToolsService';
import {
  calculateRegistrationFeeSnapshot,
  decideRegistrationPlacement,
  getActiveRegistrationOptions,
  getPaymentPlanChoices,
  requiresRegistrationOption
} from '../../../../js/registration-flow.js';
import type { AuthState } from '../lib/types';

type FieldErrors = Record<string, string>;

export function RegistrationDetail({ auth }: { auth: AuthState }) {
  const { teamId = '', formId = '' } = useParams();
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

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      setLoading(true);
      setError('');
      setMessage('');
      try {
        const nextForm = await loadRegistrationForm(auth.user, teamId, formId);
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
        setSelectedOptionId((current) => current || initialOptions[0]?.id || '');
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
  }, [auth.user?.uid, teamId, formId, reloadKey]);

  const activeOptions: any[] = useMemo(() => form ? ((Array.isArray(form.options) && form.options.length) ? form.options : getActiveRegistrationOptions(form, form.registrationOptionCounts || {})) : [], [form]);
  const paymentPlanChoices: any[] = useMemo(() => form ? (form.paymentPlans || getPaymentPlanChoices(form)) : [], [form]);
  const selectedOption = activeOptions.find((option) => option.id === selectedOptionId) || null;
  const placement = useMemo(() => {
    if (!form || !requiresRegistrationOption(form) || !selectedOptionId) return null;
    return decideRegistrationPlacement({ form, selectedOptionId, counts: form.registrationOptionCounts || {} });
  }, [form, selectedOptionId]);
  const feeSnapshot = useMemo(() => form ? (form.feeSnapshot || calculateRegistrationFeeSnapshot(form, { quantity, now: new Date() })) : null, [form, quantity]);

  const updateParticipant = (fieldId: string, value: string) => setParticipant((current) => ({ ...current, [fieldId]: value }));
  const updateGuardian = (fieldId: string, value: string) => setGuardian((current) => ({ ...current, [fieldId]: value }));

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    if (!form || saving) return;

    const currentParticipant = collectFieldValues(formRef.current, 'participant', participant);
    const currentGuardian = collectFieldValues(formRef.current, 'guardian', guardian);
    const currentWaiverAccepted = Boolean((formRef.current?.querySelector('[data-waiver-field]') as HTMLInputElement | null)?.checked ?? waiverAccepted);
    const currentSelectedOptionId = String((formRef.current?.querySelector('[data-selected-option]') as HTMLSelectElement | null)?.value || selectedOptionId);
    const currentQuantity = Math.max(1, Number((formRef.current?.querySelector('[data-quantity-field]') as HTMLInputElement | null)?.value || quantity) || 1);
    const currentSelectedPaymentPlanId = String((formRef.current?.querySelector('[data-payment-plan]') as HTMLSelectElement | null)?.value || selectedPaymentPlanId);
    const currentSelectedOption = activeOptions.find((option) => option.id === currentSelectedOptionId) || selectedOption;
    const currentPlacement = placement;
    setParticipant(currentParticipant);
    setGuardian(currentGuardian);
    setWaiverAccepted(currentWaiverAccepted);
    setSelectedOptionId(currentSelectedOptionId);
    setQuantity(currentQuantity);
    setSelectedPaymentPlanId(currentSelectedPaymentPlanId);

    const nextErrors = validate(form, currentParticipant, currentGuardian, currentWaiverAccepted, currentSelectedOptionId, currentQuantity, currentSelectedPaymentPlanId);
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
      const currentFeeSnapshot = calculateRegistrationFeeSnapshot(form, { quantity: currentQuantity, now: new Date() });
      const result = await parentToolsService.submitOfflineRegistration(form.teamId, form.id, {
        participant: currentParticipant,
        guardian: currentGuardian,
        waiverAccepted: currentWaiverAccepted,
        selectedOption: currentSelectedOption,
        selectedOptionId: currentSelectedOptionId,
        selectedPaymentPlanId: currentSelectedPaymentPlanId,
        quantity: currentQuantity,
        feeSnapshot: currentFeeSnapshot
      });
      if (result.status === 'waitlisted') {
        setMessage('Registration submitted. You have been added to the waitlist.');
        return;
      }
      if (form.onlineCheckout && Number(currentFeeSnapshot.finalAmountDueCents || 0) > 0) {
        const checkout = await parentToolsService.initiateRegistrationCheckout(
          form.teamId,
          form.id,
          result.registrationId,
          currentSelectedOptionId,
          currentSelectedPaymentPlanId,
          currentQuantity,
          currentFeeSnapshot.finalAmountDueCents,
          currentFeeSnapshot.currency || form.currency || 'USD'
        );
        await openPublicUrl(checkout.checkoutUrl);
        setMessage('Registration submitted. Opening Stripe checkout.');
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
          <Link to="/parent-tools/registrations" className="ghost-button !h-9 !min-h-9 !w-9 !flex-none !p-0" aria-label="Back to registrations" title="Back to registrations">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
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

          <label className="min-w-0">
            <span className="app-label">Quantity</span>
            <input className="auth-input mt-1" data-quantity-field type="number" min="1" value={quantity} onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))} disabled={saving} />
            {fieldErrors.quantity ? <InlineError message={fieldErrors.quantity} /> : null}
          </label>

          <label className="min-w-0">
            <span className="app-label">Payment plan</span>
            <select className="auth-input mt-1" data-payment-plan value={selectedPaymentPlanId} onChange={(event) => setSelectedPaymentPlanId(event.target.value)} disabled={saving}>
              {paymentPlanChoices.map((plan) => <option key={plan.id} value={plan.id}>{plan.title}</option>)}
            </select>
            {fieldErrors.paymentPlan ? <InlineError message={fieldErrors.paymentPlan} /> : null}
          </label>

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

          {feeSnapshot ? <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm font-black text-gray-900">Total due: {formatMoney(feeSnapshot.finalAmountDueCents, form.currency)}</div> : null}

          <button type="button" className="primary-button" onClick={submit} disabled={saving || Boolean(message)}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            {saving ? (form.onlineCheckout ? 'Opening checkout...' : 'Submitting registration...') : (form.onlineCheckout ? 'Pay registration with Stripe' : 'Submit registration')}
          </button>
        </form>
      </section>
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

function validate(form: ParentRegistrationCard, participant: Record<string, string>, guardian: Record<string, string>, waiverAccepted: boolean, selectedOptionId: string, quantity: number, selectedPaymentPlanId: string) {
  const errors: FieldErrors = {};
  (form.participantFields || []).forEach((field: any) => {
    if (field.required && !String(participant[field.id] || '').trim()) errors[`participant.${field.id}`] = `${field.label} is required.`;
  });
  (form.guardianFields || []).forEach((field: any) => {
    if (field.required && !String(guardian[field.id] || '').trim()) errors[`guardian.${field.id}`] = `${field.label} is required.`;
  });
  if (requiresRegistrationOption(form) && !selectedOptionId) errors.selectedOption = 'Select a registration option.';
  if (!Number.isFinite(quantity) || quantity < 1) errors.quantity = 'Quantity must be at least 1.';
  if (!selectedPaymentPlanId) errors.paymentPlan = 'Select a payment plan.';
  if (form.waiverText && !waiverAccepted) errors.waiver = 'Accept the waiver to submit.';
  return errors;
}

async function loadRegistrationForm(user: any, teamId: string, formId: string): Promise<ParentRegistrationCard | null> {
  try {
    const loadDetail = (parentToolsService as any).loadParentRegistrationDetail;
    if (typeof loadDetail === 'function') {
      const detail: ParentRegistrationDetailModel = await loadDetail(user, teamId, formId);
      return {
        ...detail.form,
        id: formId,
        teamId,
        teamName: detail.teamName,
        programName: detail.form.programName || 'Registration',
        description: detail.form.description || '',
        season: detail.form.season || '',
        currency: detail.form.currency || 'USD',
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
  } catch (error: any) {
    if (!String(error?.message || '').includes('loadParentRegistrationDetail')) throw error;
  }

  const forms = await parentToolsService.loadParentRegistrations(user);
  return forms.find((candidate: ParentRegistrationCard) => candidate.teamId === teamId && candidate.id === formId) || null;
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
