// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Discover } from './Discover';
import { OpportunityDetail } from './OpportunityDetail';
import type { AuthState } from '../lib/types';

const opportunityMocks = vi.hoisted(() => ({
  listPublicOpportunities: vi.fn(),
  getPublicOpportunity: vi.fn(),
  createOpportunityInquiry: vi.fn(),
  reportPublicOpportunity: vi.fn()
}));

vi.mock('../lib/opportunityService', () => opportunityMocks);
vi.mock('../components/PublicTeamSearch', () => ({ PublicTeamSearch: () => <div>Public team finder</div> }));

const signedOutAuth = {
  user: null,
  profile: null,
  loading: false,
  error: null,
  roles: [],
  isParent: false,
  isCoach: false,
  isAdmin: false,
  isPlatformAdmin: false,
  refresh: vi.fn(),
  signOut: vi.fn()
} as AuthState;

const signedInAuth = {
  ...signedOutAuth,
  user: { uid: 'user-1', email: 'user@example.com', displayName: 'User', emailVerified: true, roles: ['parent'] },
  roles: ['parent'],
  isParent: true
} as AuthState;

const listing = {
  id: 'listing-1',
  kind: 'coach_or_staff',
  title: 'Assistant coach wanted',
  description: 'Help with practices and weekend games.',
  sport: 'Basketball',
  role: 'Assistant coach',
  ageGroup: '12U',
  competitiveLevel: 'Travel',
  division: '',
  city: 'Austin',
  state: 'TX',
  zip: '78701',
  availability: 'Weeknights',
  startDate: '2026-08-01',
  compensationType: 'paid',
  compensationSummary: 'Stipend',
  teamId: 'team-1',
  teamName: 'Bears',
  teamPhotoUrl: null,
  status: 'active',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  expiresAt: '2026-07-31T00:00:00.000Z'
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  opportunityMocks.listPublicOpportunities.mockResolvedValue({ items: [listing], nextCursor: null });
  opportunityMocks.getPublicOpportunity.mockResolvedValue(listing);
});

afterEach(() => cleanup());

describe('public Discover experience', () => {
  it('lets anonymous visitors browse opportunities and switch to teams', async () => {
    render(<MemoryRouter initialEntries={['/discover']}><Discover auth={signedOutAuth} /></MemoryRouter>);
    expect(await screen.findByText('Assistant coach wanted')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in to post' }).getAttribute('href')).toBe('/auth?next=%2Fdiscover%2Fnew');
    fireEvent.click(screen.getByRole('button', { name: /Teams/ }));
    expect(await screen.findByText('Public team finder')).toBeTruthy();
  });

  it('keeps public contact details private and routes anonymous contact through sign-in', async () => {
    render(
      <MemoryRouter initialEntries={['/discover/opportunities/listing-1']}>
        <Routes>
          <Route path="/discover/opportunities/:listingId" element={<OpportunityDetail auth={signedOutAuth} />} />
          <Route path="/auth" element={<div>Sign-in route</div>} />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByRole('heading', { name: 'Assistant coach wanted' })).toBeTruthy();
    expect(screen.queryByText(/user@example.com/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to contact' }));
    expect(await screen.findByText('Sign-in route')).toBeTruthy();
  });

  it('creates a private inquiry for signed-in users', async () => {
    opportunityMocks.createOpportunityInquiry.mockResolvedValue({ id: 'inquiry-1' });
    render(
      <MemoryRouter initialEntries={['/discover/opportunities/listing-1']}>
        <Routes>
          <Route path="/discover/opportunities/:listingId" element={<OpportunityDetail auth={signedInAuth} />} />
          <Route path="/discover/inquiries/:inquiryId" element={<div>Private inquiry thread</div>} />
        </Routes>
      </MemoryRouter>
    );
    await screen.findByRole('heading', { name: 'Assistant coach wanted' });
    fireEvent.click(screen.getByRole('button', { name: 'Send private inquiry' }));
    fireEvent.change(screen.getByPlaceholderText(/Introduce yourself/), { target: { value: 'Is this role still open?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send inquiry' }));
    await waitFor(() => expect(opportunityMocks.createOpportunityInquiry).toHaveBeenCalledWith('listing-1', 'Is this role still open?'));
    expect(await screen.findByText('Private inquiry thread')).toBeTruthy();
  });

  it('clears the prior opportunity when a new route fails to load', async () => {
    opportunityMocks.getPublicOpportunity.mockImplementation((listingId: string) => listingId === 'listing-1'
      ? Promise.resolve(listing)
      : Promise.reject(new Error('Opportunity not found.')));
    render(
      <MemoryRouter initialEntries={['/discover/opportunities/listing-1']}>
        <Link to="/discover/opportunities/missing-listing">Next opportunity</Link>
        <Routes>
          <Route path="/discover/opportunities/:listingId" element={<OpportunityDetail auth={signedOutAuth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Assistant coach wanted' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Next opportunity' }));
    expect(await screen.findByText('Opportunity not found.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Assistant coach wanted' })).toBeNull();
  });
});
