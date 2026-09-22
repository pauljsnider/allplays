// @vitest-environment jsdom
import { Suspense } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AuthState } from '../lib/types';
import { DiamondScorebookRoute } from './DiamondScorebookRoute';

const mocks = vi.hoisted(() => ({ mount: vi.fn() }));
vi.mock('./DiamondScorebook', () => ({
  DiamondScorebook: () => {
    mocks.mount();
    return <div>Enabled scorer</div>;
  }
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (window as unknown as Record<string, unknown>).__ALLPLAYS_CONFIG__;
});

function openDirectLink() {
  render(
    <MemoryRouter initialEntries={['/schedule/team-1/game-1/diamond-v2']}>
      <Suspense fallback={<div>Loading</div>}>
        <Routes>
          <Route
            path="/schedule/:teamId/:eventId/diamond-v2"
            element={<DiamondScorebookRoute auth={{ user: { uid: 'coach-1' } } as AuthState} />}
          />
          <Route path="/schedule" element={<div>Schedule fallback</div>} />
        </Routes>
      </Suspense>
    </MemoryRouter>
  );
}

describe('Diamond direct-route rollout boundary', () => {
  it.each([undefined, false, 'true'])('does not mount scorer for runtime flag %s', (flag) => {
    (window as unknown as Record<string, unknown>).__ALLPLAYS_CONFIG__ = { diamondScorebookUiEnabled: flag };
    openDirectLink();
    expect(screen.getByText('Schedule fallback')).toBeInTheDocument();
    expect(mocks.mount).not.toHaveBeenCalled();
  });
  it('allows the scorer only for an explicit enabled rollout', async () => {
    (window as unknown as Record<string, unknown>).__ALLPLAYS_CONFIG__ = { diamondScorebookUiEnabled: true };
    openDirectLink();
    expect(await screen.findByText('Enabled scorer')).toBeInTheDocument();
  });
});
