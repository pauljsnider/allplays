import {
  buildCertificateDescriptionPrompt as legacyBuildCertificateDescriptionPrompt,
  buildFallbackDescription as legacyBuildFallbackDescription,
  generateCertificateDescription as legacyGenerateCertificateDescription,
  generateDescriptionsForDrafts as legacyGenerateDescriptionsForDrafts,
  selectRecentCompletedGames as legacySelectRecentCompletedGames,
  truncateCertificateDescription as legacyTruncateCertificateDescription
} from '@legacy/certificates/aiDescriptions.js';

export const buildCertificateDescriptionPrompt = legacyBuildCertificateDescriptionPrompt as (...args: any[]) => string;
export const buildFallbackDescription = legacyBuildFallbackDescription as (...args: any[]) => string;
export const generateCertificateDescription = legacyGenerateCertificateDescription as (...args: any[]) => Promise<string>;
export const generateDescriptionsForDrafts = legacyGenerateDescriptionsForDrafts as (...args: any[]) => Promise<Map<string, any>>;
export const selectRecentCompletedGames = legacySelectRecentCompletedGames as (...args: any[]) => any[];
export const truncateCertificateDescription = legacyTruncateCertificateDescription as (...args: any[]) => string;
