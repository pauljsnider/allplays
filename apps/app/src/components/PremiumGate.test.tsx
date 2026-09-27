// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PremiumGate } from './PremiumGate';

describe('PremiumGate', () => {
  it('renders protected content when access is unlocked', () => {
    render(
      <PremiumGate access={{ state: 'unlocked', reason: 'global-open' }}>
        <div>Advanced analytics</div>
      </PremiumGate>
    );
    expect(screen.getByText('Advanced analytics')).toBeTruthy();
    expect(screen.queryByText('Premium access required')).toBeNull();
  });

  it('replaces protected content with a locked message when entitlement enforcement is on', () => {
    render(
      <PremiumGate access={{ state: 'locked', reason: 'missing-valid-entitlement' }} label="team leaderboards">
        <div>Secret leaderboard</div>
      </PremiumGate>
    );
    expect(screen.queryByText('Secret leaderboard')).toBeNull();
    expect(screen.getByText('Premium access required')).toBeTruthy();
    expect(screen.getByText(/active premium entitlement is required for team leaderboards/i)).toBeTruthy();
  });

  it('distinguishes loading and unavailable verification states', () => {
    const { rerender } = render(
      <PremiumGate access={{ state: 'loading', reason: 'premium-access-loading' }}>
        <div>Protected</div>
      </PremiumGate>
    );
    expect(screen.getByText('Checking premium access')).toBeTruthy();

    rerender(
      <PremiumGate access={{ state: 'unavailable', reason: 'global-config-read-failed' }}>
        <div>Protected</div>
      </PremiumGate>
    );
    expect(screen.getByText('Premium access unavailable')).toBeTruthy();
  });
});
