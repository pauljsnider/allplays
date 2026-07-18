import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
const parentDashboardSource = readFileSync(new URL('../../parent-dashboard.html', import.meta.url), 'utf8');
const scheduleServiceSource = readFileSync(new URL('../../apps/app/src/lib/scheduleService.ts', import.meta.url), 'utf8');
const parentControlsSource = readFileSync(new URL('../../js/parent-dashboard-rsvp-controls.js', import.meta.url), 'utf8');
const gameDayControlsSource = readFileSync(new URL('../../js/game-day-rsvp-controls.js', import.meta.url), 'utf8');

function slice(startMarker, endMarker) {
  const start = dbSource.indexOf(startMarker);
  const end = dbSource.indexOf(endMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return dbSource.slice(start, end);
}

describe('RSVP own-read projection', () => {
  it('loads only exact user/player documents for parents and never lists the RSVP collection', () => {
    const ownRead = slice('export async function getMyRsvps', 'export async function getMyRsvp(');
    expect(ownRead).toContain('Promise.allSettled');
    expect(ownRead).toContain('getDoc(doc(db, collectionPath, rsvpId))');
    expect(ownRead).not.toContain('getDocs(');
    expect(parentDashboardSource).toContain('getMyRsvps(teamId, gameId, userId, linkedPlayerIds)');
    expect(parentDashboardSource).not.toContain('getRsvps(teamId, gameId)');
    expect(scheduleServiceSource).toContain('loadCachedOwnEventHydrationDetails(matchingEvents, user.uid)');
  });

  it('never derives persisted RSVP display names from email addresses', () => {
    const writes = slice('export async function submitRsvp(', 'export async function getRsvps(');
    expect(writes).toContain('normalizeRsvpDisplayName(displayName)');
    expect(writes).not.toMatch(/displayName\s*:\s*[^,\n]*email/);
    expect(parentControlsSource).not.toContain('currentUser?.displayName || currentUser?.email');
    expect(gameDayControlsSource).not.toContain('state.user?.displayName || state.user?.email');
  });
});
