/* Auto-generated typed adapter boundary for legacy js/ parent-tools imports (#2066).
 * Bindings re-exported as-is so existing js/* test mocks apply via the @legacy alias. */
import * as legacyDb from '@legacy/db.js';
import { addPendingFamilyMember as legacy_addPendingFamilyMember, readFamilyMembers as legacy_readFamilyMembers } from '@legacy/family-plan.js';
import * as legacyFirebase from '@legacy/firebase.js';
import { formatParentFeeAmount as legacy_formatParentFeeAmount, formatParentFeeDueDate as legacy_formatParentFeeDueDate, getParentFeeStatusMeta as legacy_getParentFeeStatusMeta, normalizeParentFeeRecord as legacy_normalizeParentFeeRecord, sortParentFeeRecords as legacy_sortParentFeeRecords } from '@legacy/parent-dashboard-fees.js';
import * as legacyStripeService from '@legacy/stripe-service.js';
import { buildPendingRegistrationRecord as legacy_buildPendingRegistrationRecord, calculateRegistrationFeeSnapshot as legacy_calculateRegistrationFeeSnapshot, decideRegistrationPlacement as legacy_decideRegistrationPlacement, getActiveRegistrationOptions as legacy_getActiveRegistrationOptions, getPaymentPlanChoices as legacy_getPaymentPlanChoices, getRegistrationPaymentNotice as legacy_getRegistrationPaymentNotice, hasOnlineRegistrationCheckout as legacy_hasOnlineRegistrationCheckout, normalizeRegistrationForm as legacy_normalizeRegistrationForm, requiresRegistrationOption as legacy_requiresRegistrationOption } from '@legacy/registration-flow.js';
import { getRegistrationGuardianDrafts as legacy_getRegistrationGuardianDrafts, getRegistrationPlayerDraft as legacy_getRegistrationPlayerDraft, getRegistrationSubmittedData as legacy_getRegistrationSubmittedData, normalizeRegistrationStatus as legacy_normalizeRegistrationStatus } from '@legacy/registration-review.js';
import { canContributeTeamMedia as legacy_canContributeTeamMedia, canManageTeamMedia as legacy_canManageTeamMedia, canReadTeamMediaAlbum as legacy_canReadTeamMediaAlbum, getTeamMediaItemUrl as legacy_getTeamMediaItemUrl, isSafeTeamMediaUrl as legacy_isSafeTeamMediaUrl, sortByMediaOrder as legacy_sortByMediaOrder } from '@legacy/team-media-utils.js';

function callLegacyDb(name: string, args: any[]) {
  const fn = (legacyDb as Record<string, any>)[name];
  if (typeof fn !== 'function') {
    throw new TypeError(`Legacy db binding ${String(name)} is not available.`);
  }
  return fn(...args);
}

function callLegacyFirebase(name: string, args: any[]) {
  const fn = (legacyFirebase as Record<string, any>)[name];
  if (typeof fn !== 'function') {
    throw new TypeError(`Legacy firebase binding ${String(name)} is not available.`);
  }
  return fn(...args);
}

function callLegacyStripeService(name: string, args: any[]) {
  const fn = (legacyStripeService as Record<string, any>)[name];
  if (typeof fn !== 'function') {
    throw new TypeError(`Legacy stripe-service binding ${String(name)} is not available.`);
  }
  return fn(...args);
}

