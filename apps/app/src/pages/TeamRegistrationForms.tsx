import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowDown, ArrowLeft, ArrowUp, ExternalLink, Loader2, Plus, RefreshCw, Save, Ticket, Trash2 } from 'lucide-react';
import {
  buildRegistrationFormEditorDraft,
  validateRegistrationFormEditorDraft,
  type RegistrationFormEditorDraft
} from '../lib/registrationFormAdmin';
import {
  canManageRegistrationFormsForApp,
  listRegistrationFormEditorsForApp,
  saveRegistrationFormEditorForApp
} from '../lib/registrationFormAdminService';
import type { AuthState } from '../lib/types';

type DraftRecord = Record<string, any>;

function createBlankDraft(teamId: string): RegistrationFormEditorDraft {
  return {
    teamId,
    formId: '',
    title: '',
    description: '',
    programType: 'season',
    season: '',
    feeAmount: '',
    participantFieldsText: 'Player name\nBirthdate',
    guardianFieldsText: 'Guardian name\nGuardian email\nGuardian phone',
    registrationOptions: [{
      id: 'option_1',
      label: 'General registration',
      description: '',
      capacityLimit: '',
      active: true,
      waitlistEnabled: false
    }],
    paymentSettings: { offlinePaymentEnabled: true, onlineCheckoutEnabled: false },
    installmentPlan: { enabled: false, title: 'Installment plan', installmentCount: 3, firstDueDate: '', intervalDays: 30 },
    discountRules: [],
    backgroundCheck: { enabled: false, required: false, instructions: '', initialScreeningStatus: 'pending', providerName: '' },
    waiverText: '',
    status: 'draft',
    published: false,
    isOpen: false,
    isClosed: false
  };
}

function sortDrafts(drafts: RegistrationFormEditorDraft[]) {
  return [...drafts].sort((left, right) => left.title.localeCompare(right.title, undefined, { sensitivity: 'base' }));
}

