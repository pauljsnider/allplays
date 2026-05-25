import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertCircle, ChevronLeft, ExternalLink, Loader2, RefreshCw, Ticket } from 'lucide-react';
import { openPublicUrl } from '../lib/publicActions';
import { loadParentRegistrationDetail, type ParentRegistrationDetailModel } from '../lib/parentToolsService';
import type { AuthState } from '../lib/types';

export function RegistrationDetail({ auth }: { auth: AuthState }) {
  const { teamId = '', formId = '' } = useParams();
  const [model, setModel] = useState<ParentRegistrationDetailModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      setModel(await loadParentRegistrationDetail(auth.user, teamId, formId));
    } catch (loadError: any) {
      setModel(null);
      setError(loadError?.message || 'Unable to load this registration.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid, teamId, formId]);

  const quantity = 1;
  const feeLabel = useMemo(() => model ? formatMoney(model.feeSnapshot.finalAmountDueCents, model.form.currency) : '', [model]);

  return (
    <div className="space-y-3">
      <section className="app-card overflow-hidden">
        <div className="flex items-center gap-3 px-3 py-3 sm:px-4">
          <Link to="/parent-tools/registrations" className="ghost-button !h-9 !min-h-9 !w-9 !flex-none !p-0" aria-label="Back to registrations" title="Back to registrations">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="app-label">Registration review</div>
            <h1 className="truncate text-xl font-black leading-tight text-gray-950">{model?.form.programName || 'Registration'}</h1>
            <p className="mt-0.5 truncate text-xs font-semibold text-gray-600">{model?.teamName || 'Review linked team registration details before submitting.'}</p>
          </div>
          {model ? (
            <button type="button" className="secondary-button !min-h-9 text-xs" onClick={() => openPublicUrl(model.legacyUrl)}>
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Legacy form
            </button>
          ) : null}
        </div>
      </section>

      {loading ? <LoadingBlock label="Loading registration" /> : null}
      {!loading && error ? <ErrorBlock message={error} onRetry={refresh} /> : null}
      {!loading && !error && model && !model.isPublished ? <UnavailableBlock legacyUrl={model.legacyUrl} onRetry={refresh} /> : null}

      {!loading && !error && model?.isPublished ? (
        <div className="space-y-3">
          <section className="app-card p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                <Ticket className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-black text-gray-950">{model.form.programName}</div>
                <div className="mt-0.5 text-xs font-semibold text-gray-500">{model.teamName}{model.form.season ? ` - ${model.form.season}` : ''}</div>
                {model.form.description ? <p className="mt-2 text-sm font-semibold leading-5 text-gray-600">{model.form.description}</p> : null}
              </div>
            </div>
          </section>

          <FieldSet title="Participant information" fields={model.form.participantFields} prefix="participant" />
          <FieldSet title="Guardian information" fields={model.form.guardianFields} prefix="guardian" />

          {model.form.waiverText ? (
            <section className="app-card p-4">
              <h2 className="text-sm font-black text-gray-950">Waiver</h2>
              <div className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm font-semibold leading-5 text-gray-700">{model.form.waiverText}</div>
              <label className="mt-3 flex items-start gap-2 text-sm font-bold text-gray-700">
                <input type="checkbox" className="mt-1" disabled />
                <span>I have reviewed and agree to the waiver terms.</span>
              </label>
            </section>
          ) : null}

          {model.options.length ? (
            <section className="app-card p-4">
              <fieldset>
                <legend className="text-sm font-black text-gray-950">Registration options</legend>
                <div className="mt-3 space-y-2">
                  {model.options.map((option) => (
                    <label key={option.id} className="flex items-start gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
                      <input type="radio" name="registrationOptionId" className="mt-1" disabled />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-black text-gray-900">{option.title}</span>
                        {option.description ? <span className="mt-1 block text-xs font-semibold text-gray-600">{option.description}</span> : null}
                        <span className="mt-1 block text-xs font-black text-primary-700">{formatCapacityLabel(option, model.form.registrationOptionCounts)}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </section>
          ) : null}

          <section className="app-card p-4">
            <h2 className="text-sm font-black text-gray-950">Fee summary</h2>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <MetricCard label="Quantity" value={String(quantity)} />
              <MetricCard label="Due now" value={feeLabel} />
              <MetricCard label="Checkout" value={model.onlineCheckout ? 'Stripe' : 'Not configured'} />
            </div>
            {model.paymentNotice ? <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs font-semibold text-blue-800">{model.paymentNotice}</div> : null}
          </section>

          {model.paymentPlans.length ? (
            <section className="app-card p-4">
              <fieldset>
                <legend className="text-sm font-black text-gray-950">Payment plan</legend>
                <div className="mt-3 space-y-2">
                  {model.paymentPlans.map((plan) => (
                    <label key={plan.id} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm font-bold text-gray-800">
                      <input type="radio" name="paymentPlanId" defaultChecked={plan.id === 'pay_full'} disabled />
                      <span>{plan.title}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </section>
          ) : null}

          <button type="button" className="primary-button w-full" disabled>Submit registration coming soon</button>
        </div>
      ) : null}
    </div>
  );
}

function FieldSet({ title, fields, prefix }: { title: string; fields: Array<Record<string, any>>; prefix: string }) {
  return (
    <section className="app-card p-4">
      <h2 className="text-sm font-black text-gray-950">{title}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {fields.length ? fields.map((field) => <FieldPreview key={field.id} field={field} prefix={prefix} />) : <div className="text-sm font-semibold text-gray-500">No custom fields configured.</div>}
      </div>
    </section>
  );
}

function FieldPreview({ field, prefix }: { field: Record<string, any>; prefix: string }) {
  const id = `${prefix}-${field.id}`;
  const label = `${field.label}${field.required ? ' *' : ''}`;
  return (
    <label htmlFor={id} className={field.type === 'textarea' ? 'sm:col-span-2' : ''}>
      <span className="app-label">{label}</span>
      {field.type === 'textarea' ? (
        <textarea id={id} className="auth-input mt-1 min-h-24 resize-none" disabled />
      ) : field.type === 'select' ? (
        <select id={id} className="auth-input mt-1" disabled>
          <option value="">Choose {field.label}</option>
          {(field.options || []).map((option: string) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : (
        <input id={id} type={field.type || 'text'} className="auth-input mt-1" disabled />
      )}
    </label>
  );
}

function LoadingBlock({ label }: { label: string }) {
  return <div className="app-card flex items-center justify-center gap-2 p-6 text-sm font-black text-gray-600"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{label}</div>;
}

function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="app-card p-4">
      <div className="flex items-start gap-3 rounded-xl border border-rose-100 bg-rose-50 p-3 text-sm font-bold text-rose-800"><AlertCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />{message}</div>
      <button type="button" className="secondary-button mt-3" onClick={onRetry}><RefreshCw className="h-4 w-4" aria-hidden="true" />Retry</button>
    </section>
  );
}

function UnavailableBlock({ legacyUrl, onRetry }: { legacyUrl: string; onRetry: () => void }) {
  return (
    <section className="app-card p-4">
      <h2 className="text-sm font-black text-gray-950">Registration unavailable</h2>
      <p className="mt-1 text-sm font-semibold text-gray-600">This linked registration form is not published right now.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="secondary-button" onClick={onRetry}><RefreshCw className="h-4 w-4" aria-hidden="true" />Retry</button>
        <button type="button" className="secondary-button" onClick={() => openPublicUrl(legacyUrl)}><ExternalLink className="h-4 w-4" aria-hidden="true" />Legacy form</button>
      </div>
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-gray-200 bg-gray-50 p-3"><div className="text-[10px] font-black uppercase tracking-[0.04em] text-gray-500">{label}</div><div className="mt-1 truncate text-sm font-black text-gray-950">{value}</div></div>;
}

function formatCapacityLabel(option: Record<string, any>, counts: Record<string, any> = {}) {
  const count = counts[option.countKey] || counts[option.id] || {};
  const enrolled = Number(count.enrolled || 0);
  if (!option.capacityLimit) return option.waitlistEnabled ? 'Open, waitlist available' : 'Open';
  const remaining = Math.max(0, Number(option.capacityLimit) - enrolled);
  if (remaining > 0) return `${remaining} spot${remaining === 1 ? '' : 's'} left`;
  return option.waitlistEnabled ? 'Full, waitlist available' : 'Full';
}

function formatMoney(cents: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format((Number(cents) || 0) / 100);
}