export const approveTeamRegistration = (...args: any[]) => callLegacyDb('approveTeamRegistration', args);
export const acceptTeamRegistrationOffer = (...args: any[]) => callLegacyDb('acceptTeamRegistrationOffer', args);
export const createFamilyShareToken = (...args: any[]) => callLegacyDb('createFamilyShareToken', args);
export const createParentMembershipRequest = (...args: any[]) => callLegacyDb('createParentMembershipRequest', args);
export const createRegistrationCheckoutSession = (...args: any[]) => callLegacyDb('createRegistrationCheckoutSession', args);
export const extendTeamRegistrationOffer = (...args: any[]) => callLegacyDb('extendTeamRegistrationOffer', args);
export const createTeamMediaFolder = (...args: any[]) => callLegacyDb('createTeamMediaFolder', args);
export const createTeamMediaLink = (...args: any[]) => callLegacyDb('createTeamMediaLink', args);
export const discoverPublicTeams = (...args: any[]) => callLegacyDb('discoverPublicTeams', args);
export const getPlayers = (...args: any[]) => callLegacyDb('getPlayers', args);
export const getTeamRegistrationForm = (...args: any[]) => callLegacyDb('getTeamRegistrationForm', args);
export const getTeam = (...args: any[]) => callLegacyDb('getTeam', args);
export const getTeamMediaFolders = (...args: any[]) => callLegacyDb('getTeamMediaFolders', args);
export const getTeamMediaItems = (...args: any[]) => callLegacyDb('getTeamMediaItems', args);
export const getTeamMediaItemsPage = (...args: any[]) => callLegacyDb('getTeamMediaItemsPage', args);
export const canAccessTeamChat = (...args: any[]) => callLegacyDb('canAccessTeamChat', args);
export const listCertificatesForPlayer = (...args: any[]) => callLegacyDb('listCertificatesForPlayer', args);
export const listFamilyShareTokens = (...args: any[]) => callLegacyDb('listFamilyShareTokens', args);
export const listMyParentMembershipRequests = (...args: any[]) => callLegacyDb('listMyParentMembershipRequests', args);
export const listParentTeamFeeRecipients = (...args: any[]) => callLegacyDb('listParentTeamFeeRecipients', args);
export const listTeamRegistrationForms = (...args: any[]) => callLegacyDb('listTeamRegistrationForms', args);
export const listTeamRegistrationReviews = (...args: any[]) => callLegacyDb('listTeamRegistrationReviews', args);
export const listTeamRegistrationReviewsPage = (...args: any[]) => callLegacyDb('listTeamRegistrationReviewsPage', args);
export const rejectTeamRegistration = (...args: any[]) => callLegacyDb('rejectTeamRegistration', args);
export const revokeFamilyShareToken = (...args: any[]) => callLegacyDb('revokeFamilyShareToken', args);
export const updateFamilyShareTokenCalendars = (...args: any[]) => callLegacyDb('updateFamilyShareTokenCalendars', args);
export const uploadTeamMediaFile = (...args: any[]) => callLegacyDb('uploadTeamMediaFile', args);
export const uploadTeamMediaPhoto = (...args: any[]) => callLegacyDb('uploadTeamMediaPhoto', args);
export const deleteTeamMediaItem = (...args: any[]) => callLegacyDb('deleteTeamMediaItem', args);
export const updateTeamMediaItem = (...args: any[]) => callLegacyDb('updateTeamMediaItem', args);
export const moveTeamMediaItems = (...args: any[]) => callLegacyDb('moveTeamMediaItems', args);
export const setTeamMediaAlbumCover = (...args: any[]) => callLegacyDb('setTeamMediaAlbumCover', args);
export const addPendingFamilyMember = legacy_addPendingFamilyMember as (...args: any[]) => any;
export const readFamilyMembers = legacy_readFamilyMembers as (...args: any[]) => any;
export const db: unknown = legacyFirebase.db;
export const doc = (...args: any[]) => callLegacyFirebase('doc', args);
export const collection = (...args: any[]) => callLegacyFirebase('collection', args);
export const getDoc = (...args: any[]) => callLegacyFirebase('getDoc', args);
export const serverTimestamp = (...args: any[]) => callLegacyFirebase('serverTimestamp', args);
export const runTransaction = (...args: any[]) => callLegacyFirebase('runTransaction', args);
export const formatParentFeeAmount = legacy_formatParentFeeAmount as (...args: any[]) => any;
export const formatParentFeeDueDate = legacy_formatParentFeeDueDate as (...args: any[]) => any;
export const getParentFeeStatusMeta = legacy_getParentFeeStatusMeta as (...args: any[]) => any;
export const normalizeParentFeeRecord = legacy_normalizeParentFeeRecord as (...args: any[]) => any;
export const sortParentFeeRecords = legacy_sortParentFeeRecords as (...args: any[]) => any;
export const cancelStripeRegistrationCheckout = (...args: any[]) => callLegacyStripeService('cancelStripeRegistrationCheckout', args);
export const initiateTeamFeeCheckout = (...args: any[]) => callLegacyStripeService('initiateTeamFeeCheckout', args);
export const buildPendingRegistrationRecord = legacy_buildPendingRegistrationRecord as (...args: any[]) => any;
export const calculateRegistrationFeeSnapshot = legacy_calculateRegistrationFeeSnapshot as (...args: any[]) => any;
export const decideRegistrationPlacement = legacy_decideRegistrationPlacement as (...args: any[]) => any;
export const getActiveRegistrationOptions = legacy_getActiveRegistrationOptions as (...args: any[]) => any;
export const getPaymentPlanChoices = legacy_getPaymentPlanChoices as (...args: any[]) => any;
export const getRegistrationPaymentNotice = legacy_getRegistrationPaymentNotice as (...args: any[]) => any;
export const hasOnlineRegistrationCheckout = legacy_hasOnlineRegistrationCheckout as (...args: any[]) => any;
export const normalizeRegistrationForm = legacy_normalizeRegistrationForm as (...args: any[]) => any;
export const requiresRegistrationOption = legacy_requiresRegistrationOption as (...args: any[]) => any;
export const getRegistrationGuardianDrafts = legacy_getRegistrationGuardianDrafts as (...args: any[]) => any;
export const getRegistrationPlayerDraft = legacy_getRegistrationPlayerDraft as (...args: any[]) => any;
export const getRegistrationSubmittedData = legacy_getRegistrationSubmittedData as (...args: any[]) => any;
export const normalizeRegistrationStatus = legacy_normalizeRegistrationStatus as (...args: any[]) => any;
export const canContributeTeamMedia = legacy_canContributeTeamMedia as (...args: any[]) => any;
export const canManageTeamMedia = legacy_canManageTeamMedia as (...args: any[]) => any;
export const canReadTeamMediaAlbum = legacy_canReadTeamMediaAlbum as (...args: any[]) => any;
export const getTeamMediaItemUrl = legacy_getTeamMediaItemUrl as (...args: any[]) => any;
export const isSafeTeamMediaUrl = legacy_isSafeTeamMediaUrl as (...args: any[]) => any;
export const sortByMediaOrder = legacy_sortByMediaOrder as (...args: any[]) => any;
