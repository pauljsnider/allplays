import { Eye, X } from 'lucide-react';
import { Modal } from './Modal';
import { formatFeeSnapshotLines, type LegacyRegistrationFeeSnapshot } from '../lib/adapters/legacyRegistration';
import { formatCurrencyFromCents } from '../lib/money';

type RegistrationFormPreviewProps = {
  normalizedForm: Record<string, any>;
  feeSnapshot: LegacyRegistrationFeeSnapshot;
  paymentPlans: Array<Record<string, any>>;
  onClose: () => void;
};

export function RegistrationFormPreview({ normalizedForm, feeSnapshot, paymentPlans, onClose }: RegistrationFormPreviewProps) {
  const activeOptions = asArray(normalizedForm.registrationOptions).filter((option) => option?.active !== false);
  const participantFields = asArray(normalizedForm.participantFields);
  const guardianFields = asArray(normalizedForm.guardianFields);
  const activeDiscounts = asArray(normalizedForm.discountRules).filter((rule) => rule?.active !== false);
  const feeLines = formatFeeSnapshotLines(feeSnapshot);
  const installmentPlan = normalizedForm.installmentPlan || {};
  const currency = String(feeSnapshot.currency || normalizedForm.currency || 'USD');

  return (
    <Modal
      ariaLabel="Parent registration preview"
      onClose={onClose}
      overlayClassName="z-[70] flex items-end justify-center bg-gray-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <section
        data-testid="parent-preview-panel"
        className="flex max-h-[100dvh] w-full max-w-[390px] min-w-0 flex-col overflow-hidden rounded-t-3xl bg-gray-100 shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-3xl"
      >
        <header className="flex min-w-0 items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-primary-700"><Eye className="h-4 w-4" aria-hidden="true" />Parent preview</div>
            <p className="mt-1 text-xs font-semibold text-gray-500">Mobile-width family view</p>
          </div>
          <button type="button" aria-label="Close parent preview" className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700" onClick={onClose}>
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <div className="min-w-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto p-3" data-preview-scroll-container>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900">
            Preview only. Registration and payment are disabled.
          </div>

          <section className="app-card min-w-0 overflow-hidden p-4">
            <div className="app-label">Registration</div>
            <h1 className="mt-1 break-words text-xl font-black leading-tight text-gray-950">{textOr(normalizedForm.programName, 'Untitled registration')}</h1>
            {normalizedForm.season ? <p className="mt-1 break-words text-xs font-semibold text-gray-600">{String(normalizedForm.season)}</p> : null}
            {normalizedForm.description ? <p className="mt-3 whitespace-pre-line break-words text-sm font-semibold leading-6 text-gray-700">{String(normalizedForm.description)}</p> : null}
          </section>

          <PreviewSection title="Registration options" emptyLabel="No active registration options.">
            {activeOptions.map((option, index) => (
              <div key={String(option?.id || index)} className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 p-3">
                <div className="break-words text-sm font-black text-gray-950">{textOr(option?.title, 'Untitled option')}</div>
                {option?.description ? <p className="mt-1 break-words text-xs font-semibold leading-5 text-gray-600">{String(option.description)}</p> : null}
                {option?.waitlistEnabled ? <div className="mt-2 text-xs font-bold text-primary-700">Waitlist available if full</div> : null}
              </div>
            ))}
          </PreviewSection>

          <FieldPreviewSection title="Participant information" fields={participantFields} />
          <FieldPreviewSection title="Guardian information" fields={guardianFields} />

          <PreviewSection title="Fee summary">
            <div aria-label="Registration fee summary" className="grid gap-1.5">
              {feeLines.map((line, index) => (
                <div key={`${line.label}-${index}`} className={`flex min-w-0 items-center justify-between gap-3 ${line.strong ? 'border-t border-gray-200 pt-2 text-base font-black text-gray-950' : 'text-sm font-semibold text-gray-700'}`}>
                  <span className="min-w-0 break-words">{line.label}</span>
                  <span className="flex-none tabular-nums">{formatCurrencyFromCents(line.amountCents, currency)}</span>
                </div>
              ))}
            </div>
            {activeDiscounts.length ? (
              <div className="mt-3 border-t border-gray-200 pt-3">
                <div className="app-label">Available discounts</div>
                <div className="mt-2 grid gap-2">
                  {activeDiscounts.map((rule, index) => (
                    <div key={String(rule?.id || index)} className="min-w-0 rounded-lg bg-emerald-50 p-2 text-xs font-semibold text-emerald-900">
                      <div className="break-words font-black">{textOr(rule?.label, 'Discount')}</div>
                      <div className="mt-0.5 break-words">{formatDiscountRule(rule, currency)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </PreviewSection>

          <PreviewSection title="Payment choices">
            <div className="grid gap-2">
              {paymentPlans.map((plan, index) => (
                <div key={String(plan?.id || index)} className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <div className="break-words text-sm font-black text-gray-950">{textOr(plan?.title, 'Payment option')}</div>
                  {plan?.id === 'installments' ? <p className="mt-1 break-words text-xs font-semibold leading-5 text-gray-600">{formatInstallmentPlan(installmentPlan)}</p> : null}
                </div>
              ))}
            </div>
          </PreviewSection>

          {normalizedForm.waiverText ? (
            <PreviewSection title="Waiver">
              <div className="max-h-40 overflow-y-auto whitespace-pre-line break-words rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs font-semibold leading-5 text-gray-700">{String(normalizedForm.waiverText)}</div>
              <div className="mt-3 flex items-start gap-2 text-sm font-semibold text-gray-500" aria-label="Waiver acceptance disabled in preview">
                <span aria-hidden="true" className="mt-0.5 h-4 w-4 flex-none rounded border border-gray-300 bg-gray-100" />
                <span>I accept the waiver. Disabled in preview.</span>
              </div>
            </PreviewSection>
          ) : null}
        </div>
      </section>
    </Modal>
  );
}

function PreviewSection({ title, children, emptyLabel = '' }: { title: string; children?: React.ReactNode; emptyLabel?: string }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section className="app-card min-w-0 overflow-hidden p-4">
      <h2 className="text-sm font-black text-gray-950">{title}</h2>
      <div className="mt-3 grid min-w-0 gap-2">{hasChildren ? children : <p className="text-xs font-semibold text-gray-500">{emptyLabel}</p>}</div>
    </section>
  );
}

function FieldPreviewSection({ title, fields }: { title: string; fields: Array<Record<string, any>> }) {
  return (
    <PreviewSection title={title} emptyLabel="No fields configured.">
      {fields.map((field, index) => (
        <div key={String(field?.id || index)} className="min-w-0">
          <div className="app-label break-words">{textOr(field?.label, 'Untitled field')}{field?.required ? ' *' : ''}</div>
          <div aria-hidden="true" className="mt-1 h-10 w-full rounded-xl border border-gray-200 bg-gray-50" />
        </div>
      ))}
    </PreviewSection>
  );
}

function formatDiscountRule(rule: Record<string, any>, currency: string) {
  const amount = rule?.amountType === 'percent'
    ? `${Number(rule.amountValue || 0)}% off`
    : `${formatCurrencyFromCents(Number(rule?.amountValue || 0), currency)} off`;
  if (rule?.type === 'early_bird') return `${amount}${rule.earlyBirdDeadline ? ` through ${formatDate(rule.earlyBirdDeadline)}` : ''}`;
  return `${amount}${Number(rule?.minimumQuantity || 0) > 1 ? ` for ${Number(rule.minimumQuantity)}+ registrations` : ''}`;
}

function formatInstallmentPlan(plan: Record<string, any>) {
  const count = Math.max(1, Number(plan?.installmentCount || 1));
  const parts = [`${count} installments`];
  if (plan?.firstDueDate) parts.push(`first due ${formatDate(plan.firstDueDate)}`);
  if (Number(plan?.intervalDays || 0) > 0) parts.push(`every ${Number(plan.intervalDays)} days`);
  return parts.join(' · ');
}

function formatDate(value: unknown) {
  const date = new Date(`${String(value || '')}T12:00:00`);
  if (Number.isNaN(date.getTime())) return String(value || '');
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function asArray(value: unknown): Array<Record<string, any>> {
  return Array.isArray(value) ? value : [];
}

function textOr(value: unknown, fallback: string) {
  return String(value || '').trim() || fallback;
}
