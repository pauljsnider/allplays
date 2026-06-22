import {
  addPendingFamilyMember,
  approveTeamRegistration,
  buildPendingRegistrationRecord,
  calculateRegistrationFeeSnapshot,
  canAccessTeamChat,
  canContributeTeamMedia,
  canManageTeamMedia,
  canReadTeamMediaAlbum,
  cancelStripeRegistrationCheckout,
  collection,
  createFamilyShareToken,
  createParentMembershipRequest,
  createRegistrationCheckoutSession,
  createTeamMediaFolder,
  createTeamMediaLink,
  db,
  decideRegistrationPlacement,
  deleteTeamMediaItem,
  discoverPublicTeams,
  doc,
  extendTeamRegistrationOffer,
  formatParentFeeAmount,
  formatParentFeeDueDate,
  getActiveRegistrationOptions,
  getDoc,
  getParentFeeStatusMeta,
  getPaymentPlanChoices,
  getPlayers,
  getRegistrationGuardianDrafts,
  getRegistrationPaymentNotice,
  getRegistrationPlayerDraft,
  getRegistrationSubmittedData,
  getTeam,
  getTeamMediaFolders,
  getTeamMediaItemUrl,
  getTeamMediaItemsPage,
  getTeamRegistrationForm,
  hasOnlineRegistrationCheckout,
  initiateTeamFeeCheckout,
  isSafeTeamMediaUrl,
  listCertificatesForPlayer,
  listFamilyShareTokens,
  listMyParentMembershipRequests,
  listParentTeamFeeRecipients,
  listTeamRegistrationForms,
  listTeamRegistrationReviews,
  listTeamRegistrationReviewsPage,
  moveTeamMediaItems,
  normalizeParentFeeRecord,
  normalizeRegistrationForm,
  normalizeRegistrationStatus,
  readFamilyMembers,
  rejectTeamRegistration,
  requiresRegistrationOption,
  revokeFamilyShareToken,
  runTransaction,
  serverTimestamp,
  setTeamMediaAlbumCover,
  sortByMediaOrder,
  sortParentFeeRecords,
  updateFamilyShareTokenCalendars,
  updateTeamMediaItem,
  uploadTeamMediaFile,
  uploadTeamMediaPhoto
} from './adapters/legacyParentTools';
import { firebaseAuth, getNativeAuthIdToken } from './authService';
import { formatCurrencyFromCents as formatCurrency } from './money';
import { loadParentScheduleSummary } from './homeService';
import { formatEventDateLabel, formatEventTimeLabel, getScheduleTitle, type ParentScheduleEvent } from './scheduleLogic';
import type { AuthUser } from './types';

const legacyOrigin = 'https://allplays.ai';

export type ParentAccessTeam = {
  id: string;
  name: string;
  sport?: string;
  zip?: string;
};

export type ParentAccessPlayer = {
  id: string;
  name: string;
  number?: string;
  photoUrl?: string | null;
};

export type ParentAccessRequest = {
  id: string;
  teamId: string;
  teamName: string;
  playerId: string;
  playerName: string;
  relation: string;
  status: string;
  decisionNote?: string | null;
  createdAt?: unknown;
};

export type ParentFeeAppRecord = Record<string, any> & {
  amountLabel: string;
  dueLabel: string;
  statusLabel: string;
  notes?: string;
  feeNotes?: string;
  offlinePaymentInstructions?: string;
  paymentInstructions?: string;
  collectionMode?: string;
  checkoutUrl?: string;
  checkoutStatus?: string;
  canPay: boolean;
  checkoutInitiatable: boolean;
  paymentAction: 'checkoutUrl' | 'createCheckout' | '';
  lineItems: Array<Record<string, any>>;
  installments: Array<Record<string, any>>;
  ledgerEntries: Array<Record<string, any>>;
};

export type RegistrationDiscountRule = {
  id: string;
  type: 'early_bird' | 'quantity';
  label: string;
  amountType: 'percent' | 'fixed';
  amountValue: number;
  earlyBirdDeadline?: string;
  minimumQuantity?: number;
  active: boolean;
};

export type ParentRegistrationCard = Record<string, any> & {
  id: string;
  teamId: string;
  teamName: string;
  programName: string;
  description: string;
  season: string;
  feeLabel: string;
  paymentNotice: string;
  onlineCheckout: boolean;
  options: Array<Record<string, any>>;
  discountRules?: RegistrationDiscountRule[];
  url: string;
  appUrl?: string;
};

export type ParentRegistrationDetailModel = {
  teamName: string;
  isPublished: boolean;
  onlineCheckout: boolean;
  legacyUrl: string;
  form: Record<string, any>;
  options: Array<Record<string, any>>;
  feeSnapshot: Record<string, any>;
  paymentNotice: string;
  paymentPlans: Array<Record<string, any>>;
};

export type TeamRegistrationRosterPlayer = {
  id: string;
  name: string;
  number?: string;
};

export type TeamRegistrationReviewCard = Record<string, any> & {
  id: string;
  status: string;
  participantName: string;
  guardianLabel: string;
  guardianEmails: string[];
  participant: Record<string, any>;
  guardian: Record<string, any>;
  submittedData: Record<string, any>;
  submittedAt: unknown;
  selectedOptionLabel: string;
  paymentLabel: string;
  waiverAccepted: boolean;
  linkedPlayerId: string;
  decisionNote: string;
};

export type TeamRegistrationQueueModel = {
  reviews: TeamRegistrationReviewCard[];
  rosterPlayers: TeamRegistrationRosterPlayer[];
  waitlistedReviews?: TeamRegistrationReviewCard[];
  totalWaitlisted?: number;
};

export type ParentCalendarTeam = {
  teamId: string;
  teamName: string;
  eventCount: number;
};

export type FamilyShareTokenCard = Record<string, any> & {
  url: string;
  childCount: number;
};

export type ParentHouseholdLinkedPlayer = {
  teamId: string;
  teamName: string;
  playerId: string;
  playerName: string;
  playerNumber?: string;
  playerPhotoUrl?: string | null;
};

export type ParentHouseholdFamilyMember = Record<string, any> & {
  id: string;
  email: string;
  displayName: string;
  status: string;
  teamName: string;
  playerName: string;
  playerNumber?: string;
  relation: string;
  accessCode?: string;
  inviteUrl?: string;
};

