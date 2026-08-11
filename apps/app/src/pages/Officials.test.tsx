// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const scheduleMocks = vi.hoisted(() => ({
  claimOfficialAssignmentItem: vi.fn(),
  loadOfficialAssignments: vi.fn(),
  respondToOfficialAssignmentItem: vi.fn()
}));

vi.mock('../lib/scheduleService', () => scheduleMocks);
vi.mock('../lib/parentWorkflowTiming', () => ({
  completeParentCoreWorkflowTimer: vi.fn()
}));

import { Officials } from './Officials';

describe('Officials partial native access', () => {
  const auth = {
    loading: false,
    user: {
      uid: 'user-1',
      email: 'parent@example.test',
      displayName: 'Pat Parent',
      roles: []
    },
    roles: [],
    signOut: vi.fn()
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows verified assignments as a warning rather than an access error', async () => {
    scheduleMocks.loadOfficialAssignments.mockResolvedValue({
      hasAccess: true,
      teamIds: ['team-1'],
      teamCount: 1,
      isPartial: true,
      assignments: []
    });

    render(
      <MemoryRouter initialEntries={['/officials']}>
        <Routes>
          <Route path="/officials" element={<Officials auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('Showing assignments for 1 verified linked team. Some linked-team data could not refresh; retry later for a complete list.')).toBeTruthy();
    expect(screen.queryByText(/could not be verified/i)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Assignments' })).toBeTruthy();
  });
});
