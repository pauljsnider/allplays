import { describe, it, expect } from 'vitest';
import { buildCoachOverrideRsvpDocId } from '../../js/rsvp-doc-ids.js';

describe('rsvp doc id helpers', () => {
  it('builds player-specific override doc ids', () => {
    expect(buildCoachOverrideRsvpDocId('coach123', 'player456')).toBe('coach123__player456');
  });

  it('returns empty string when user or player id is missing', () => {
    expect(buildCoachOverrideRsvpDocId('', 'player456')).toBe('');
    expect(buildCoachOverrideRsvpDocId('coach123', '')).toBe('');
  });
});
