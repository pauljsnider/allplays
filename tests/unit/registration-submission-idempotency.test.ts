import { describe, expect, it, vi } from 'vitest';
import { getOrCreateRegistrationSubmissionAttempt } from '../../apps/app/src/lib/registrationSubmissionIdempotency';

describe('public registration submission idempotency', () => {
  it('reuses a token for a semantic retry even when object key order changes', () => {
    const tokenFactory = vi.fn()
      .mockReturnValueOnce('token_1234567890123456')
      .mockReturnValueOnce('token_abcdefabcdefabcd');
    const first = getOrCreateRegistrationSubmissionAttempt(null, {
      participant: { firstName: 'Sam', lastName: 'Player' },
      guardian: { email: 'parent@example.com' }
    }, tokenFactory);
    const retry = getOrCreateRegistrationSubmissionAttempt(first, {
      guardian: { email: 'parent@example.com' },
      participant: { lastName: 'Player', firstName: 'Sam' }
    }, tokenFactory);

    expect(retry).toBe(first);
    expect(tokenFactory).toHaveBeenCalledTimes(1);
  });

  it('rotates the token when applicant-controlled submission data changes', () => {
    const tokenFactory = vi.fn()
      .mockReturnValueOnce('token_1234567890123456')
      .mockReturnValueOnce('token_abcdefabcdefabcd');
    const first = getOrCreateRegistrationSubmissionAttempt(null, { quantity: 1 }, tokenFactory);
    const changed = getOrCreateRegistrationSubmissionAttempt(first, { quantity: 2 }, tokenFactory);

    expect(changed.token).not.toBe(first.token);
    expect(tokenFactory).toHaveBeenCalledTimes(2);
  });
});
