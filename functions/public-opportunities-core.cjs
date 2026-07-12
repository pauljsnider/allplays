const OPPORTUNITY_KINDS = new Set([
  'team_seeking_players',
  'coach_or_staff',
  'official_or_volunteer',
  'player_seeking_team'
]);

const COMPENSATION_TYPES = new Set(['paid', 'volunteer', 'either', 'not_applicable']);
const OPPORTUNITY_STATUSES = new Set(['active', 'closed', 'removed']);
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function cleanText(value, maxLength = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeKey(value, maxLength = 80) {
  return cleanText(value, maxLength).toLowerCase();
}

function normalizeOpportunityFilters(value = {}) {
  return {
    kind: OPPORTUNITY_KINDS.has(value.kind) ? value.kind : '',
    sport: normalizeKey(value.sport),
    ageGroup: normalizeKey(value.ageGroup),
    compensationType: COMPENSATION_TYPES.has(value.compensationType) ? value.compensationType : '',
    location: normalizeKey(value.location, 120)
  };
}

function containsUnsafePublicContact(text) {
  const value = String(text || '');
  return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value) ||
    /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.test(value) ||
    /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,3}\s+(?:street|st|avenue|ave|road|rd|lane|ln|drive|dr|court|ct|boulevard|blvd)\b/i.test(value);
}

function containsUnsafeYouthIdentity(text) {
  const value = String(text || '');
  return containsUnsafePublicContact(value) ||
    /\b(?:date of birth|birth date|dob|born on|school|academy|high school|middle school|elementary)\b/i.test(value) ||
    /\b(?:name is|named)\s+[A-Z][a-z]{1,30}\b/.test(value) ||
    /\bmy\s+(?:son|daughter|child|player|athlete)\s+(?:is\s+)?[A-Z][a-z]{1,30}\b/.test(value);
}

function normalizeOpportunityInput(value = {}) {
  const kind = OPPORTUNITY_KINDS.has(value.kind) ? value.kind : '';
  const input = {
    kind,
    title: cleanText(value.title, 100),
    description: cleanText(value.description, 1500),
    sport: cleanText(value.sport, 60),
    role: cleanText(value.role, 80),
    ageGroup: cleanText(value.ageGroup, 40),
    competitiveLevel: cleanText(value.competitiveLevel, 60),
    division: cleanText(value.division, 60),
    city: cleanText(value.city, 80),
    state: cleanText(value.state, 40),
    zip: cleanText(value.zip, 10),
    availability: cleanText(value.availability, 240),
    startDate: cleanText(value.startDate, 20),
    compensationType: COMPENSATION_TYPES.has(value.compensationType) ? value.compensationType : 'not_applicable',
    compensationSummary: cleanText(value.compensationSummary, 160),
    teamId: cleanText(value.teamId, 160),
    guardianAttested: value.guardianAttested === true
  };

  if (!input.kind) throw new Error('Choose a valid opportunity type.');
  if (!input.title) throw new Error('Add a title.');
  if (!input.description) throw new Error('Add a description.');
  if (!input.sport) throw new Error('Choose a sport.');
  if (!input.city || !input.state) throw new Error('Add a city and state.');
  if (input.zip && !/^\d{5}(?:-\d{4})?$/.test(input.zip)) throw new Error('Enter a valid ZIP code.');
  const displayedText = [
    input.title,
    input.description,
    input.sport,
    input.role,
    input.ageGroup,
    input.competitiveLevel,
    input.division,
    input.city,
    input.state,
    input.zip,
    input.availability,
    input.startDate,
    input.compensationSummary
  ].join(' ');
  if (containsUnsafePublicContact(displayedText)) {
    throw new Error('Public listings cannot include an email address, phone number, or exact street address.');
  }

  if (kind === 'player_seeking_team') {
    if (!input.guardianAttested) throw new Error('Confirm that you are an adult or legal guardian.');
    if (!input.ageGroup) throw new Error('Add the player age group.');
    if (input.teamId) throw new Error('Looking-for-team listings cannot be posted as a team.');
    if (containsUnsafeYouthIdentity(displayedText)) {
      throw new Error('Remove names, school details, birth information, contact details, and exact addresses from the youth listing.');
    }
    input.title = `${input.ageGroup} ${input.sport} player looking for a team`;
    input.compensationType = 'not_applicable';
    input.compensationSummary = '';
  } else if (!input.teamId) {
    throw new Error('Choose the public team represented by this listing.');
  }

  return {
    ...input,
    sportKey: normalizeKey(input.sport),
    ageGroupKey: normalizeKey(input.ageGroup),
    locationKey: normalizeKey([input.city, input.state, input.zip].filter(Boolean).join(' '), 160)
  };
}

function getMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function getEffectiveOpportunityStatus(listing, now = Date.now()) {
  const status = OPPORTUNITY_STATUSES.has(listing?.status) ? listing.status : 'closed';
  if (status === 'active' && getMillis(listing?.expiresAt) <= now) return 'expired';
  return status;
}

function matchesOpportunityFilters(listing, filters = {}, now = Date.now()) {
  if (getEffectiveOpportunityStatus(listing, now) !== 'active') return false;
  const normalized = normalizeOpportunityFilters(filters);
  if (normalized.kind && listing.kind !== normalized.kind) return false;
  if (normalized.sport && normalizeKey(listing.sport) !== normalized.sport) return false;
  if (normalized.ageGroup && normalizeKey(listing.ageGroup) !== normalized.ageGroup) return false;
  if (normalized.compensationType && listing.compensationType !== normalized.compensationType) return false;
  if (normalized.location) {
    const haystack = normalizeKey(`${listing.city || ''} ${listing.state || ''} ${listing.zip || ''}`, 180);
    if (!haystack.includes(normalized.location)) return false;
  }
  return true;
}

function toIso(value) {
  const millis = getMillis(value);
  return millis ? new Date(millis).toISOString() : null;
}

function serializePublicOpportunity(id, listing, now = Date.now()) {
  return {
    id,
    kind: listing.kind,
    title: cleanText(listing.title, 100),
    description: cleanText(listing.description, 1500),
    sport: cleanText(listing.sport, 60),
    role: cleanText(listing.role, 80),
    ageGroup: cleanText(listing.ageGroup, 40),
    competitiveLevel: cleanText(listing.competitiveLevel, 60),
    division: cleanText(listing.division, 60),
    city: cleanText(listing.city, 80),
    state: cleanText(listing.state, 40),
    zip: cleanText(listing.zip, 10),
    availability: cleanText(listing.availability, 240),
    startDate: cleanText(listing.startDate, 20),
    compensationType: COMPENSATION_TYPES.has(listing.compensationType) ? listing.compensationType : 'not_applicable',
    compensationSummary: cleanText(listing.compensationSummary, 160),
    teamId: cleanText(listing.teamId, 160) || null,
    teamName: cleanText(listing.teamName, 100) || null,
    teamPhotoUrl: cleanText(listing.teamPhotoUrl, 1000) || null,
    status: getEffectiveOpportunityStatus(listing, now),
    createdAt: toIso(listing.createdAt),
    updatedAt: toIso(listing.updatedAt),
    expiresAt: toIso(listing.expiresAt)
  };
}

function buildOpportunityExpiry(now = Date.now()) {
  return new Date(now + THIRTY_DAYS_MS);
}

module.exports = {
  OPPORTUNITY_KINDS,
  COMPENSATION_TYPES,
  THIRTY_DAYS_MS,
  cleanText,
  normalizeKey,
  normalizeOpportunityFilters,
  normalizeOpportunityInput,
  containsUnsafePublicContact,
  containsUnsafeYouthIdentity,
  getEffectiveOpportunityStatus,
  matchesOpportunityFilters,
  serializePublicOpportunity,
  buildOpportunityExpiry,
  getMillis
};
