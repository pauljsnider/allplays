// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpportunityForm } from './OpportunityForm';
import type { AuthState } from '../lib/types';

const serviceMocks = vi.hoisted(() => ({
  createPublicOpportunity: vi.fn(),
  getPublicOpportunity: vi.fn(),
  listManagedPublicOpportunityTeams: vi.fn(),
  updatePublicOpportunity: vi.fn()
}));
const aiMocks = vi.hoisted(() => ({
  enhanceOpportunityDraft: vi.fn(),
  applyOpportunityAiSuggestion: vi.fn((input, suggestion) => ({ ...input, ...suggestion }))
}));

vi.mock('../lib/opportunityService', () => serviceMocks);
vi.mock('../lib/opportunityAiService', () => aiMocks);

const auth = {
  user: { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', emailVerified: true, roles: ['coach'] },
  profile: null,
  loading: false,
  error: null,
  roles: ['coach'],
  isParent: false,
  isCoach: true,
  isAdmin: false,
  isPlatformAdmin: false,
  refresh: vi.fn(),
  signOut: vi.fn()
} as AuthState;

const team = {
  id: 'team-1',
  name: 'Bears',
  sport: 'Basketball',
  city: 'Austin',
  state: 'TX',
  zip: '78701',
  ageGroup: '12U',
  competitiveLevel: 'Travel',
  division: 'Gold',
  availability: 'Weekends'
};

function renderForm() {
  return render(
    <MemoryRouter initialEntries={['/discover/new']}>
      <Routes><Route path="/discover/new" element={<OpportunityForm auth={auth} />} /></Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  serviceMocks.listManagedPublicOpportunityTeams.mockResolvedValue([team]);
  serviceMocks.getPublicOpportunity.mockResolvedValue(null);
});

afterEach(() => cleanup());

describe('OpportunityForm', () => {
  it('selects the first eligible team, fills team details, and chooses the first availability option', async () => {
    renderForm();
    const teamSelect = await screen.findByRole('combobox', { name: /Public team/ }) as HTMLSelectElement;
    expect(teamSelect.value).toBe('team-1');
    expect((screen.getByRole('textbox', { name: /Sport/ }) as HTMLInputElement).value).toBe('Basketball');
    expect((screen.getByRole('textbox', { name: /City/ }) as HTMLInputElement).value).toBe('Austin');
    expect((screen.getByRole('combobox', { name: /Availability/ }) as HTMLSelectElement).value).toBe('Weeknights');
    expect(screen.getByRole('status').textContent).toContain('5 of 7 complete');
  });

  it('applies an editable AI title and description', async () => {
    aiMocks.enhanceOpportunityDraft.mockResolvedValue({
      title: 'Assistant coach for 12U Bears',
      description: 'Help lead practices and support weekend games.'
    });
    renderForm();
    await screen.findByRole('heading', { name: 'Post an opportunity' });
    fireEvent.click(screen.getByRole('button', { name: 'Enhance with AI' }));

    await waitFor(() => expect(aiMocks.enhanceOpportunityDraft).toHaveBeenCalled());
    expect((screen.getByRole('textbox', { name: /Title/ }) as HTMLInputElement).value).toBe('Assistant coach for 12U Bears');
    expect((screen.getByRole('textbox', { name: /Description/ }) as HTMLTextAreaElement).value).toContain('Help lead practices');
    expect(screen.getByText(/AI suggestions applied/)).toBeTruthy();
  });

  it('keeps the current draft unchanged when AI is unavailable', async () => {
    aiMocks.enhanceOpportunityDraft.mockRejectedValue(new Error('AI is unavailable.'));
    renderForm();
    const title = await screen.findByRole('textbox', { name: /Title/ }) as HTMLInputElement;
    fireEvent.change(title, { target: { value: 'My original title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enhance with AI' }));

    expect(await screen.findByText('AI is unavailable.')).toBeTruthy();
    expect(title.value).toBe('My original title');
  });
});
