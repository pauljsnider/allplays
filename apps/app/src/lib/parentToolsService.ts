import {
  createFamilyShareToken,
  createParentMembershipRequest,
  createTeamMediaLink,
  getPlayers,
  getTeam,
  getTeamMediaFolders,
  getTeamMediaItems,
  getTeams,
  listCertificatesForPlayer,
  listFamilyShareTokens,
  listMyParentMembershipRequests,
  listParentTeamFeeRecipients,
  listTeamRegistrationForms,
  revokeFamilyShareToken,
  updateFamilyShareTokenCalendars,
  uploadTeamMediaFile,
  uploadTeamMediaPhoto,
} from '../../../../js/db.js';
import {
  formatParentFeeAmount,
  formatParentFeeDueDate,
  getParentFeeStatusMeta,
  normalizeParentFeeRecord,
  sortParentFeeRecords
} from '../../../../js/parent-dashboard-fees.js';
import {
  calculateRegistrationFeeSnapshot,
  getActiveRegistrationOptions,
  getRegistrationPaymentNotice,
  hasOnlineRegistrationCheckout,
  normalizeRegistrationForm
} from '../../../../js/registration-flow.js';
import {
  canContributeTeamMedia,
  canManageTeamMedia,
  canReadTeamMediaAlbum,
  getTeamMediaItemUrl,
  isSafeTeamMediaUrl,
  sortByMediaOrder
} from '../../../../js/team-media-utils.js';
import { firebaseAuth, getNativeAuthIdToken } from './authService';
import { loadParentSchedule } from './scheduleService';
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
  canPay: boolean;
  lineItems: Array<Record<string, any>>;
  installments: Array<Record<string, any>>;
  ledgerEntries: Array<Record<string, any>>;
};

export type ParentRegistrationCard = {
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
  url: string;
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
  folders: TeamMediaFolder[];
};

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

export function getRegistrationUrl(teamId: string, formId: string) {
  return getLegacyUrl('registration.html', { teamId, formId });
}

export function getCertificateUrl(teamId: string, certificateId: string) {
  return getLegacyUrl('certificates.html', {}, { teamId, certificateId });
}