export function TeamRegistrationForms({ auth }: { auth: AuthState }) {
  const { teamId = '' } = useParams();
  const [forms, setForms] = useState<RegistrationFormEditorDraft[]>([]);
  const [draft, setDraft] = useState<RegistrationFormEditorDraft>(() => createBlankDraft(teamId));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadForms = useCallback(async () => {
    if (!teamId) return;
    setLoading(true);
    setError('');
    try {
      const nextForms = await listRegistrationFormEditorsForApp(auth.user, teamId);
      setForms(nextForms);
      setDraft((current) => {
        const selected = current.formId ? nextForms.find((form) => form.formId === current.formId) : null;
        return selected || nextForms[0] || createBlankDraft(teamId);
      });
    } catch (loadError: any) {
      setError(loadError?.message || 'Unable to load registration forms.');
    } finally {
      setLoading(false);
    }
  }, [auth.user, teamId]);

  useEffect(() => {
    setDraft(createBlankDraft(teamId));
    void loadForms();
  }, [loadForms, teamId]);

  if (!teamId) return <Navigate to="/teams" replace />;

  const canManage = canManageRegistrationFormsForApp(auth.user, teamId);

  const updateDraft = (patch: Partial<RegistrationFormEditorDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setError('');
    setSuccess('');
  };

  const updateOption = (index: number, patch: DraftRecord) => {
    updateDraft({
      registrationOptions: draft.registrationOptions.map((option, optionIndex) => optionIndex === index ? { ...option, ...patch } : option)
    });
  };

  const moveOption = (index: number, direction: -1 | 1) => {
    const destination = index + direction;
    if (destination < 0 || destination >= draft.registrationOptions.length) return;
    const next = [...draft.registrationOptions];
    [next[index], next[destination]] = [next[destination], next[index]];
    updateDraft({ registrationOptions: next });
  };

  const updateDiscount = (index: number, patch: DraftRecord) => {
    updateDraft({
      discountRules: draft.discountRules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule)
    });
  };

  const onSave = async () => {
    setSuccess('');
    const errors = validateRegistrationFormEditorDraft(draft, { teamId });
    if (errors.length) {
      setError(errors.join(' '));
      return;
    }

    setSaving(true);
    setError('');
    try {
      const result = await saveRegistrationFormEditorForApp({
        user: auth.user,
        teamId,
        formId: draft.formId,
        draft
      });
      const savedDraft = buildRegistrationFormEditorDraft({ ...result.payload, id: result.formId }, { teamId, formId: result.formId });
      setForms((current) => sortDrafts([...current.filter((form) => form.formId !== result.formId), savedDraft]));
      setDraft(savedDraft);
      setSuccess(result.created ? 'Registration form created.' : 'Registration form saved.');
    } catch (saveError: any) {
      setError(saveError?.message || 'Unable to save registration form.');
    } finally {
      setSaving(false);
    }
  };

  if (!canManage && !loading) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <Link to={`/teams/${encodeURIComponent(teamId)}`} className="inline-flex items-center gap-2 text-sm font-black text-primary-700"><ArrowLeft className="h-4 w-4" />Back to team</Link>
        <section className="app-card mt-4 p-5">
          <h1 className="text-xl font-black text-gray-950">Registration setup</h1>
          <p className="mt-2 text-sm font-semibold text-rose-700">Admin access is required to manage registration forms.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 pb-28">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to={`/teams/${encodeURIComponent(teamId)}`} className="inline-flex items-center gap-2 text-sm font-black text-primary-700"><ArrowLeft className="h-4 w-4" />Back to team</Link>
          <h1 className="mt-2 flex items-center gap-2 text-2xl font-black text-gray-950"><Ticket className="h-6 w-6 text-primary-600" />Registration setup</h1>
          <p className="mt-1 text-sm font-semibold text-gray-500">Create or edit the same forms used by the app and registration website.</p>
        </div>
        <button type="button" className="ghost-button" onClick={() => void loadForms()} disabled={loading || saving}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh
        </button>
      </div>

      {error ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-800">{error}</div> : null}
      {success ? <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{success}</div> : null}

      <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="app-card h-fit p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-black text-gray-950">Forms</div>
            <button type="button" className="ghost-button !min-h-9 !px-3 text-xs" onClick={() => setDraft(createBlankDraft(teamId))}><Plus className="h-4 w-4" />New</button>
          </div>
          <div className="mt-3 space-y-2">
            {loading ? <div className="flex items-center gap-2 p-3 text-sm font-semibold text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Loading forms…</div> : null}
            {!loading && !forms.length ? <div className="rounded-xl border border-dashed border-gray-300 p-3 text-sm font-semibold text-gray-500">No saved forms yet.</div> : null}
            {forms.map((form) => (
              <button
                key={form.formId}
                type="button"
                className={`w-full rounded-xl border p-3 text-left ${draft.formId === form.formId ? 'border-primary-300 bg-primary-50' : 'border-gray-200 bg-white'}`}
                onClick={() => setDraft(form)}
              >
                <div className="truncate text-sm font-black text-gray-950">{form.title || 'Untitled form'}</div>
                <div className="mt-1 text-xs font-bold uppercase tracking-wide text-gray-500">{form.status}</div>
              </button>
            ))}
          </div>
        </aside>

        <main className="space-y-4">
          <section className="app-card p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-gray-950">{draft.formId ? 'Edit registration form' : 'New registration form'}</h2>
                <p className="mt-1 text-xs font-semibold text-gray-500">Existing submissions keep their saved fee/payment snapshots; edits apply to future submissions, matching the website editor.</p>
              </div>
              {draft.formId ? <Link className="ghost-button !min-h-9 text-xs" to={`/teams/${encodeURIComponent(teamId)}/registrations/${encodeURIComponent(draft.formId)}`}><ExternalLink className="h-4 w-4" />Review queue</Link> : null}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="Title"><input aria-label="Title" value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} className="form-input" /></Field>
              <Field label="Season"><input aria-label="Season" value={draft.season} onChange={(event) => updateDraft({ season: event.target.value })} className="form-input" placeholder="Spring 2027" /></Field>
              <Field label="Program type">
                <select aria-label="Program type" value={draft.programType} onChange={(event) => updateDraft({ programType: event.target.value })} className="form-input">
                  <option value="season">Season</option><option value="camp">Camp</option><option value="clinic">Clinic</option><option value="tryout">Tryout</option>
                </select>
              </Field>
              <Field label="Base fee (USD)"><input aria-label="Base fee (USD)" inputMode="decimal" value={draft.feeAmount} onChange={(event) => updateDraft({ feeAmount: event.target.value })} className="form-input" placeholder="125.00" /></Field>
              <Field label="Description" wide><textarea aria-label="Description" value={draft.description} onChange={(event) => updateDraft({ description: event.target.value })} className="form-input min-h-24" /></Field>
            </div>
          </section>

          <section className="app-card p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div><h2 className="text-lg font-black text-gray-950">Registration options</h2><p className="mt-1 text-xs font-semibold text-gray-500">Capacity and waitlist behavior are saved per option.</p></div>
              <button type="button" className="ghost-button !min-h-9 text-xs" onClick={() => updateDraft({ registrationOptions: [...draft.registrationOptions, { id: `option_${Date.now()}`, label: '', description: '', capacityLimit: '', active: true, waitlistEnabled: false }] })}><Plus className="h-4 w-4" />Add option</button>
            </div>
            <div className="mt-4 space-y-3">
              {draft.registrationOptions.map((rawOption, index) => {
                const option = rawOption as DraftRecord;
                return (
                  <div key={String(option.id || index)} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label={`Option ${index + 1} name`}><input aria-label={`Option ${index + 1} name`} value={String(option.label || '')} onChange={(event) => updateOption(index, { label: event.target.value })} className="form-input" /></Field>
                      <Field label="Capacity (blank = unlimited)"><input aria-label={`Option ${index + 1} capacity`} inputMode="numeric" value={String(option.capacityLimit ?? '')} onChange={(event) => updateOption(index, { capacityLimit: event.target.value })} className="form-input" /></Field>
                      <Field label="Description" wide><input aria-label={`Option ${index + 1} description`} value={String(option.description || '')} onChange={(event) => updateOption(index, { description: event.target.value })} className="form-input" /></Field>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-4">
                      <Check label="Available" checked={option.active !== false} onChange={(checked) => updateOption(index, { active: checked })} />
                      <Check label="Enable waitlist" checked={option.waitlistEnabled === true} onChange={(checked) => updateOption(index, { waitlistEnabled: checked })} />
                      <div className="ml-auto flex gap-1">
                        <IconButton label={`Move option ${index + 1} up`} disabled={index === 0} onClick={() => moveOption(index, -1)}><ArrowUp className="h-4 w-4" /></IconButton>
                        <IconButton label={`Move option ${index + 1} down`} disabled={index === draft.registrationOptions.length - 1} onClick={() => moveOption(index, 1)}><ArrowDown className="h-4 w-4" /></IconButton>
                        <IconButton label={`Remove option ${index + 1}`} onClick={() => updateDraft({ registrationOptions: draft.registrationOptions.filter((_, optionIndex) => optionIndex !== index) })}><Trash2 className="h-4 w-4" /></IconButton>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="app-card p-4 sm:p-5">
            <h2 className="text-lg font-black text-gray-950">Fields and waiver</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="Participant fields (one per line)"><textarea aria-label="Participant fields" value={draft.participantFieldsText} onChange={(event) => updateDraft({ participantFieldsText: event.target.value })} className="form-input min-h-32" /></Field>
              <Field label="Guardian fields (one per line)"><textarea aria-label="Guardian fields" value={draft.guardianFieldsText} onChange={(event) => updateDraft({ guardianFieldsText: event.target.value })} className="form-input min-h-32" /></Field>
              <Field label="Waiver text" wide><textarea aria-label="Waiver text" value={draft.waiverText} onChange={(event) => updateDraft({ waiverText: event.target.value })} className="form-input min-h-32" /></Field>
            </div>
          </section>

          <section className="app-card p-4 sm:p-5">
            <h2 className="text-lg font-black text-gray-950">Payments and discounts</h2>
            <div className="mt-4 flex flex-wrap gap-4">
              <Check label="Allow offline payment" checked={(draft.paymentSettings as DraftRecord).offlinePaymentEnabled === true} onChange={(checked) => updateDraft({ paymentSettings: { ...draft.paymentSettings, offlinePaymentEnabled: checked } })} />
              <Check label="Allow online checkout" checked={(draft.paymentSettings as DraftRecord).onlineCheckoutEnabled === true} onChange={(checked) => updateDraft({ paymentSettings: { ...draft.paymentSettings, onlineCheckoutEnabled: checked } })} />
              <Check label="Offer payment plan" checked={(draft.installmentPlan as DraftRecord).enabled === true} onChange={(checked) => updateDraft({ installmentPlan: { ...draft.installmentPlan, enabled: checked } })} />
            </div>
            {(draft.installmentPlan as DraftRecord).enabled ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Field label="Installments"><input aria-label="Installments" inputMode="numeric" value={String((draft.installmentPlan as DraftRecord).installmentCount || 3)} onChange={(event) => updateDraft({ installmentPlan: { ...draft.installmentPlan, installmentCount: event.target.value } })} className="form-input" /></Field>
                <Field label="First due date"><input aria-label="First due date" type="date" value={String((draft.installmentPlan as DraftRecord).firstDueDate || '')} onChange={(event) => updateDraft({ installmentPlan: { ...draft.installmentPlan, firstDueDate: event.target.value } })} className="form-input" /></Field>
                <Field label="Days between"><input aria-label="Days between" inputMode="numeric" value={String((draft.installmentPlan as DraftRecord).intervalDays || 30)} onChange={(event) => updateDraft({ installmentPlan: { ...draft.installmentPlan, intervalDays: event.target.value } })} className="form-input" /></Field>
              </div>
            ) : null}

            <div className="mt-5 flex items-center justify-between gap-3">
              <div className="text-sm font-black text-gray-950">Discount rules</div>
              <button type="button" className="ghost-button !min-h-9 text-xs" onClick={() => updateDraft({ discountRules: [...draft.discountRules, { id: `discount_${Date.now()}`, type: 'quantity', label: 'Sibling discount', amountType: 'fixed', amountValue: 0, minimumQuantity: 2, earlyBirdDeadline: '', active: true }] })}><Plus className="h-4 w-4" />Add discount</button>
            </div>
            <div className="mt-3 space-y-3">
              {draft.discountRules.map((rawRule, index) => {
                const rule = rawRule as DraftRecord;
                return (
                  <div key={String(rule.id || index)} className="grid gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label="Type"><select aria-label={`Discount ${index + 1} type`} value={String(rule.type || 'quantity')} onChange={(event) => updateDiscount(index, { type: event.target.value })} className="form-input"><option value="quantity">Quantity</option><option value="early_bird">Early bird</option></select></Field>
                    <Field label="Label"><input aria-label={`Discount ${index + 1} label`} value={String(rule.label || '')} onChange={(event) => updateDiscount(index, { label: event.target.value })} className="form-input" /></Field>
                    <Field label="Amount"><input aria-label={`Discount ${index + 1} amount`} inputMode="decimal" value={String(rule.amountValue ?? '')} onChange={(event) => updateDiscount(index, { amountValue: event.target.value })} className="form-input" /></Field>
                    <Field label="Amount type"><select aria-label={`Discount ${index + 1} amount type`} value={String(rule.amountType || 'fixed')} onChange={(event) => updateDiscount(index, { amountType: event.target.value })} className="form-input"><option value="fixed">Dollars</option><option value="percent">Percent</option></select></Field>
                    {rule.type === 'early_bird' ? <Field label="Deadline"><input aria-label={`Discount ${index + 1} deadline`} type="date" value={String(rule.earlyBirdDeadline || '')} onChange={(event) => updateDiscount(index, { earlyBirdDeadline: event.target.value })} className="form-input" /></Field> : <Field label="Minimum quantity"><input aria-label={`Discount ${index + 1} minimum quantity`} inputMode="numeric" value={String(rule.minimumQuantity || 2)} onChange={(event) => updateDiscount(index, { minimumQuantity: event.target.value })} className="form-input" /></Field>}
                    <div className="flex items-end justify-between gap-3 pb-1 lg:col-span-3"><Check label="Active" checked={rule.active !== false} onChange={(checked) => updateDiscount(index, { active: checked })} /><IconButton label={`Remove discount ${index + 1}`} onClick={() => updateDraft({ discountRules: draft.discountRules.filter((_, ruleIndex) => ruleIndex !== index) })}><Trash2 className="h-4 w-4" /></IconButton></div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="app-card p-4 sm:p-5">
            <h2 className="text-lg font-black text-gray-950">Availability</h2>
            <p className="mt-1 text-xs font-semibold text-gray-500">Draft is hidden, Published accepts submissions, and Closed stops new submissions on both public surfaces.</p>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <Field label="Status"><select aria-label="Status" value={draft.status} onChange={(event) => updateDraft({ status: event.target.value as RegistrationFormEditorDraft['status'] })} className="form-input min-w-48"><option value="draft">Draft</option><option value="published">Published</option><option value="closed">Closed</option></select></Field>
              <button type="button" className="primary-button" onClick={() => void onSave()} disabled={saving || loading}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? 'Saving…' : draft.status === 'published' ? 'Save and publish' : 'Save form'}
              </button>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return <label className={`block ${wide ? 'sm:col-span-2' : ''}`}><span className="mb-1 block text-xs font-black uppercase tracking-wide text-gray-600">{label}</span>{children}</label>;
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="inline-flex items-center gap-2 text-sm font-bold text-gray-700"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 rounded border-gray-300 text-primary-600" />{label}</label>;
}

function IconButton({ label, disabled = false, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 disabled:opacity-40">{children}</button>;
}
