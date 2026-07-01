// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { HelpPortal } from './HelpPortal';
import type { AuthState } from '../lib/types';

vi.mock('../lib/helpKnowledgeService', () => ({
  getHelpKnowledgeDocs: () => [
    { id: 'doc-parent', title: 'Parent guide', summary: 'For parents', roles: ['parent'] },
    { id: 'doc-coach', title: 'Coach guide', summary: 'For coaches', roles: ['coach'] }
  ],
  searchHelpKnowledge: () => []
}));

function buildAuth(overrides: Partial<AuthState> = {}): AuthState {
  return {
    user: { uid: 'user-1', email: 'user@example.com', displayName: 'Test User', roles: [] },
    profile: null,
    loading: false,
    error: null,
    roles: [],
    isParent: false,
    isCoach: false,
    isAdmin: false,
    isPlatformAdmin: false,
    refresh: vi.fn(),
    signOut: vi.fn(),
    ...overrides
  } as AuthState;
}

describe('HelpPortal', () => {
  it('derives its default role filter from the auth prop instead of instantiating its own auth listener', () => {
    render(
      <MemoryRouter>
        <HelpPortal auth={buildAuth({ isCoach: true })} />
      </MemoryRouter>
    );

    // Only the coach-tagged doc should be visible by default for a coach user —
    // proving the role filter came from the passed-in auth prop.
    expect(screen.getByText('Coach guide')).toBeTruthy();
    expect(screen.queryByText('Parent guide')).toBeNull();
    expect(screen.getByRole('button', { name: 'Coach' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows all articles for a signed-in user with no specific role', () => {
    render(
      <MemoryRouter>
        <HelpPortal auth={buildAuth()} />
      </MemoryRouter>
    );

    expect(screen.getByText('Parent guide')).toBeTruthy();
    expect(screen.getByText('Coach guide')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
  });
});