export async function loadParentAccessModel(user: AuthUser | null) {
  if (!user?.uid) return { teams: [], requests: [] };
  const [teams, requests] = await Promise.all([
    Promise.resolve(getTeams({ publicOnly: true })),
    Promise.resolve(listMyParentMembershipRequests(user.uid))
  ]);
  return {
    teams: normalizeAccessTeams(teams),
    requests: (requests || []).map(normalizeAccessRequest)
  };
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

export async function loadParentCalendarTools(user: AuthUser | null) {
  if (!user?.uid) return { events: [], teams: [] };
  const schedule = await loadParentSchedule(user);
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

export async function getPrivateTeamCalendarFeedUrl(teamId: string) {
  const token = await getNativeAuthIdToken(false).catch(() => null)
    || await firebaseAuth.currentUser?.getIdToken?.(false).catch(() => null);
  if (!teamId || !token) return '';
  const configured = (window as any).__ALLPLAYS_CONFIG__?.privateTeamCalendarIcsFunctionUrl || (window as any).ALLPLAYS_PRIVATE_TEAM_CALENDAR_ICS_URL;
  const fallback = (window as any).__ALLPLAYS_CONFIG__?.calendarFetchFunctionUrl || (window as any).ALLPLAYS_CALENDAR_FUNCTION_URL;
  const baseUrl = typeof configured === 'string' && configured.trim()
    ? configured.trim()
    : typeof fallback === 'string' && fallback.includes('fetchCalendarIcs')
      ? fallback.replace('fetchCalendarIcs', 'privateTeamCalendarIcs')
      : 'https://us-central1-all-plays-prod.cloudfunctions.net/privateTeamCalendarIcs';
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}teamId=${encodeURIComponent(teamId)}&token=${encodeURIComponent(token)}`;
}

export function getAppleCalendarFeedUrl(feedUrl: string) {
  return String(feedUrl || '').replace(/^https?:\/\//i, 'webcal://');
}

export function getGoogleCalendarFeedUrl(feedUrl: string) {
  return `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(feedUrl)}`;
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

export async function loadTeamMediaForApp(user: AuthUser | null, teamId: string): Promise<TeamMediaModel> {
  if (!teamId) throw new Error('Team is required.');
  const team = await Promise.resolve(getTeam(teamId));
  if (!team) throw new Error('Team not found.');
  const appUser = user ? { ...user, parentOf: user.parentOf || [] } : null;
  const canManage = canManageTeamMedia(appUser, { ...team, id: teamId });
  const canContribute = canContributeTeamMedia(appUser, { ...team, id: teamId });
  const folders = await Promise.resolve(getTeamMediaFolders(teamId, { includePrivate: canManage }));
  const visibleFolders = (folders || [])
    .filter((folder: any) => canManage || canReadTeamMediaAlbum(folder, false));
  const itemSets = await Promise.all(visibleFolders.map((folder: any) => (
    Promise.resolve(getTeamMediaItems(teamId, folder.id)).catch(() => [])
  )));
  const folderCards = visibleFolders.map((folder: any, index: number) => {
    const items = sortByMediaOrder(itemSets[index] || [])
      .map(toTeamMediaItem)
      .filter((item: TeamMediaItem) => item.url && isSafeTeamMediaUrl(item.url));
    return {
      ...folder,
      id: folder.id,
      itemCount: items.length,
      items
    };
  });

  return {
    team: { ...team, id: teamId },
    canManage,
    canContribute,
    folders: folderCards
  };
}

export async function uploadParentTeamMediaPhoto(teamId: string, folderId: string, file: File) {
  return uploadTeamMediaPhoto(teamId, folderId, file);
}

export async function uploadParentTeamMediaFile(teamId: string, folderId: string, file: File) {
  return uploadTeamMediaFile(teamId, folderId, file);
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
  const meta = getParentFeeStatusMeta(normalized.status);
  return {
    ...normalized,
    amountLabel: formatParentFeeAmount(normalized),
    dueLabel: formatParentFeeDueDate(normalized.dueDate),
    statusLabel: meta.label,
    canPay: Boolean(normalized.checkoutUrl && !['paid', 'canceled'].includes(normalized.status) && Number(normalized.balanceDueCents ?? 1) > 0),
    lineItems: getArrayField(normalized, ['lineItems', 'invoiceLineItems', 'invoiceItems', 'items']),
    installments: getArrayField(normalized, ['installments', 'installmentSchedule', 'paymentSchedule', 'scheduledPayments']),
    ledgerEntries: getArrayField(normalized, ['ledgerEntries', 'paymentLedger', 'activity', 'receipts', 'payments', 'adjustments'])
  };
}

function toRegistrationCard(team: any, form: any): ParentRegistrationCard | null {
  const normalized = normalizeRegistrationForm(form, { teamId: team.id || form.teamId, formId: form.id });
  if (!normalized.published || normalized.status === 'closed' || normalized.status === 'archived') return null;
  const feeSnapshot = calculateRegistrationFeeSnapshot(normalized, { now: new Date() });
  return {
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
    url: getRegistrationUrl(normalized.teamId, normalized.id)
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

function normalizeFamilyChildren(children: any[]) {
  return (Array.isArray(children) ? children : [])
    .filter((child) => child?.teamId && child?.playerId)
    .map((child) => ({
      teamId: compactString(child.teamId),
      teamName: compactString(child.teamName),
      playerId: compactString(child.playerId),
      playerName: compactString(child.playerName),
      playerPhotoUrl: child.playerPhotoUrl || null
    }));
}

function getLinkedTeamIds(user: AuthUser | null) {
  return [...new Set([
    ...(Array.isArray(user?.parentOf) ? user!.parentOf.map((entry: any) => compactString(entry.teamId)) : []),
    ...(Array.isArray(user?.coachOf) ? user!.coachOf.map(compactString) : [])
  ].filter(Boolean))];
}

function getArrayField(source: any, keys: string[]) {
  for (const key of keys) {
    if (Array.isArray(source?.[key])) return source[key].filter(Boolean);
  }
  return [];
}

function formatCurrency(cents: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD'
  }).format((Number(cents) || 0) / 100);
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

export async function initiateRegistrationCheckout(
  teamId: string,
  formId: string,
  registrationId: string,
  selectedOptionId: string,
  paymentPlanId: string,
  quantity: number,
  amountCents: number,
  currency: string
): Promise<{ success: true, checkoutUrl: string }> {
  if (!teamId || !formId || !registrationId || !selectedOptionId || !paymentPlanId || !quantity || !amountCents || !currency) {
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
    currency
  );

  if (!result?.checkoutUrl) {
    throw new Error('Failed to get checkout URL.');
  }

  return { success: true, checkoutUrl: result.checkoutUrl };
}

export function getCalendarEventShareText(event: ParentScheduleEvent) {
  return [
    getScheduleTitle(event),
    formatEventDateLabel(event.date),
    formatEventTimeLabel(event.date),
    event.location || 'Location TBD'
  ].filter(Boolean).join(' - ');
}