export type ParentHouseholdInviteRequest = {
  playerKey: string;
  email: string;
  displayName?: string;
  relation: string;
};

export type ParentHouseholdInviteResult = {
  code: string;
  inviteUrl: string;
};

export type ParentCertificateCard = Record<string, any> & {
  teamId: string;
  teamName: string;
  playerId: string;
  playerName: string;
  url: string;
};

export type TeamMediaFolder = Record<string, any> & {
  id: string;
  itemCount: number;
  items: TeamMediaItem[];
  itemsLoaded?: boolean;
  itemsHasMore?: boolean;
  itemsNextCursor?: any;
};

export type TeamMediaItem = Record<string, any> & {
  id: string;
  url: string;
  title: string;
  type: string;
};

export type TeamMediaModel = {
  team: Record<string, any>;
  canManage: boolean;
  canContribute: boolean;
  canPostChat: boolean;
  folders: TeamMediaFolder[];
};

export async function deleteTeamMediaItemForApp(teamId: string, item: TeamMediaItem) {
  if (!teamId || !item?.id) throw new Error('Missing team or media item ID.');
  await deleteTeamMediaItem(teamId, item);
}

export async function updateTeamMediaItemForApp(teamId: string, itemId: string, title: string) {
  const cleanTitle = compactString(title);
  if (!teamId || !itemId) throw new Error('Missing team or media item ID.');
  if (!cleanTitle) throw new Error('Media item title cannot be empty.');
  return updateTeamMediaItem(teamId, itemId, { title: cleanTitle });
}

export async function moveTeamMediaItemForApp(teamId: string, itemId: string, targetFolderId: string) {
  if (!teamId || !itemId || !targetFolderId) throw new Error('Missing team, media item, or destination album ID.');
  return moveTeamMediaItems(teamId, [itemId], targetFolderId);
}

export async function setTeamMediaAlbumCoverForApp(teamId: string, folderId: string, item: TeamMediaItem) {
  if (!teamId || !folderId || !item?.id) throw new Error('Choose a photo to use as the album cover.');
  return setTeamMediaAlbumCover(teamId, folderId, item);
}

export async function bulkDeleteTeamMediaItemsForApp(teamId: string, items: TeamMediaItem[]) {
  const itemsToDelete = Array.isArray(items) ? items.filter((item) => compactString(item?.id)) : [];
  if (!teamId) throw new Error('Missing team ID.');
  if (!itemsToDelete.length) throw new Error('Select at least one media item to delete.');
  await Promise.all(itemsToDelete.map((item) => deleteTeamMediaItem(teamId, item)));
}

export function getLegacyUrl(path: string, params: Record<string, string> = {}, hashParams: Record<string, string> = {}) {
  const url = new URL(path, legacyOrigin);
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  const hash = new URLSearchParams();
  Object.entries(hashParams).forEach(([key, value]) => {
    if (value) hash.set(key, value);
  });
  if ([...hash.keys()].length) url.hash = hash.toString();
  return url.toString();
}

export function getFamilyShareUrl(tokenId: string) {
  return getLegacyUrl('family.html', { token: tokenId });
}

export async function submitOfflineRegistration(teamId: string, formId: string, submission: Record<string, any>) {
  if (!teamId || !formId || !submission) throw new Error('Registration submission is incomplete.');

  const formRef = doc(db, 'teams', teamId, 'registrationForms', formId);
  const registrationRef = doc(collection(db, 'teams', teamId, 'registrationForms', formId, 'registrations'));

  return runTransaction(db, async (transaction: any) => {
    const formSnap = await transaction.get(formRef);
    if (!formSnap.exists()) throw new Error('Registration form could not be found.');

    const formData = formSnap.data() || {};
    const latestForm = normalizeRegistrationForm(formData, { teamId, formId });
    let status = 'pending';
    let selectedOption = submission.selectedOption || null;
    let feeSnapshot = submission.feeSnapshot || calculateRegistrationFeeSnapshot(latestForm, { quantity: submission.quantity || 1, now: new Date() });

    if (requiresRegistrationOption(latestForm)) {
      const placement = decideRegistrationPlacement({
        form: latestForm,
        selectedOptionId: submission.selectedOptionId || submission.selectedOption?.id,
        counts: formData.registrationOptionCounts || {}
      });
      if (placement.status === 'blocked') {
        const error = new Error(placement.message || 'Registration option is not available.');
        (error as any).code = placement.reason === 'option-full' ? 'option-full' : 'invalid-option';
        throw error;
      }
      const selectedCountKey = placement.selectedOption.countKey;
      const optionCounts = formData.registrationOptionCounts || null;
      if (!optionCounts || typeof optionCounts !== 'object' || !optionCounts[selectedCountKey] || typeof optionCounts[selectedCountKey] !== 'object') {
        throw new Error('Registration form capacity tracking is not properly configured.');
      }
      const countPath = `registrationOptionCounts.${selectedCountKey}`;
      transaction.update(formRef, {
        [`${countPath}.enrolled`]: placement.nextCounts.enrolled,
        [`${countPath}.waitlisted`]: placement.nextCounts.waitlisted,
        registrationCapacityUpdateId: registrationRef.id,
        updatedAt: serverTimestamp()
      });
      status = placement.status;
      selectedOption = placement.selectedOption;
      feeSnapshot = calculateRegistrationFeeSnapshot(latestForm, { quantity: submission.quantity || 1, now: new Date() });
    }

    const registrationRecord = buildPendingRegistrationRecord({
      form: latestForm,
      participant: submission.participant,
      guardian: submission.guardian,
      waiverAccepted: submission.waiverAccepted,
      selectedOption,
      selectedPaymentPlanId: submission.selectedPaymentPlanId,
      status,
      feeSnapshot,
      checkoutAttemptToken: submission.checkoutAttemptToken,
      now: serverTimestamp()
    });

    transaction.set(registrationRef, registrationRecord);

    return { success: true, status, registrationId: registrationRef.id, feeSnapshot: registrationRecord.feeSnapshot };
  });
}

export function getRegistrationUrl(teamId: string, formId: string) {
  return getLegacyUrl('registration.html', { teamId, formId });
}

