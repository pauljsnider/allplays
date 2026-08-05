import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { extractMatchBlock } from '../../scripts/validate-firebase-rules-ci.mjs';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const gamesBlock = extractMatchBlock(rules, 'match /games/{gameId} {');

function extractNestedBlock(source, startMarker) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`Missing block: ${startMarker}`);
  const openBrace = start + startMarker.length - 1;
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unclosed block: ${startMarker}`);
}

describe('rideshare request privacy Firestore rules', () => {
  it('separates manager list access from exact household get access', () => {
    const offersBlock = extractNestedBlock(gamesBlock, 'match /rideOffers/{offerId} {');
    const requestsBlock = extractNestedBlock(offersBlock, 'match /requests/{requestId} {');

    expect(requestsBlock).toContain('function isRideRequestManager()');
    expect(requestsBlock).toContain('function canReadOwnRideRequest()');
    expect(requestsBlock).toContain('function canReadMissingOwnRideRequest()');
    expect(requestsBlock).toContain('resource.data.parentUserId == request.auth.uid');
    expect(requestsBlock).toContain('requestId == request.auth.uid + "__" + resource.data.childId');
    expect(requestsBlock).toContain('isParentForPlayer(teamId, resource.data.childId)');
    expect(requestsBlock).toContain("requestId[0:request.auth.uid.size() + 2] == request.auth.uid + '__'");
    expect(requestsBlock).toContain("requestId[request.auth.uid.size() + 2:requestId.size()].matches('[A-Za-z0-9_-]+')");
    expect(requestsBlock).not.toContain("matches('^' + request.auth.uid");
    expect(requestsBlock).toContain('allow get: if isRideRequestManager() || canReadOwnRideRequest() || canReadMissingOwnRideRequest();');
    expect(requestsBlock).toContain('allow list: if isRideRequestManager();');
    expect(requestsBlock).not.toContain('allow read: if isTeamOwnerOrAdmin(teamId) || isParentForTeam(teamId)');
  });

  describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('rideshare request actor matrix', () => {
    let testEnv;

    beforeAll(async () => {
      testEnv = await initializeTestEnvironment({
        projectId: `allplays-rideshare-request-privacy-${Date.now()}`,
        firestore: { rules }
      });
    }, 30000);

    beforeEach(async () => {
      await testEnv.clearFirestore();
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const firestore = context.firestore();
        await Promise.all([
          setDoc(doc(firestore, 'teams/team-1'), {
            ownerId: 'owner-1',
            adminEmails: ['admin@example.com']
          }),
          setDoc(doc(firestore, 'teams/team-1/games/game-1'), {
            teamId: 'team-1', type: 'game', date: '2026-08-20'
          }),
          setDoc(doc(firestore, 'teams/team-1/games/game-1/rideOffers/offer-1'), {
            driverUserId: 'driver-1', seatCapacity: 4, seatCountConfirmed: 1, status: 'open'
          }),
          setDoc(doc(firestore, 'users/parent-1'), {
            email: 'parent1@example.com', isAdmin: false,
            parentTeamIds: ['team-1'], parentPlayerKeys: ['team-1::player-a', 'team-1::player-c']
          }),
          setDoc(doc(firestore, 'users/parent-2'), {
            email: 'parent2@example.com', isAdmin: false,
            parentTeamIds: ['team-1'], parentPlayerKeys: ['team-1::player-b']
          }),
          setDoc(doc(firestore, 'users/ann.1'), {
            email: 'ann1@example.com', isAdmin: false,
            parentTeamIds: ['team-1'], parentPlayerKeys: ['team-1::player-c']
          }),
          setDoc(doc(firestore, 'users/driver-1'), {
            email: 'driver@example.com', isAdmin: false, parentTeamIds: ['team-1']
          }),
          setDoc(doc(firestore, 'users/owner-1'), {
            email: 'owner@example.com', isAdmin: false
          }),
          setDoc(doc(firestore, 'users/admin-1'), {
            email: 'admin@example.com', isAdmin: false
          }),
          setDoc(doc(firestore, 'teams/team-1/games/game-1/rideOffers/offer-1/requests/parent-1__player-a'), {
            parentUserId: 'parent-1', childId: 'player-a', childName: 'Avery',
            status: 'pending', requestedAt: Timestamp.fromMillis(1710000000000), updatedAt: Timestamp.fromMillis(1710000000000)
          }),
          setDoc(doc(firestore, 'teams/team-1/games/game-1/rideOffers/offer-1/requests/parent-2__player-b'), {
            parentUserId: 'parent-2', childId: 'player-b', childName: 'Blake',
            status: 'waitlisted', requestedAt: Timestamp.fromMillis(1710000001000), updatedAt: Timestamp.fromMillis(1710000001000)
          })
        ]);
      });
    });

    afterAll(async () => {
      await testEnv?.cleanup();
    });

    function authedFirestore(uid, email) {
      return testEnv.authenticatedContext(uid, { email, email_verified: true }).firestore();
    }

    function requestRef(firestore, requestId) {
      return doc(firestore, `teams/team-1/games/game-1/rideOffers/offer-1/requests/${requestId}`);
    }

    function requestCollection(firestore) {
      return collection(firestore, 'teams/team-1/games/game-1/rideOffers/offer-1/requests');
    }

    it('denies another team parent both collection list and cross-household get', async () => {
      const parent = authedFirestore('parent-1', 'parent1@example.com');

      await assertFails(getDocs(requestCollection(parent)));
      await assertFails(getDoc(requestRef(parent, 'parent-2__player-b')));
    });

    it('allows a linked request owner to get only their deterministic request', async () => {
      const parent = authedFirestore('parent-1', 'parent1@example.com');

      const ownRequest = await assertSucceeds(getDoc(requestRef(parent, 'parent-1__player-a')));
      expect(ownRequest.data()).toMatchObject({ parentUserId: 'parent-1', childId: 'player-a' });
    });

    it('allows a team parent to probe their own missing deterministic request before create', async () => {
      const parent = authedFirestore('parent-1', 'parent1@example.com');

      const missingRequest = await assertSucceeds(getDoc(requestRef(parent, 'parent-1__player-c')));
      expect(missingRequest.exists()).toBe(false);
      await assertFails(getDoc(requestRef(parent, 'parent-2__missing-player')));
    });

    it('matches requester UIDs with regex metacharacters literally for missing probes', async () => {
      const parent = authedFirestore('ann.1', 'ann1@example.com');

      const ownMissingRequest = await assertSucceeds(getDoc(requestRef(parent, 'ann.1__player-c')));
      expect(ownMissingRequest.exists()).toBe(false);
      await assertFails(getDoc(requestRef(parent, 'annx1__player-c')));
    });

    it('preserves linked-parent create, pending update, and cancel access', async () => {
      const parent = authedFirestore('parent-1', 'parent1@example.com');
      const nextTimestamp = Timestamp.fromMillis(1710000002000);
      const newRequest = requestRef(parent, 'parent-1__player-c');

      await assertSucceeds(setDoc(newRequest, {
        parentUserId: 'parent-1',
        childId: 'player-c',
        childName: 'Casey',
        status: 'pending',
        requestedAt: nextTimestamp,
        respondedAt: null,
        updatedAt: nextTimestamp
      }));
      await assertSucceeds(updateDoc(requestRef(parent, 'parent-1__player-a'), {
        childName: 'Avery Updated',
        updatedAt: nextTimestamp
      }));
      await assertSucceeds(deleteDoc(requestRef(parent, 'parent-1__player-a')));
    });

    it.each([
      ['offer driver', 'driver-1', 'driver@example.com'],
      ['team owner', 'owner-1', 'owner@example.com'],
      ['team admin', 'admin-1', 'admin@example.com']
    ])('allows the %s to list all requests', async (_label, uid, email) => {
      const actor = authedFirestore(uid, email);

      const requests = await assertSucceeds(getDocs(requestCollection(actor)));
      expect(requests.docs).toHaveLength(2);
    });
  });
});
