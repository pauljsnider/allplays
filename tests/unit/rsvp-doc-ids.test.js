import { describe, it, expect } from 'vitest';
import { buildCoachOverrideRsvpDocId, shouldDeleteLegacyRsvpForOverride } from '../../js/rsvp-doc-ids.js';

describe('rsvp doc id helpers', () => {
  it('builds player-specific override doc ids', () => {
    expect(buildCoachOverrideRsvpDocId('coach123', 'player456')).toBe('coach123__player456');
  });

  it('returns empty string when user or player id is missing', () => {
    expect(buildCoachOverrideRsvpDocId('', 'player456')).toBe('');
    expect(buildCoachOverrideRsvpDocId('coach123', '')).toBe('');
  });

  it('deletes only matching single-player legacy RSVP docs on override', () => {
    expect(shouldDeleteLegacyRsvpForOverride(
      { playerIds: ['player456'] },
      'player456'
    )).toBe(true);
  });

  it('keeps multi-player parent RSVP docs when overriding one player', () => {
    expect(shouldDeleteLegacyRsvpForOverride(
      { playerIds: ['player123', 'player456'] },
      'player123'
    )).toBe(false);
  });

  it('keeps non-matching or ambiguous legacy docs', () => {
    expect(shouldDeleteLegacyRsvpForOverride(
      { playerIds: ['player999'] },
      'player456'
    )).toBe(false);
    expect(shouldDeleteLegacyRsvpForOverride({}, 'player456')).toBe(false);
  });
});
