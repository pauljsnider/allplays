import {
  buildAdminRegistrationFormPayload,
  calculateRegistrationFeeSnapshot,
  formatFieldLabels,
  getPaymentPlanChoices,
  isPublishedAdminRegistrationFormStatus,
  normalizeBackgroundCheckSettings,
  normalizeAdminRegistrationFormStatus,
  normalizeRegistrationForm,
  parseAdminRegistrationFeeAmountCents,
  validateAdminRegistrationFormPayload
} from './adapters/legacyRegistrationFormAdmin';

export type RegistrationFormEditorStatus = 'draft' | 'published' | 'closed';

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
  status: RegistrationFormEditorStatus;
  published: boolean;
  isOpen: boolean;
  isClosed: boolean;
};

export type RegistrationFormAdminPayloadResult = {
  payload: Record<string, unknown>;
  normalizedForm: Record<string, any>;
  errors: string[];
  paymentPlans: Array<Record<string, unknown>>;
  feeSnapshot: Record<string, unknown>;
  publishState: RegistrationFormPublishState;
};

export type RegistrationFormPublishState = {
  status: RegistrationFormEditorStatus;
  published: boolean;
  isOpen: boolean;
  isClosed: boolean;
};

export function buildRegistrationFormEditorDraft(form: Record<string, any> = {}, context: { teamId?: string; formId?: string } = {}): RegistrationFormEditorDraft {
  const normalizedForm = normalizeRegistrationForm(form, context);
  const installmentPlan = normalizedForm.installmentPlan || {};
  const backgroundCheck = normalizeBackgroundCheckSettings(form.backgroundCheck || normalizedForm.backgroundCheck || {});
  const publishState = getRegistrationFormPublishState(form.status, normalizedForm.published);

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
    ...publishState
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
  const errors = validateRegistrationFormEditorDraft(draft, { teamId: context.teamId });
  const publishState = getRegistrationFormPublishState(payload.status, normalizedForm.published);

  return {
    payload,
    normalizedForm,
    errors,
    paymentPlans: getPaymentPlanChoices(normalizedForm),
    feeSnapshot: calculateRegistrationFeeSnapshot(normalizedForm, { now: context.now || new Date() }),
    publishState
  };
}

export function validateRegistrationFormEditorDraft(
  draft: Partial<RegistrationFormEditorDraft> = {},
  context: { teamId?: string } = {}
): string[] {
  const payload = buildAdminRegistrationFormPayload(draft, { teamId: context.teamId || draft.teamId || '' });
  const errors = [...validateAdminRegistrationFormPayload(payload)];
  const feeError = getFeeAmountInputError(draft.feeAmount);
  if (feeError) errors.push(feeError);

  const rawStatus = String(draft.status || '').trim().toLowerCase();
  if (rawStatus && !['draft', 'published', 'open', 'closed'].includes(rawStatus)) {
    errors.push('Registration status is invalid.');
  }

  if (isInstallmentPlanRequested(draft) && !payload.installmentPlan) {
    errors.push('First installment due date is required when payment plans are enabled.');
  }

  return [...new Set(errors)];
}

export function getRegistrationFormPublishState(status: unknown, published = false): RegistrationFormPublishState {
  const normalizedStatus = normalizeRegistrationFormEditorStatus(status, published);
  return {
    status: normalizedStatus,
    published: Boolean(isPublishedAdminRegistrationFormStatus(normalizedStatus)),
    isOpen: normalizedStatus === 'published',
    isClosed: normalizedStatus === 'closed'
  };
}

export function normalizeRegistrationFormEditorStatus(status: unknown, published = false): RegistrationFormEditorStatus {
  const rawStatus = String(status || '').trim().toLowerCase();
  const normalizedStatus = normalizeAdminRegistrationFormStatus(rawStatus);
  if (normalizedStatus === 'closed') return 'closed';
  if (normalizedStatus === 'published' || published) return 'published';
  return 'draft';
}

export function toRegistrationFeeCents(value: unknown) {
  return Number(parseAdminRegistrationFeeAmountCents(value));
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

function getFeeAmountInputError(value: unknown) {
  const normalized = String(value ?? '').replace(/[$,]/g, '').trim();
  if (!normalized) return '';
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return 'Fee amount must be a valid dollar amount.';
  if (parsed < 0) return 'Fee amount must be zero or greater.';
  return '';
}

function isInstallmentPlanRequested(draft: Partial<RegistrationFormEditorDraft>) {
  const plan = draft.installmentPlan as Record<string, unknown> | undefined;
  return plan?.enabled === true || plan?.enabled === 'true';
}