export function getAppRegistrationUrl(teamId: string, formId: string) {
  const url = new URL('app/', legacyOrigin);
  const params = new URLSearchParams();
  if (teamId) params.set('teamId', teamId);
  if (formId) params.set('formId', formId);
  url.hash = `/registration${params.toString() ? `?${params.toString()}` : ''}`;
  return url.toString();
}

export function getCertificateUrl(teamId: string, certificateId: string) {
  return getLegacyUrl('certificates.html', {}, { teamId, certificateId });
}

export async function loadParentAccessModel(user: AuthUser | null) {
  if (!user?.uid) return { teams: [], requests: [] };
  const requests = await Promise.resolve(listMyParentMembershipRequests(user.uid));
  return {
    teams: [],
    requests: (requests || []).map(normalizeAccessRequest)
  };
}

export async function loadParentAccessTeams(): Promise<ParentAccessTeam[]> {
  const result = await Promise.resolve(discoverPublicTeams({ pageSize: 100 }));
  return normalizeAccessTeams(result?.teams);
}

export async function loadParentAccessPlayers(teamId: string): Promise<ParentAccessPlayer[]> {
  if (!teamId) return [];
  const players = await Promise.resolve(getPlayers(teamId));
  return (players || [])
    .filter((player: any) => player?.active !== false)
    .map((player: any) => ({
      id: compactString(player.id),
      name: compactString(player.name) || 'Player',
      number: compactString(player.number),
      photoUrl: player.photoUrl || null
    }))
    .filter((player: ParentAccessPlayer) => player.id)
    .sort((a: ParentAccessPlayer, b: ParentAccessPlayer) => a.name.localeCompare(b.name));
}

export async function submitParentAccessRequest(teamId: string, playerId: string, relation: string) {
  return createParentMembershipRequest(teamId, playerId, relation || 'Parent');
}

export async function loadParentFeesForApp(user: AuthUser | null): Promise<ParentFeeAppRecord[]> {
  if (!user?.uid) return [];
  const rawFees = await Promise.resolve(listParentTeamFeeRecipients(user.uid, user.parentOf || []));
  return sortParentFeeRecords(rawFees || []).map((fee: any) => toParentFeeAppRecord(fee));
}

export async function initiateParentTeamFeeCheckout(teamId: string, batchId: string, recipientId: string): Promise<{ success: true, checkoutUrl: string }> {
  if (!teamId || !batchId || !recipientId) {
    throw new Error('Missing required fields for team fee checkout.');
  }

  const checkoutUrl = await initiateTeamFeeCheckout({ teamId, batchId, recipientId });
  if (!checkoutUrl) {
    throw new Error('Failed to get checkout URL.');
  }

  return { success: true, checkoutUrl };
}

export async function loadParentCalendarTools(user: AuthUser | null, options: { force?: boolean } = {}) {
  if (!user?.uid) return { events: [], teams: [] };
  const schedule = await loadParentScheduleSummary(user, { force: options.force });
  const teamsById = new Map<string, ParentCalendarTeam>();
  (schedule.events || []).forEach((event) => {
    if (!event.teamId) return;
    const existing = teamsById.get(event.teamId);
    teamsById.set(event.teamId, {
      teamId: event.teamId,
      teamName: event.teamName || existing?.teamName || 'Team',
      eventCount: (existing?.eventCount || 0) + 1
    });
  });
  return {
    events: schedule.events || [],
    teams: [...teamsById.values()].sort((a, b) => a.teamName.localeCompare(b.teamName))
  };
}

export function buildParentScheduleIcs(events: ParentScheduleEvent[], calendarName = 'ALL PLAYS Schedule') {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ALL PLAYS//Parent App//EN',
    `X-WR-CALNAME:${escapeIcs(calendarName)}`
  ];

  (events || []).forEach((event) => {
    const start = toDate(event.date);
    if (!start) return;
    const end = toDate(event.endDate) || new Date(start.getTime() + 60 * 60 * 1000);
    const title = getScheduleTitle(event);
    const description = [
      event.teamName,
      event.type === 'practice' ? 'Practice' : 'Game',
      event.childName ? `Player: ${event.childName}` : '',
      event.notes || ''
    ].filter(Boolean).join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeIcs(event.eventKey || `${event.teamId}-${event.id}`)}@allplays.ai`,
      `DTSTAMP:${formatIcsDate(new Date())}`,
      `DTSTART:${formatIcsDate(start)}`,
      `DTEND:${formatIcsDate(end)}`,
      `SUMMARY:${escapeIcs(title)}`,
      `LOCATION:${escapeIcs(event.location || 'TBD')}`,
      `DESCRIPTION:${escapeIcs(description)}`,
      'END:VEVENT'
    );
  });

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function buildParentScheduleEventIcs(event: ParentScheduleEvent, calendarName = 'ALL PLAYS Schedule') {
  return buildParentScheduleIcs(event ? [event] : [], calendarName);
}

export function downloadIcs(filename: string, icsText: string) {
  const blob = new Blob([icsText], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = sanitizeFileName(filename || 'all-plays-schedule.ics');
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

export function buildPrivateTeamCalendarFeedUrl(teamId: string, team: Record<string, any> | null | undefined) {
  const directUrl = team?.privateCalendarFeedUrl
    || team?.calendarSubscriptionUrl
    || team?.calendarFeedUrl
    || team?.teamCalendarFeedUrl;
  if (typeof directUrl === 'string' && directUrl.trim()) {
    return directUrl.trim().replace(/^webcal:\/\//i, 'https://');
  }

  const token = team?.calendarSubscriptionToken
    || team?.privateCalendarToken
    || team?.calendarFeedToken
    || team?.teamCalendarToken;
  if (!teamId || !token) return '';

  const configured = (window as any).__ALLPLAYS_CONFIG__?.teamCalendarFeedFunctionUrl || (window as any).ALLPLAYS_TEAM_CALENDAR_FEED_URL;
  const fallback = (window as any).__ALLPLAYS_CONFIG__?.calendarFetchFunctionUrl || (window as any).ALLPLAYS_CALENDAR_FUNCTION_URL;
  const baseUrl = typeof configured === 'string' && configured.trim()
    ? configured.trim()
    : typeof fallback === 'string' && fallback.includes('fetchCalendarIcs')
      ? fallback.replace('fetchCalendarIcs', 'teamCalendarFeed')
      : 'https://us-central1-all-plays-prod.cloudfunctions.net/teamCalendarFeed';
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}teamId=${encodeURIComponent(teamId)}&token=${encodeURIComponent(token)}`;
}

