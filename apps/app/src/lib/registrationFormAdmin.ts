import {
  buildAdminRegistrationFormPayload,
  formatFieldLabels,
  normalizeBackgroundCheckSettings,
  validateAdminRegistrationFormPayload
} from '../../../../js/admin-registration-forms.js';
import {
  calculateRegistrationFeeSnapshot,
  getPaymentPlanChoices,
  normalizeRegistrationForm
} from '../../../../js/registration-flow.js';

export type RegistrationFormEditorDraft = {
  teamId?: string;
  formId?: string;
  title: string;
  description: string;
  programType: string;
  season: string;
  feeAmount: string;
  participantFieldsText: string;
  guardianFieldsText: string;
  registrationOptions: Array<Record<string, unknown>>;
  paymentSettings: Record<string, unknown>;
  installmentPlan: Record<string, unknown>;
  discountRules: Array<Record<string, unknown>>;
  backgroundCheck: Record<string, unknown>;
  waiverText: string;
  status: 'draft' | 'published';
};

export type RegistrationFormAdminPayloadResult = {
  payload: Record<string, unknown>;
  normalizedForm: Record<string, any>;
  errors: string[];
  paymentPlans: Array<Record<string, unknown>>;
  feeSnapshot: Record<string, unknown>;
};

export function buildRegistrationFormEditorDraft(form: Record<string, any> = {}, context: { teamId?: string; formId?: string } = {}): RegistrationFormEditorDraft {
  const normalizedForm = normalizeRegistrationForm(form, context);
  const installmentPlan = normalizedForm.installmentPlan || {};
  const backgroundCheck = normalizeBackgroundCheckSettings(form.backgroundCheck || normalizedForm.backgroundCheck || {});

  return {
    teamId: normalizedForm.teamId,
    formId: normalizedForm.id,
    title: normalizedForm.programName,
    description: normalizedForm.description,
    programType: String(form.programType || 'season').trim() || 'season',
    season: normalizedForm.season,
    feeAmount: formatFeeInput(normalizedForm.feeAmountCents),
    participantFieldsText: formatFieldLabels(normalizedForm.participantFields),
    guardianFieldsText: formatFieldLabels(normalizedForm.guardianFields),
    registrationOptions: normalizedForm.registrationOptions.map((option: Record<string, any>) => ({
      id: option.id,
      label: option.title,
      description: option.description || '',
      capacityLimit: option.capacityLimit === null || option.capacityLimit === undefined ? '' : String(option.capacityLimit),
      active: option.active !== false,
      waitlistEnabled: option.waitlistEnabled === true
    })),
    paymentSettings: { ...normalizedForm.paymentSettings },
    installmentPlan: {
      enabled: installmentPlan.enabled === true,
      title: installmentPlan.title || 'Installment plan',
      installmentCount: installmentPlan.installmentCount || 3,
      firstDueDate: installmentPlan.firstDueDate || '',
      intervalDays: installmentPlan.intervalDays || 30
    },
    discountRules: denormalizeDraftDiscountRules(normalizedForm.discountRules || []),
    backgroundCheck,
    waiverText: normalizedForm.waiverText,
    status: normalizedForm.published ? 'published' : 'draft'
  };
}

export function buildAppRegistrationFormAdminPayload(
  draft: Partial<RegistrationFormEditorDraft> = {},
  context: { teamId?: string; now?: Date } = {}
): RegistrationFormAdminPayloadResult {
  const payload = buildAdminRegistrationFormPayload(draft, { teamId: context.teamId || draft.teamId || '' });
  const normalizedForm = normalizeRegistrationForm(payload, {
    teamId: String(payload.teamId || ''),
    formId: String(draft.formId || '')
  });
  const errors = validateAdminRegistrationFormPayload(payload);

  return {
    payload,
    normalizedForm,
    errors,
    paymentPlans: getPaymentPlanChoices(normalizedForm),
    feeSnapshot: calculateRegistrationFeeSnapshot(normalizedForm, { now: context.now || new Date() })
  };
}

function formatFeeInput(feeAmountCents: number) {
  const cents = Math.max(0, Math.round(Number(feeAmountCents) || 0));
  if (!cents) return '';
  return (cents / 100).toFixed(2);
}

function denormalizeDraftDiscountRules(rules: Array<Record<string, any>> = []) {
  return rules.map((rule) => ({
    ...rule,
    amountValue: rule?.amountType === 'fixed'
      ? Number((Math.max(0, Number(rule?.amountValue || 0)) / 100).toFixed(2))
      : Math.max(0, Number(rule?.amountValue || 0))
  }));
}
