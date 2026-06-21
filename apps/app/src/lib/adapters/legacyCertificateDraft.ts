import {
  createCertificate as legacyCreateCertificate,
  createCertificateBatch as legacyCreateCertificateBatch,
  getCertificateDefaults as legacyGetCertificateDefaults,
  getPlayers as legacyGetPlayers,
  getTeam as legacyGetTeam,
  getUserByEmail as legacyGetUserByEmail,
  getUserProfile as legacyGetUserProfile,
  setCertificateDefaults as legacySetCertificateDefaults,
  updateCertificateBatch as legacyUpdateCertificateBatch
} from '@legacy/db.js';
import { buildDefaultSigners as legacyBuildDefaultSigners, normalizeSigners as legacyNormalizeSigners } from '@legacy/certificates/signers.js';
import { resolveColors as legacyResolveColors } from '@legacy/certificates/renderer.js';
import { TEMPLATES as legacyTemplates } from '@legacy/certificates/templates.js';
import { hasFullTeamAccess as legacyHasFullTeamAccess } from '@legacy/team-access.js';

/**
 * Typed adapter boundary for the legacy js/ certificate helpers (#2066). Bindings
 * are re-exported as-is (no runtime wrapping) so existing js/* test mocks still
 * apply through the @legacy alias; legacy shapes stay loose.
 */
export const createCertificate = legacyCreateCertificate as (...args: any[]) => Promise<any>;
export const createCertificateBatch = legacyCreateCertificateBatch as (...args: any[]) => Promise<any>;
export const getCertificateDefaults = legacyGetCertificateDefaults as (...args: any[]) => Promise<any>;
export const getPlayers = legacyGetPlayers as (...args: any[]) => Promise<any>;
export const getTeam = legacyGetTeam as (...args: any[]) => Promise<any>;
export const getUserByEmail = legacyGetUserByEmail as (...args: any[]) => Promise<any>;
export const getUserProfile = legacyGetUserProfile as (...args: any[]) => Promise<any>;
export const setCertificateDefaults = legacySetCertificateDefaults as (...args: any[]) => Promise<any>;
export const updateCertificateBatch = legacyUpdateCertificateBatch as (...args: any[]) => Promise<any>;
export const buildDefaultSigners = legacyBuildDefaultSigners as (...args: any[]) => any;
export const normalizeSigners = legacyNormalizeSigners as (...args: any[]) => any;
export const resolveColors = legacyResolveColors as (...args: any[]) => any;
export const TEMPLATES = legacyTemplates as Record<string, unknown>;
export const hasFullTeamAccess = legacyHasFullTeamAccess as (...args: any[]) => boolean;