export async function getPrivateTeamCalendarFeedUrl(teamId: string) {
  const teamSnap = await Promise.resolve(getTeam(teamId)).catch(() => null);
  const teamFeedUrl = buildPrivateTeamCalendarFeedUrl(teamId, teamSnap);
  if (teamFeedUrl) return teamFeedUrl;
  const token = await getNativeAuthIdToken(false).catch(() => null)
    || await firebaseAuth.currentUser?.getIdToken?.(false).catch(() => null);
  if (!teamId || !token) return '';
  const configured = (window as any).__ALLPLAYS_CONFIG__?.teamCalendarFeedFunctionUrl || (window as any).ALLPLAYS_TEAM_CALENDAR_FEED_URL;
  const fallback = (window as any).__ALLPLAYS_CONFIG__?.calendarFetchFunctionUrl || (window as any).ALLPLAYS_CALENDAR_FUNCTION_URL;
  const baseUrl = typeof configured === 'string' && configured.trim()
    ? configured.trim()
    : typeof fallback === 'string' && fallback.includes('fetchCalendarIcs')
      ? fallback.replace('fetchCalendarIcs', 'teamCalendarFeed')
      : 'https://us-central1-all-plays-prod.cloudfunctions.net/teamCalendarFeed';
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}teamId=${encodeURIComponent(teamId)}&token=${encodeURIComponent(token)}`;
}

export function getAppleCalendarFeedUrl(feedUrl: string) {
  return String(feedUrl || '').replace(/^https?:\/\//i, 'webcal://');
}

export function getGoogleCalendarFeedUrl(feedUrl: string) {
  return `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(feedUrl)}`;
}


export async function loadParentHouseholdInviteModel(user: AuthUser | null): Promise<{ linkedPlayers: ParentHouseholdLinkedPlayer[]; members: ParentHouseholdFamilyMember[] }> {
  if (!user?.uid) return { linkedPlayers: [], members: [] };
  const [linkedPlayers, members] = await Promise.all([
    Promise.resolve(normalizeFamilyChildren(user.parentOf || []) as ParentHouseholdLinkedPlayer[]),
    Promise.resolve(readFamilyMembers(user.uid))
  ]);
  return {
    linkedPlayers,
    members: (members || []).map((member: any) => ({
      ...member,
      inviteUrl: toAbsoluteLegacyUrl(member.inviteUrl)
    }))
  };
}

export async function createParentHouseholdMemberInvite(user: AuthUser | null, request: ParentHouseholdInviteRequest): Promise<ParentHouseholdInviteResult> {
  if (!user?.uid) throw new Error('Sign in before creating a household invite.');
  const linkedPlayers = normalizeFamilyChildren(user.parentOf || []) as ParentHouseholdLinkedPlayer[];
  if (!linkedPlayers.length) throw new Error('No linked players are available for household invites.');
  const selected = linkedPlayers.find((player) => `${player.teamId}::${player.playerId}` === request.playerKey);
  if (!selected) throw new Error('Choose a linked player to share.');
  const email = compactString(request.email).toLowerCase();
  const relation = compactString(request.relation);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email for the household contact.');
  if (!relation) throw new Error('Enter the household contact relation.');

  const existingMembers = await Promise.resolve(readFamilyMembers(user.uid));
  const result = await addPendingFamilyMember(user.uid, {
    email,
    displayName: compactString(request.displayName),
    relation,
    teamId: selected.teamId,
    teamName: selected.teamName,
    playerId: selected.playerId,
    playerName: selected.playerName,
    playerNumber: selected.playerNumber,
    playerPhotoUrl: selected.playerPhotoUrl
  }, { existingMembers });
  return {
    code: compactString((result as any)?.code),
    inviteUrl: toAbsoluteLegacyUrl((result as any)?.inviteUrl)
  };
}

export async function loadFamilyShareModel(user: AuthUser | null): Promise<{ children: any[]; tokens: FamilyShareTokenCard[] }> {
  if (!user?.uid) return { children: [], tokens: [] };
  const children = normalizeFamilyChildren(user.parentOf || []);
  const tokens = await Promise.resolve(listFamilyShareTokens(user.uid));
  return {
    children,
    tokens: (tokens || []).map((token: any) => ({
      ...token,
      url: getFamilyShareUrl(token.id),
      childCount: Array.isArray(token.children) ? token.children.length : 0
    }))
  };
}

export async function createParentFamilyShare(user: AuthUser | null, label: string, extraCalendarUrls: string[] = []) {
  if (!user?.uid) throw new Error('Sign in before creating a family share link.');
  const tokenId = await createFamilyShareToken(user.uid, normalizeFamilyChildren(user.parentOf || []), label, extraCalendarUrls);
  return { tokenId, url: getFamilyShareUrl(tokenId) };
}

export async function revokeParentFamilyShare(tokenId: string) {
  await revokeFamilyShareToken(tokenId);
}

export async function updateParentFamilyShareCalendars(tokenId: string, urls: string[]) {
  await updateFamilyShareTokenCalendars(tokenId, urls);
}

export async function loadParentRegistrations(user: AuthUser | null): Promise<ParentRegistrationCard[]> {
  const teamIds = getLinkedTeamIds(user);
  const cards = await Promise.all(teamIds.map(async (teamId) => {
    const [team, forms] = await Promise.all([
      Promise.resolve(getTeam(teamId)).catch(() => null),
      Promise.resolve(listTeamRegistrationForms(teamId)).catch(() => [])
    ]);
    return (forms || []).map((form: any) => toRegistrationCard(team || { id: teamId }, form));
  }));
  return cards.flat()
    .filter((card): card is ParentRegistrationCard => Boolean(card))
    .sort((a, b) => a.teamName.localeCompare(b.teamName) || a.programName.localeCompare(b.programName));
}

export async function loadTeamRegistrationQueue(
  user: AuthUser | null,
  teamId: string,
  formId: string
): Promise<TeamRegistrationQueueModel> {
  if (!canManageTeamRegistrations(user, teamId)) {
    throw new Error('Admin access is required to review registrations.');
  }

  const [reviews, rosterPlayers] = await Promise.all([
    Promise.resolve(listTeamRegistrationReviews(teamId, formId, 'all')).catch(() => []),
    Promise.resolve(getPlayers(teamId)).catch(() => [])
  ]);

  return {
    reviews: (reviews || []).map((review: any) => toTeamRegistrationReviewCard(review)),
    rosterPlayers: (rosterPlayers || []).map((player: any) => ({
      id: compactString(player.id),
      name: compactString(player.name) || 'Player',
      number: compactString(player.number)
    }))
  };
}

export async function loadTeamRegistrationQueuePage(
  teamId: string,
  formId: string,
  options: { status?: string; pageSize?: number; afterDoc?: any } = {}
): Promise<{ reviews: any[]; lastDoc: any; hasMore: boolean }> {
  const { status = 'all', pageSize = 25, afterDoc = null } = options;
  const { registrations, lastDoc, hasMore } = await listTeamRegistrationReviewsPage(teamId, formId, { status, pageSize, afterDoc });
  return {
    reviews: (registrations || []).map((review: any) => toTeamRegistrationReviewCard(review)),
    lastDoc,
    hasMore
  };
}

export async function loadTeamRegistrationRosterPlayers(
  user: AuthUser | null,
  teamId: string
): Promise<TeamRegistrationRosterPlayer[]> {
  if (!canManageTeamRegistrations(user, teamId)) {
    throw new Error('Admin access is required to review registrations.');
  }
  const rosterPlayers = await Promise.resolve(getPlayers(teamId)).catch(() => []);
  return (rosterPlayers || []).map((player: any) => ({
    id: compactString(player.id),
    name: compactString(player.name) || 'Player',
    number: compactString(player.number)
  }));
}

export async function approveTeamRegistrationForApp(
  user: AuthUser | null,
  teamId: string,
  formId: string,
  registrationId: string,
  options: { playerId?: string; decisionNote?: string } = {}
) {
  if (!canManageTeamRegistrations(user, teamId)) {
    throw new Error('Admin access is required to approve registrations.');
  }
  return approveTeamRegistration(teamId, formId, registrationId, options);
}

export async function rejectTeamRegistrationForApp(
  user: AuthUser | null,
  teamId: string,
  formId: string,
  registrationId: string,
  decisionNote = ''
) {
  if (!canManageTeamRegistrations(user, teamId)) {
    throw new Error('Admin access is required to decline registrations.');
  }
  return rejectTeamRegistration(teamId, formId, registrationId, decisionNote);
}

export async function extendTeamRegistrationOfferForApp(
  user: AuthUser | null,
  teamId: string,
  formId: string,
  registrationId: string,
  decisionNote = ''
) {
  if (!canManageTeamRegistrations(user, teamId)) {
    throw new Error('Admin access is required to manage waitlist registrations.');
  }
  return extendTeamRegistrationOffer(teamId, formId, registrationId, decisionNote);
}

export async function loadParentCertificates(user: AuthUser | null): Promise<ParentCertificateCard[]> {
  const children = normalizeFamilyChildren(user?.parentOf || []);
  const rows = await Promise.all(children.map(async (child: any) => {
    const [team, certificates] = await Promise.all([
      Promise.resolve(getTeam(child.teamId)).catch(() => null),
      Promise.resolve(listCertificatesForPlayer(child.teamId, child.playerId, { status: 'published', limit: 25 })).catch(() => [])
    ]);
    return (certificates || []).map((certificate: any) => ({
      ...certificate,
      teamId: child.teamId,
      teamName: team?.name || child.teamName || 'Team',
      playerId: child.playerId,
      playerName: child.playerName || certificate.recipientName || 'Player',
      url: getCertificateUrl(child.teamId, certificate.id)
    }));
  }));
  return rows.flat().sort((a, b) => {
    const aTime = toMillis(a.updatedAt || a.createdAt);
    const bTime = toMillis(b.updatedAt || b.createdAt);
    return bTime - aTime;
  });
}

export async function loadParentRegistrationDetail(
  user: AuthUser | null,
  teamId: string,
  formId: string
): Promise<ParentRegistrationDetailModel> {
  if (!user?.uid || !teamId || !formId) {
    throw new Error('Team and form are required.');
  }
  if (!getLinkedTeamIds(user).includes(teamId)) {
    throw new Error('Registration is not linked to your family.');
  }
  return loadRegistrationDetailModel(teamId, formId);
}

export async function loadStaffRegistrationDetail(
  user: AuthUser | null,
  teamId: string,
  formId: string
): Promise<ParentRegistrationDetailModel> {
  if (!canManageTeamRegistrations(user, teamId)) {
    throw new Error('Admin access is required to review registrations.');
  }
  return loadRegistrationDetailModel(teamId, formId);
}

export async function loadPublicRegistrationDetail(
  teamId: string,
  formId: string
): Promise<ParentRegistrationDetailModel> {
  if (!teamId || !formId) {
    throw new Error('Team and form are required.');
  }

  const formSnap = await Promise.resolve(getDoc(doc(db, 'teams', teamId, 'registrationForms', formId))).catch(() => null);

  const form = formSnap?.exists?.() ? { id: formId, ...(formSnap.data() || {}) } : null;
  if (!form) throw new Error('Registration form not found.');

  const normalizedForm = normalizeRegistrationForm(form, { teamId, formId });
  if (!normalizedForm.published || normalizedForm.status === 'closed' || normalizedForm.status === 'archived') {
    throw new Error('This registration form is not available right now.');
  }

  const feeSnapshot = calculateRegistrationFeeSnapshot(normalizedForm, { now: new Date() });
  const paymentPlans = getPaymentPlanChoices(normalizedForm);
  const paymentNotice = getRegistrationPaymentNotice(normalizedForm);
  const onlineCheckout = hasOnlineRegistrationCheckout(normalizedForm);
  const legacyUrl = getRegistrationUrl(teamId, formId);

  return {
    teamName: getPublicRegistrationTeamName(form),
    isPublished: true,
    onlineCheckout,
    legacyUrl,
    form: normalizedForm,
    options: getActiveRegistrationOptions(normalizedForm, normalizedForm.registrationOptionCounts || {}),
    feeSnapshot,
    paymentNotice,
    paymentPlans
  };
}

function getPublicRegistrationTeamName(form: Record<string, any>) {
  return compactString(form.teamName || form.team?.name || form.organizationName || form.clubName) || 'Team';
}

export async function loadTeamMediaForApp(
  user: AuthUser | null,
  teamId: string,
  options: { initialFolderId?: string; folderIds?: string[]; pageSize?: number; cursorsByFolderId?: Record<string, any> } = {}
): Promise<TeamMediaModel> {
  if (!teamId) throw new Error('Team is required.');
  const team = await Promise.resolve(getTeam(teamId));
  if (!team) throw new Error('Team not found.');
  const appUser = user ? { ...user, parentOf: user.parentOf || [] } : null;
  const teamWithId = { ...team, id: teamId };
  const canManage = canManageTeamMedia(appUser, teamWithId);
  const canContribute = canContributeTeamMedia(appUser, teamWithId);
  const canPostChat = canAccessTeamChat(appUser, teamWithId);
  const folders = await Promise.resolve(getTeamMediaFolders(teamId, { includePrivate: canManage }));
  const visibleFolders = (folders || [])
    .filter((folder: any) => canManage || canReadTeamMediaAlbum(folder, false));
  const requestedFolderIds = new Set(
    (Array.isArray(options.folderIds) ? options.folderIds : [])
      .map((folderId) => compactString(folderId))
      .filter(Boolean)
  );
  const initialFolderId = compactString(options.initialFolderId);
  if (!requestedFolderIds.size) {
    const fallbackFolderId = initialFolderId || compactString(visibleFolders[0]?.id);
    if (fallbackFolderId) requestedFolderIds.add(fallbackFolderId);
  }

  const itemSets = new Map<string, TeamMediaItem[]>();
  const fallbackCounts = new Map<string, number>();
  const pageStateByFolderId = new Map<string, { hasMore: boolean; nextCursor: any }>();
  await Promise.all(visibleFolders.map(async (folder: any) => {
    const folderId = compactString(folder?.id);
    if (!folderId) return;
    const storedCount = getStoredMediaCount(folder);
    const shouldLoadItems = requestedFolderIds.has(folderId);
    if (!shouldLoadItems) {
      if (storedCount !== null) fallbackCounts.set(folderId, storedCount);
      return;
    }
    const page = await Promise.resolve(getTeamMediaItemsPage(teamId, folderId, {
      pageSize: options.pageSize || 24,
      cursor: options.cursorsByFolderId?.[folderId] || null
    })).catch(() => ({ items: [], hasMore: false, nextCursor: null }));
    const pageItems = Array.isArray(page?.items) ? page.items : [];
    const items = sortByMediaOrder(pageItems)
      .map(toTeamMediaItem)
      .filter((item: TeamMediaItem) => item.url && isSafeTeamMediaUrl(item.url));
    fallbackCounts.set(folderId, storedCount !== null ? Math.max(storedCount, items.length) : items.length);
    pageStateByFolderId.set(folderId, {
      hasMore: page?.hasMore === true,
      nextCursor: page?.nextCursor || page?.lastDoc || null
    });
    itemSets.set(folderId, items);
  }));

  const folderCards = visibleFolders.map((folder: any) => {
    const folderId = compactString(folder?.id);
    const loadedItems = itemSets.get(folderId);
    const fallbackCount = fallbackCounts.get(folderId);
    return {
      ...folder,
      id: folderId,
      itemCount: Number.isFinite(fallbackCount) ? fallbackCount : loadedItems ? loadedItems.length : 0,
      items: loadedItems || [],
      itemsLoaded: Boolean(loadedItems),
      itemsHasMore: pageStateByFolderId.get(folderId)?.hasMore || false,
      itemsNextCursor: pageStateByFolderId.get(folderId)?.nextCursor || null
    };
  });

  return {
    team: teamWithId,
    canManage,
    canContribute,
    canPostChat,
    folders: folderCards
  };
}

export async function uploadParentTeamMediaPhoto(teamId: string, folderId: string, file: File) {
  const result = await uploadTeamMediaPhoto(teamId, folderId, file, { returnItem: true });
  return result && typeof result === 'object' ? toTeamMediaItem(result) : null;
}

export async function uploadParentTeamMediaFile(teamId: string, folderId: string, file: File) {
  const result = await uploadTeamMediaFile(teamId, folderId, file, { returnItem: true });
  return result && typeof result === 'object' ? toTeamMediaItem(result) : null;
}

export async function createTeamMediaAlbumForApp(teamId: string, draft: { name: string; visibility?: string }) {
  const name = compactString(draft?.name);
  const visibility = draft?.visibility === 'private' ? 'private' : 'team';
  return createTeamMediaFolder(teamId, { name, visibility });
}

export async function addParentTeamMediaLink(teamId: string, folderId: string, title: string, url: string) {
  return createTeamMediaLink(teamId, folderId, { title, url });
}

function normalizeAccessTeams(teams: any[]): ParentAccessTeam[] {
  return (Array.isArray(teams) ? teams : [])
    .filter((team) => team?.isPublic !== false)
    .map((team) => ({
      id: compactString(team.id || team.teamId),
      name: compactString(team.name || team.teamName) || 'Team',
      sport: compactString(team.sport),
      zip: compactString(team.zip)
    }))
    .filter((team) => team.id)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeAccessRequest(request: any): ParentAccessRequest {
  return {
    id: compactString(request.id),
    teamId: compactString(request.teamId),
    teamName: compactString(request.teamName) || 'Team',
    playerId: compactString(request.playerId),
    playerName: compactString(request.playerName) || 'Player',
    relation: compactString(request.relation) || 'Parent',
    status: compactString(request.status) || 'pending',
    decisionNote: request.decisionNote || null,
    createdAt: request.createdAt || null
  };
}

function toParentFeeAppRecord(fee: any): ParentFeeAppRecord {
  const normalized = normalizeParentFeeRecord(fee);
  const collectionMode = compactString(normalized.collectionMode);
  const checkoutUrl = compactString(normalized.checkoutUrl);
  const checkoutStatus = compactString(normalized.checkoutStatus);
  const parentFee = {
    ...normalized,
    collectionMode,
    checkoutUrl,
    checkoutStatus
  };
  const meta = getParentFeeStatusMeta(normalized.status);
  const canOpenCheckoutUrl = isParentTeamFeePayActionAllowed(parentFee) && hasReusableParentTeamFeeCheckoutUrl(parentFee);
  const checkoutInitiatable = canInitiateParentTeamFeeCheckout(parentFee);
  return {
    ...parentFee,
    amountLabel: formatParentFeeAmount(parentFee),
    dueLabel: formatParentFeeDueDate(parentFee.dueDate),
    statusLabel: meta.label,
    canPay: canOpenCheckoutUrl || checkoutInitiatable,
    checkoutInitiatable,
    paymentAction: canOpenCheckoutUrl ? 'checkoutUrl' : checkoutInitiatable ? 'createCheckout' : '',
    lineItems: getArrayField(normalized, ['lineItems', 'invoiceLineItems', 'invoiceItems', 'items']),
    installments: getArrayField(normalized, ['installments', 'installmentSchedule', 'paymentSchedule', 'scheduledPayments']),
    ledgerEntries: getArrayField(normalized, ['ledgerEntries', 'paymentLedger', 'activity', 'receipts', 'payments', 'adjustments'])
  };
}

function isOnlineParentTeamFeeCollection(fee: any) {
  const collectionMode = compactString(fee?.collectionMode).toLowerCase();
  if (!collectionMode) {
    return Boolean(compactString(fee?.checkoutUrl));
  }

  return ['online_stripe', 'stripe', 'stripe_checkout', 'online'].includes(collectionMode);
}

function hasReusableParentTeamFeeCheckoutUrl(fee: any) {
  if (!compactString(fee?.checkoutUrl)) return false;

  const checkoutStatus = compactString(fee?.checkoutStatus).toLowerCase();
  return !checkoutStatus || checkoutStatus === 'open';
}

export function isParentTeamFeePayActionAllowed(fee: any) {
  if (!isOnlineParentTeamFeeCollection(fee)) return false;

  const status = compactString(fee?.status).toLowerCase();
  if (status === 'paid' || status === 'canceled' || status === 'cancelled') return false;

  const balanceCents = Number(fee?.balanceDueCents);
  if (!Number.isFinite(balanceCents) || balanceCents <= 0) return false;

  return true;
}

export function canInitiateParentTeamFeeCheckout(fee: any) {
  return Boolean(
    isParentTeamFeePayActionAllowed(fee)
    && !hasReusableParentTeamFeeCheckoutUrl(fee)
    && compactString(fee?.teamId)
    && compactString(fee?.batchId)
    && compactString(fee?.recipientId)
  );
}

function toRegistrationCard(team: any, form: any): ParentRegistrationCard | null {
  const normalized = normalizeRegistrationForm(form, { teamId: team.id || form.teamId, formId: form.id });
  if (!normalized.published || normalized.status === 'closed' || normalized.status === 'archived') return null;
  const feeSnapshot = calculateRegistrationFeeSnapshot(normalized, { now: new Date() });
  return {
    ...normalized,
    id: normalized.id,
    teamId: normalized.teamId,
    teamName: compactString(team.name) || 'Team',
    programName: normalized.programName || 'Registration',
    description: normalized.description,
    season: normalized.season,
    feeLabel: formatCurrency(feeSnapshot.finalAmountDueCents, normalized.currency),
    paymentNotice: getRegistrationPaymentNotice(normalized),
    onlineCheckout: hasOnlineRegistrationCheckout(normalized),
    options: getActiveRegistrationOptions(normalized, normalized.registrationOptionCounts || {}),
    url: getRegistrationUrl(normalized.teamId, normalized.id),
    appUrl: getAppRegistrationUrl(normalized.teamId, normalized.id)
  };
}

function toTeamRegistrationReviewCard(review: any): TeamRegistrationReviewCard {
  const normalizedStatus = normalizeRegistrationStatus(review?.status);
  const submittedData = asObject(getRegistrationSubmittedData(review));
  const participant = {
    ...asObject(review?.participant),
    ...asObject(submittedData.participant)
  };
  const guardian = {
    ...asObject(review?.guardian),
    ...asObject(submittedData.guardian)
  };
  const guardians = getRegistrationGuardianDrafts(review) as Array<Record<string, any>>;
  const playerDraft = getRegistrationPlayerDraft(review);
  const feeSnapshot = asObject(review?.feeSnapshot);
  const selectedOption = asObject(review?.selectedOption);
  const paymentState = compactString(
    review?.paymentStatus
    || feeSnapshot.paymentStatus
    || review?.checkoutStatus
    || review?.paymentState
    || review?.payment?.status
  );
  const paymentAmount = Number(
    feeSnapshot.finalAmountDueCents
    ?? feeSnapshot.amountDueCents
    ?? feeSnapshot.feeAmountCents
    ?? review?.feeAmountCents
  );

  return {
    ...review,
    id: compactString(review?.id),
    status: normalizedStatus,
    participantName: compactString(review?.reviewSummary?.playerName || playerDraft.name || participant.name) || 'Unnamed player',
    guardianLabel: compactString(review?.reviewSummary?.guardianLabel || guardians.map((entry) => entry.email || entry.name).filter(Boolean).join(', ')),
    guardianEmails: guardians.map((entry) => compactString(entry.email)).filter(Boolean),
    participant,
    guardian,
    submittedData,
    submittedAt: review?.reviewSummary?.submittedAt || review?.submittedAt || review?.createdAt || null,
    selectedOptionLabel: compactString(selectedOption.title || selectedOption.label || review?.selectedOptionLabel || review?.selectedOptionId),
    paymentLabel: paymentState
      ? `${paymentState}${Number.isFinite(paymentAmount) ? ` · ${formatCurrency(paymentAmount, feeSnapshot.currency || review?.currency || 'USD')}` : ''}`
      : (Number.isFinite(paymentAmount) ? formatCurrency(paymentAmount, feeSnapshot.currency || review?.currency || 'USD') : 'Not recorded'),
    waiverAccepted: Boolean(
      review?.waiverAccepted
      ?? submittedData.waiverAccepted
      ?? submittedData.waiver
      ?? review?.waiver?.accepted
    ),
    linkedPlayerId: compactString(review?.linkedPlayerId),
    decisionNote: compactString(review?.decisionNote)
  };
}

function toTeamMediaItem(item: any): TeamMediaItem {
  const url = getTeamMediaItemUrl(item);
  return {
    ...item,
    id: compactString(item.id),
    url,
    title: compactString(item.title || item.fileName || item.name) || (item.type === 'file' ? 'File' : item.type === 'photo' ? 'Photo' : 'Media'),
    type: compactString(item.type || item.mediaType) || 'media'
  };
}

function getStoredMediaCount(folder: any) {
  const count = Number(folder?.itemCount ?? folder?.mediaCount ?? folder?.totalItems);
  return Number.isFinite(count) && count >= 0 ? count : null;
}

function normalizeFamilyChildren(children: any[]) {
  return (Array.isArray(children) ? children : [])
    .filter((child) => child?.teamId && child?.playerId)
    .map((child) => ({
      teamId: compactString(child.teamId),
      teamName: compactString(child.teamName),
      playerId: compactString(child.playerId),
      playerName: compactString(child.playerName),
      playerNumber: compactString(child.playerNumber || child.number),
      playerPhotoUrl: child.playerPhotoUrl || null
    }));
}

function toAbsoluteLegacyUrl(value: unknown) {
  const path = compactString(value);
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return getLegacyUrl(path.replace(/^\//, ''));
}

function getLinkedTeamIds(user: AuthUser | null) {
  return [...new Set([
    ...(Array.isArray(user?.parentOf) ? user!.parentOf.map((entry: any) => compactString(entry.teamId)) : []),
    ...(Array.isArray(user?.coachOf) ? user!.coachOf.map(compactString) : [])
  ].filter(Boolean))];
}

function canManageTeamRegistrations(user: AuthUser | null, teamId: string) {
  if (!teamId || !user) return false;
  if (Array.isArray(user.roles) && user.roles.some((role) => role === 'admin' || role === 'platformAdmin')) return true;
  return Array.isArray(user.coachOf) && user.coachOf.map(compactString).includes(teamId);
}

function getArrayField(source: any, keys: string[]) {
  for (const key of keys) {
    if (Array.isArray(source?.[key])) return source[key].filter(Boolean);
  }
  return [];
}

function escapeIcs(value: unknown) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function formatIcsDate(date: Date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function sanitizeFileName(value: string) {
  const clean = String(value || 'all-plays-schedule.ics').trim().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '');
  return clean.toLowerCase().endsWith('.ics') ? clean : `${clean || 'all-plays-schedule'}.ics`;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : typeof (value as any)?.toDate === 'function' ? (value as any).toDate() : new Date(value as any);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toMillis(value: unknown) {
  return toDate(value)?.getTime() || 0;
}

function compactString(value: unknown) {
  return String(value || '').trim();
}

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

async function loadRegistrationDetailModel(teamId: string, formId: string): Promise<ParentRegistrationDetailModel> {
  if (!teamId || !formId) {
    throw new Error('Team and form are required.');
  }
  const [team, form] = await Promise.all([
    Promise.resolve(getTeam(teamId)).catch(() => null),
    Promise.resolve(getTeamRegistrationForm(teamId, formId)).catch(() => null)
  ]);

  if (!form) throw new Error('Registration form not found.');
  if (!team) throw new Error('Team not found.');

  const normalizedForm = normalizeRegistrationForm(form, { teamId, formId });
  const feeSnapshot = calculateRegistrationFeeSnapshot(normalizedForm, { now: new Date() });
  const paymentPlans = getPaymentPlanChoices(normalizedForm);
  const paymentNotice = getRegistrationPaymentNotice(normalizedForm);
  const onlineCheckout = hasOnlineRegistrationCheckout(normalizedForm);
  const legacyUrl = getRegistrationUrl(teamId, formId);

  return {
    teamName: compactString(team.name) || 'Team',
    isPublished: normalizedForm.published && normalizedForm.status !== 'closed' && normalizedForm.status !== 'archived',
    onlineCheckout,
    legacyUrl,
    form: normalizedForm,
    options: getActiveRegistrationOptions(normalizedForm, normalizedForm.registrationOptionCounts || {}),
    feeSnapshot,
    paymentNotice,
    paymentPlans
  };
}

export async function initiateRegistrationCheckout(
  teamId: string,
  formId: string,
  registrationId: string,
  selectedOptionId: string,
  paymentPlanId: string,
  quantity: number,
  amountCents: number,
  currency: string,
  options: { checkoutAttemptToken?: string; retryPayment?: boolean; publicCheckoutCapability?: string } = {}
): Promise<{ success: true, checkoutUrl: string }> {
  if (!teamId || !formId || (!registrationId && !options.publicCheckoutCapability) || !paymentPlanId || !quantity || !amountCents || !currency) {
    throw new Error('Missing required fields for checkout.');
  }

  const result = await createRegistrationCheckoutSession(
    teamId,
    formId,
    registrationId,
    selectedOptionId,
    paymentPlanId,
    quantity,
    amountCents,
    currency,
    options.checkoutAttemptToken,
    options.retryPayment,
    options.publicCheckoutCapability
  );

  if (!result?.checkoutUrl) {
    throw new Error('Failed to get checkout URL.');
  }

  return { success: true, checkoutUrl: result.checkoutUrl };
}

export async function cancelRegistrationCheckout(
  teamId: string,
  formId: string,
  registrationId: string,
  checkoutAttemptToken = '',
  publicCheckoutCapability = ''
) {
  if (!teamId || !formId || (!registrationId && !publicCheckoutCapability)) {
    throw new Error('Missing required fields for checkout cancellation.');
  }

  return cancelStripeRegistrationCheckout({
    teamId,
    formId,
    registrationId,
    checkoutAttemptToken,
    publicCheckoutCapability
  });
}

export function getCalendarEventShareText(event: ParentScheduleEvent) {
  return [
    getScheduleTitle(event),
    formatEventDateLabel(event.date),
    formatEventTimeLabel(event.date),
    event.location || 'Location TBD'
  ].filter(Boolean).join(' - ');
}
