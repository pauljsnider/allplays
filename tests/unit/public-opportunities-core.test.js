import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  THIRTY_DAYS_MS,
  buildOpportunityExpiry,
  containsUnsafePublicContact,
  getEffectiveOpportunityStatus,
  matchesOpportunityFilters,
  normalizeOpportunityInput,
  serializePublicOpportunity
} = require('../../functions/public-opportunities-core.cjs');

const teamInput = {
  kind: 'coach_or_staff',
  title: 'Assistant coach wanted',
  description: 'Help lead two weeknight practices and weekend games.',
  sport: 'Basketball',
  role: 'Assistant coach',
  ageGroup: '12U',
  competitiveLevel: 'Travel',
  city: 'Austin',
  state: 'TX',
  zip: '78701',
  teamId: 'team-1',
  compensationType: 'paid'
};

describe('public sports opportunity core', () => {
  it('normalizes valid team opportunities and enforces a linked team', () => {
    expect(normalizeOpportunityInput(teamInput)).toEqual(expect.objectContaining({
      kind: 'coach_or_staff',
      sportKey: 'basketball',
      ageGroupKey: '12u',
      locationKey: 'austin tx 78701'
    }));
    expect(() => normalizeOpportunityInput({ ...teamInput, teamId: '' })).toThrow(/Choose the public team/);
  });

  it('requires guardian attestation and rejects youth identity/contact details', () => {
    const playerInput = {
      ...teamInput,
      kind: 'player_seeking_team',
      title: '12U player looking for a team',
      description: 'Guard looking for a competitive team with weekend games.',
      teamId: '',
      guardianAttested: true,
      compensationType: 'not_applicable'
    };
    expect(normalizeOpportunityInput(playerInput).kind).toBe('player_seeking_team');
    expect(() => normalizeOpportunityInput({ ...playerInput, guardianAttested: false })).toThrow(/adult or legal guardian/);
    expect(() => normalizeOpportunityInput({ ...playerInput, description: 'My child attends North Middle School.' })).toThrow(/school details/);
    expect(() => normalizeOpportunityInput({ ...playerInput, description: 'Call 512-555-1212.' })).toThrow(/email address, phone number/);
  });

  it('detects public contact details and exact street addresses', () => {
    expect(containsUnsafePublicContact('coach@example.com')).toBe(true);
    expect(containsUnsafePublicContact('512.555.1212')).toBe(true);
    expect(containsUnsafePublicContact('123 Main Street')).toBe(true);
    expect(containsUnsafePublicContact('Austin, TX 78701')).toBe(false);
    expect(() => normalizeOpportunityInput({ ...teamInput, role: 'Email coach@example.com' })).toThrow(/email address, phone number/);
    expect(() => normalizeOpportunityInput({ ...teamInput, division: 'Meet at 123 Main Street' })).toThrow(/exact street address/);
  });

  it('screens every displayed youth field for identity details', () => {
    expect(() => normalizeOpportunityInput({
      ...teamInput,
      kind: 'player_seeking_team',
      teamId: '',
      guardianAttested: true,
      division: 'North Middle School',
      compensationType: 'not_applicable'
    })).toThrow(/school details/);
  });

  it('expires listings after thirty days and filters active results', () => {
    const now = Date.UTC(2026, 0, 1);
    const listing = { ...teamInput, status: 'active', expiresAt: new Date(now + 1000) };
    expect(getEffectiveOpportunityStatus(listing, now)).toBe('active');
    expect(getEffectiveOpportunityStatus(listing, now + 1001)).toBe('expired');
    expect(matchesOpportunityFilters(listing, { sport: 'basketball', location: 'austin' }, now)).toBe(true);
    expect(matchesOpportunityFilters(listing, { location: 'Austin, TX' }, now)).toBe(true);
    expect(matchesOpportunityFilters(listing, { location: 'Austin, TX 78701' }, now)).toBe(true);
    expect(matchesOpportunityFilters(listing, { sport: 'soccer' }, now)).toBe(false);
    expect(buildOpportunityExpiry(now).getTime()).toBe(now + THIRTY_DAYS_MS);
  });

  it('returns only the explicit public projection', () => {
    const item = serializePublicOpportunity('listing-1', {
      ...teamInput,
      authorId: 'private-user',
      recipientUserIds: ['private-user'],
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      expiresAt: new Date('2026-01-31T00:00:00Z'),
      status: 'active'
    }, Date.parse('2026-01-02T00:00:00Z'));
    expect(item.id).toBe('listing-1');
    expect(item).not.toHaveProperty('authorId');
    expect(item).not.toHaveProperty('recipientUserIds');
  });
});
