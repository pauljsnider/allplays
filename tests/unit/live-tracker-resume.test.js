import { describe, it, expect } from 'vitest';
import { deriveResumeClockState } from '../../js/live-tracker-resume.js';

describe('live tracker resume clock state', () => {
  it('restores period and clock from latest persisted live event by createdAt', () => {
    const result = deriveResumeClockState([
      { period: 'Q3', gameClockMs: 120000, createdAt: { toMillis: () => 1000 } },
      { period: 'Q2', gameClockMs: 45000, createdAt: { toMillis: () => 900 } },
      { period: 'Q3', gameClockMs: 150000, createdAt: { toMillis: () => 1100 } }
    ]);

    expect(result.restored).toBe(true);
    expect(result.period).toBe('Q3');
    expect(result.clock).toBe(150000);
  });

  it('falls back to defaults when no valid period/clock exists', () => {
    const result = deriveResumeClockState([
      { type: 'chat', message: 'hello' },
      { period: null, gameClockMs: undefined }
    ]);

    expect(result.restored).toBe(false);
    expect(result.period).toBe('Q1');
    expect(result.clock).toBe(0);
  });

  it('restores using period/clock progression when timestamps are unavailable', () => {
    const result = deriveResumeClockState([
      { period: 'Q1', gameClockMs: 30000 },
      { period: 'Q2', gameClockMs: 10000 },
      { period: 'Q1', gameClockMs: 45000 }
    ]);

    expect(result.restored).toBe(true);
    expect(result.period).toBe('Q2');
    expect(result.clock).toBe(10000);
  });

  it('prefers untimestamped progress over stale timestamped state in mixed datasets', () => {
    const result = deriveResumeClockState([
      { period: 'Q2', gameClockMs: 20000, createdAt: { toMillis: () => 1000 } },
      { period: 'Q2', gameClockMs: 25000, createdAt: { toMillis: () => 1100 } },
      { period: 'Q3', gameClockMs: 5000, createdAt: null }
    ]);

    expect(result.restored).toBe(true);
    expect(result.period).toBe('Q3');
    expect(result.clock).toBe(5000);
  });
});
