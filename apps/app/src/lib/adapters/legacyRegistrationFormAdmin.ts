import {
  buildAdminRegistrationFormPayload as legacyBuildAdminRegistrationFormPayload,
  formatFieldLabels as legacyFormatFieldLabels,
  isPublishedAdminRegistrationFormStatus as legacyIsPublishedAdminRegistrationFormStatus,
  normalizeAdminRegistrationFormStatus as legacyNormalizeAdminRegistrationFormStatus,
  normalizeBackgroundCheckSettings as legacyNormalizeBackgroundCheckSettings,
  parseAdminRegistrationFeeAmountCents as legacyParseAdminRegistrationFeeAmountCents,
  validateAdminRegistrationFormPayload as legacyValidateAdminRegistrationFormPayload
} from '@legacy/admin-registration-forms.js';
import { calculateRegistrationFeeSnapshot as legacyCalculateRegistrationFeeSnapshot, getPaymentPlanChoices as legacyGetPaymentPlanChoices, normalizeRegistrationForm as legacyNormalizeRegistrationForm } from '@legacy/registration-flow.js';

/**
 * Typed adapter boundary for the legacy js/ registration form-admin helpers
 * (#2066). Bindings re-exported as-is so existing js/* test mocks apply via the
 * @legacy alias; legacy shapes stay loose.
 */
export const buildAdminRegistrationFormPayload = legacyBuildAdminRegistrationFormPayload as (...args: any[]) => any;
export const formatFieldLabels = legacyFormatFieldLabels as (...args: any[]) => any;
export const isPublishedAdminRegistrationFormStatus = legacyIsPublishedAdminRegistrationFormStatus as (...args: any[]) => any;
export const normalizeAdminRegistrationFormStatus = legacyNormalizeAdminRegistrationFormStatus as (...args: any[]) => any;
export const normalizeBackgroundCheckSettings = legacyNormalizeBackgroundCheckSettings as (...args: any[]) => any;
export const parseAdminRegistrationFeeAmountCents = legacyParseAdminRegistrationFeeAmountCents as (...args: any[]) => any;
export const validateAdminRegistrationFormPayload = legacyValidateAdminRegistrationFormPayload as (...args: any[]) => any;
export const calculateRegistrationFeeSnapshot = legacyCalculateRegistrationFeeSnapshot as (...args: any[]) => any;
export const getPaymentPlanChoices = legacyGetPaymentPlanChoices as (...args: any[]) => any;
export const normalizeRegistrationForm = legacyNormalizeRegistrationForm as (...args: any[]) => any;
