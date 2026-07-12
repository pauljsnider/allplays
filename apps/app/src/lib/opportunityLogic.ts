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
  messages: OpportunityMessage[];
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

export function getOpportunityKindLabel(kind: OpportunityKind) {
  return opportunityKinds.find((entry) => entry.id === kind)?.label || 'Opportunity';
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
    availability: '',
    startDate: '',
    compensationType: 'not_applicable',
    compensationSummary: '',
    teamId: '',
    guardianAttested: false
  };
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
