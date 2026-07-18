export type OpportunityKind =
  | 'team_seeking_players'
  | 'coach_or_staff'
  | 'official_or_volunteer'
  | 'player_seeking_team';

export type OpportunityStatus = 'active' | 'closed' | 'expired' | 'removed';
export type CompensationType = 'paid' | 'volunteer' | 'either' | 'not_applicable';

export type PublicOpportunity = {
  id: string;
  kind: OpportunityKind;
  title: string;
  description: string;
  sport: string;
  role: string;
  ageGroup: string;
  competitiveLevel: string;
  division: string;
  city: string;
  state: string;
  zip: string;
  availability: string;
  startDate: string;
  compensationType: CompensationType;
  compensationSummary: string;
  teamId: string | null;
  teamName: string | null;
  teamPhotoUrl: string | null;
  status: OpportunityStatus;
  createdAt: string | null;
  updatedAt: string | null;
  expiresAt: string | null;
};

export type OpportunityFilters = {
  kind?: OpportunityKind | '';
  sport?: string;
  ageGroup?: string;
  compensationType?: CompensationType | '';
  location?: string;
};

export type OpportunityInput = {
  kind: OpportunityKind;
  title: string;
  description: string;
  sport: string;
  role: string;
  ageGroup: string;
  competitiveLevel: string;
  division: string;
  city: string;
  state: string;
  zip: string;
  availability: string;
  startDate: string;
  compensationType: CompensationType;
  compensationSummary: string;
  teamId: string;
  guardianAttested: boolean;
};

export type ManagedOpportunityTeam = {
  id: string;
  name: string;
  sport: string;
  city: string;
  state: string;
  zip: string;
  ageGroup: string;
  competitiveLevel: string;
  division: string;
  availability: string;
};

export type OpportunityMessage = {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string | null;
};

export type OpportunityInquiry = {
  id: string;
  listingId: string;
  listingTitle: string;
  listingKind: OpportunityKind;
  teamId: string | null;
  participantIds: string[];
  status: 'open' | 'closed';
  createdAt: string | null;
  updatedAt: string | null;
  lastMessagePreview: string;
  lastMessageAuthorName: string;
  messages: OpportunityMessage[];
};

export type OpportunityRequiredField = {
  key: keyof OpportunityInput;
  label: string;
};

export const opportunityKinds: Array<{ id: OpportunityKind; label: string; detail: string }> = [
  { id: 'team_seeking_players', label: 'Players wanted', detail: 'A public team has roster openings.' },
  { id: 'coach_or_staff', label: 'Coach or staff job', detail: 'Paid or volunteer coaching and staff roles.' },
  { id: 'official_or_volunteer', label: 'Official or volunteer', detail: 'Officials, scorekeepers, event help, and other roles.' },
  { id: 'player_seeking_team', label: 'Looking for a team', detail: 'A guardian-safe player summary for teams to find.' }
];

export const compensationOptions: Array<{ id: CompensationType; label: string }> = [
  { id: 'not_applicable', label: 'Not applicable' },
  { id: 'paid', label: 'Paid' },
  { id: 'volunteer', label: 'Volunteer' },
  { id: 'either', label: 'Paid or volunteer' }
];

export const opportunityAvailabilityOptions = [
  'Weeknights',
  'Weekends',
  'Weeknights and weekends',
  'Weekday daytime',
  'Flexible / discuss'
] as const;

const commonRequiredOpportunityFields: OpportunityRequiredField[] = [
  { key: 'title', label: 'Title' },
  { key: 'description', label: 'Description' },
  { key: 'sport', label: 'Sport' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'availability', label: 'Availability' }
];

const opportunityInquiryKindStarters: Record<OpportunityKind, string> = {
  team_seeking_players: 'What player positions or experience are you looking for?',
  coach_or_staff: 'What experience or qualifications are you looking for?',
  official_or_volunteer: 'What dates and responsibilities need coverage?',
  player_seeking_team: "Could you share more about the player's availability and team preferences?"
};

export function getOpportunityKindLabel(kind: OpportunityKind) {
  return opportunityKinds.find((entry) => entry.id === kind)?.label || 'Opportunity';
}

export function getOpportunityInquiryStarterMessages(kind: OpportunityKind) {
  return [
    'Is this opportunity still available?',
    'What are the next steps?',
    opportunityInquiryKindStarters[kind]
  ];
}

export function formatOpportunityLocation(item: Pick<PublicOpportunity, 'city' | 'state' | 'zip'>) {
  const cityState = [item.city, item.state].filter(Boolean).join(', ');
  return [cityState, item.zip].filter(Boolean).join(' ');
}

export function formatOpportunityDate(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function emptyOpportunityInput(kind: OpportunityKind = 'team_seeking_players'): OpportunityInput {
  return {
    kind,
    title: '',
    description: '',
    sport: '',
    role: '',
    ageGroup: '',
    competitiveLevel: '',
    division: '',
    city: '',
    state: '',
    zip: '',
    availability: opportunityAvailabilityOptions[0],
    startDate: '',
    compensationType: 'not_applicable',
    compensationSummary: '',
    teamId: '',
    guardianAttested: false
  };
}

export function applyOpportunityTeamDefaults(input: OpportunityInput, team: ManagedOpportunityTeam | null | undefined): OpportunityInput {
  if (!team || input.kind === 'player_seeking_team') return input;
  const availability = input.teamId
    ? input.availability
    : team.availability || input.availability || opportunityAvailabilityOptions[0];
  return {
    ...input,
    teamId: team.id,
    sport: input.sport || team.sport,
    city: input.city || team.city,
    state: input.state || team.state,
    zip: input.zip || team.zip,
    ageGroup: input.ageGroup || team.ageGroup,
    competitiveLevel: input.competitiveLevel || team.competitiveLevel,
    division: input.division || team.division,
    availability
  };
}

const opportunityTeamDefaultKeys = [
  'sport',
  'city',
  'state',
  'zip',
  'ageGroup',
  'competitiveLevel',
  'division'
] as const;

export function switchOpportunityTeamDefaults(
  input: OpportunityInput,
  previousTeam: ManagedOpportunityTeam | null | undefined,
  nextTeam: ManagedOpportunityTeam | null | undefined
): OpportunityInput {
  if (input.kind === 'player_seeking_team') return input;
  const nextInput = { ...input, teamId: nextTeam?.id || '' };
  opportunityTeamDefaultKeys.forEach((key) => {
    const currentValue = input[key];
    const previousDefault = previousTeam?.[key] || '';
    if (!currentValue || (previousTeam && currentValue === previousDefault)) {
      nextInput[key] = nextTeam?.[key] || '';
    }
  });
  const previousAvailabilityDefault = previousTeam?.availability || opportunityAvailabilityOptions[0];
  if (!input.availability || (previousTeam && input.availability === previousAvailabilityDefault)) {
    nextInput.availability = nextTeam?.availability || opportunityAvailabilityOptions[0];
  }
  return nextInput;
}

export function getOpportunityRequiredFields(input: Pick<OpportunityInput, 'kind'>): OpportunityRequiredField[] {
  if (input.kind === 'player_seeking_team') {
    return [
      ...commonRequiredOpportunityFields,
      { key: 'ageGroup', label: 'Age group' },
      { key: 'guardianAttested', label: 'Adult/guardian confirmation' }
    ];
  }
  return [{ key: 'teamId', label: 'Public team' }, ...commonRequiredOpportunityFields];
}

export function getMissingOpportunityRequiredFields(input: OpportunityInput): OpportunityRequiredField[] {
  return getOpportunityRequiredFields(input).filter(({ key }) => {
    const value = input[key];
    return typeof value === 'boolean' ? !value : !String(value || '').trim();
  });
}

export function containsUnsafeOpportunityAiText(value: unknown) {
  const text = String(value || '');
  return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text)
    || /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.test(text)
    || /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,3}\s+(?:street|st|avenue|ave|road|rd|lane|ln|drive|dr|court|ct|boulevard|blvd)\b/i.test(text)
    || /\b(?:date of birth|birth date|dob|born on|school|academy|high school|middle school|elementary)\b/i.test(text);
}

export function opportunityToInput(item: PublicOpportunity): OpportunityInput {
  return {
    ...emptyOpportunityInput(item.kind),
    title: item.title,
    description: item.description,
    sport: item.sport,
    role: item.role,
    ageGroup: item.ageGroup,
    competitiveLevel: item.competitiveLevel,
    division: item.division,
    city: item.city,
    state: item.state,
    zip: item.zip,
    availability: item.availability,
    startDate: item.startDate,
    compensationType: item.compensationType,
    compensationSummary: item.compensationSummary,
    teamId: item.teamId || '',
    guardianAttested: item.kind === 'player_seeking_team'
  };
}
