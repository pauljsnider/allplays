import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';
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

describe('RSVP note privacy Firestore rules', () => {
  it('rejects private note fields on parent-readable RSVP status docs', () => {
    const rsvpBlock = extractNestedBlock(gamesBlock, 'match /rsvps/{rsvpId} {');

    expect(rsvpBlock).toContain('function isRsvpStatusPayloadSafe(data)');
    expect(rsvpBlock).toContain("'note'");
    expect(rsvpBlock).toContain("'adminOnlyNote'");
    expect(rsvpBlock).toContain("'privateAvailabilityNote'");
    expect(rsvpBlock).toContain('isRsvpStatusPayloadSafe(request.resource.data)');
  });

  it('allows linked-player parent RSVP writes only for the matching player-scoped document', () => {
    const rsvpBlock = extractNestedBlock(gamesBlock, 'match /rsvps/{rsvpId} {');
    const parentWriteFunction = extractNestedBlock(rsvpBlock, 'function canWriteOwnParentRsvp(data) {');

    expect(gamesBlock).toContain('function getRsvpPayloadPlayerId(data)');
    expect(gamesBlock).toContain('function rsvpPayloadMatchesSinglePlayer(data, playerId)');
    expect(gamesBlock).toContain('function canUseLinkedPlayerRsvp(teamId, data)');
    expect(gamesBlock).toContain('function canUseGroupedLinkedPlayerRsvp(teamId, data)');
    expect(gamesBlock).toContain('function isOwnLinkedPlayerRsvpId(rsvpId, data)');
    expect(gamesBlock).toContain('function hasRsvpPlayerScope(data)');
    expect(gamesBlock).toContain('isParentForPlayer(teamId, playerId)');
    expect(gamesBlock).toContain('isParentForRsvpPlayerAt(teamId, playerIds, 9)');
    expect(gamesBlock).toContain('rsvpId == request.auth.uid + "__" + playerId');
    expect(rsvpBlock).toContain('canUseLinkedPlayerRsvp(teamId, resource.data)');
    expect(rsvpBlock).toContain('isOwnLinkedPlayerRsvpId(rsvpId, resource.data)');
    expect(parentWriteFunction).toContain('isOwnBaseRsvpDoc() &&\n                    isParentForTeam(teamId) &&\n                    (!hasRsvpPlayerScope(data) ||\n                     canUseLinkedPlayerRsvp(teamId, data) ||\n                     canUseGroupedLinkedPlayerRsvp(teamId, data))');
    expect(parentWriteFunction).toContain('isOwnLinkedPlayerRsvpDoc() &&\n                    canUseLinkedPlayerRsvp(teamId, data) &&\n                    isOwnLinkedPlayerRsvpId(rsvpId, data)');
    expect(rsvpBlock).not.toContain('isParentForTeam(teamId) ||\n                                    (canUseLinkedPlayerRsvp');
    expect(rsvpBlock).not.toContain('isParentForTeam(teamId) ||\n                            (canUseLinkedPlayerRsvp');
  });

  it('denies same-team parents from writing or deleting another player-scoped RSVP doc', () => {
    const rsvpBlock = extractNestedBlock(gamesBlock, 'match /rsvps/{rsvpId} {');
    const parentWriteFunction = extractNestedBlock(rsvpBlock, 'function canWriteOwnParentRsvp(data) {');
    const createUpdateRule = rsvpBlock.match(/allow create, update: if [\s\S]*?;/)?.[0] || '';
    const deleteRule = rsvpBlock.match(/allow delete: if [\s\S]*?;/)?.[0] || '';

    expect(parentWriteFunction).toContain('isOwnLinkedPlayerRsvpDoc() &&');
    expect(parentWriteFunction).toContain('canUseLinkedPlayerRsvp(teamId, data)');
    expect(parentWriteFunction).toContain('isOwnLinkedPlayerRsvpId(rsvpId, data)');
    expect(createUpdateRule).toContain('canWriteOwnParentRsvp(request.resource.data)');
    expect(deleteRule).toContain('canWriteOwnParentRsvp(resource.data)');
    expect(deleteRule).toContain('resource == null && isParentForTeam(teamId)');
    expect(createUpdateRule).not.toContain('isParentForTeam(teamId) ||');
    expect(deleteRule).not.toContain('isParentForTeam(teamId) ||');
  });

  it('restricts note docs to admins, the note owner, or explicit team-visible notes', () => {
    const noteBlock = extractNestedBlock(gamesBlock, 'match /rsvpNotes/{rsvpId} {');

    expect(noteBlock).toContain('function canReadRsvpNote(teamId, data)');
    expect(noteBlock).toContain('isTeamOwnerOrAdmin(teamId)');
    expect(noteBlock).toContain('isOwnRsvpNoteDoc(data)');
    expect(noteBlock).toContain("data.get('visibility', 'admins') == 'team'");
    expect(noteBlock).toContain("get('noteVisibility', 'admins') == 'team'");
    expect(noteBlock).toContain('allow get: if (resource == null && isOwnRsvpNoteId() && isParentForTeam(teamId)) ||');
    expect(noteBlock).toContain('allow list: if canReadRsvpNote(teamId, resource.data);');
  });

  it('requires an explicit safe RSVP note document shape and writer-owned ID for writes', () => {
    const noteBlock = extractNestedBlock(gamesBlock, 'match /rsvpNotes/{rsvpId} {');
    const parentNoteWriteFunction = extractNestedBlock(noteBlock, 'function canWriteOwnParentRsvpNote(teamId, rsvpId, data) {');

    expect(noteBlock).toContain('function isRsvpNotePayloadValid(teamId, data)');
    expect(noteBlock).toContain('function isOwnRsvpNoteId()');
    expect(noteBlock).toContain('function canWriteOwnParentRsvpNote(teamId, rsvpId, data)');
    expect(noteBlock).toContain("data.keys().hasAll(['userId', 'note', 'visibility', 'updatedAt'])");
    expect(noteBlock).toContain("data.visibility in ['admins', 'team']");
    expect(noteBlock).toContain("(data.visibility == 'admins' || teamAllowsTeamVisibleRsvpNotes(teamId))");
    expect(noteBlock).toContain('canUseLinkedPlayerRsvp(teamId, data)');
    expect(noteBlock).toContain('canUseGroupedLinkedPlayerRsvp(teamId, data)');
    expect(noteBlock).toContain('isOwnLinkedPlayerRsvpId(rsvpId, data)');
    expect(parentNoteWriteFunction).toContain('isOwnBaseRsvpNoteId() &&\n                     isParentForTeam(teamId) &&\n                     (!hasRsvpPlayerScope(data) ||\n                      canUseLinkedPlayerRsvp(teamId, data) ||\n                      canUseGroupedLinkedPlayerRsvp(teamId, data))');
    expect(parentNoteWriteFunction).toContain('isOwnLinkedPlayerRsvpNoteId() &&\n                     canUseLinkedPlayerRsvp(teamId, data) &&\n                     isOwnLinkedPlayerRsvpId(rsvpId, data)');
    expect(parentNoteWriteFunction).toContain('data.userId == request.auth.uid &&\n                   isOwnRsvpNoteId()');
    expect(noteBlock).not.toContain('data.userId == request.auth.uid &&\n                     isOwnRsvpNoteDoc(data)');
    expect(noteBlock).toContain('allow create, update: if isSignedIn() && canWriteRsvpNote(teamId, rsvpId, request.resource.data);');
  });

  it('requires linked-player ownership for same-team parent RSVP note writes and deletes', () => {
    const noteBlock = extractNestedBlock(gamesBlock, 'match /rsvpNotes/{rsvpId} {');
    const parentNoteWriteFunction = extractNestedBlock(noteBlock, 'function canWriteOwnParentRsvpNote(teamId, rsvpId, data) {');
    const parentNoteDeleteFunction = extractNestedBlock(noteBlock, 'function canDeleteOwnParentRsvpNote(teamId, rsvpId, data) {');
    const writeFunction = extractNestedBlock(noteBlock, 'function canWriteRsvpNote(teamId, rsvpId, data) {');

    expect(parentNoteWriteFunction).toContain('isOwnLinkedPlayerRsvpNoteId() &&');
    expect(parentNoteWriteFunction).toContain('canUseLinkedPlayerRsvp(teamId, data)');
    expect(parentNoteWriteFunction).toContain('isOwnLinkedPlayerRsvpId(rsvpId, data)');
    expect(parentNoteDeleteFunction).toContain('isOwnLinkedPlayerRsvpNoteId() &&');
    expect(parentNoteDeleteFunction).toContain('canUseLinkedPlayerRsvp(teamId, data)');
    expect(parentNoteDeleteFunction).toContain('isOwnLinkedPlayerRsvpId(rsvpId, data)');
    expect(writeFunction).toContain('canWriteOwnParentRsvpNote(teamId, rsvpId, data)');
    expect(writeFunction).not.toContain('isParentForTeam(teamId) ||');
    expect(noteBlock).toContain('resource == null && isOwnRsvpNoteId() && isParentForTeam(teamId)');
    expect(noteBlock).toContain('canDeleteOwnParentRsvpNote(teamId, rsvpId, resource.data);');
  });

  describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('RSVP linked-player rules engine coverage', () => {
    let testEnv;
    const now = Timestamp.fromMillis(1710000000000);

    beforeAll(async () => {
      testEnv = await initializeTestEnvironment({
        projectId: `allplays-rsvp-linked-player-${Date.now()}`,
        firestore: {
          rules
        }
      });
    }, 30000);

    beforeEach(async () => {
      await testEnv.clearFirestore();
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const firestore = context.firestore();
        await setDoc(doc(firestore, 'teams/team-1'), {
          ownerId: 'owner-1',
          adminEmails: ['admin@example.com']
        });
        await setDoc(doc(firestore, 'teams/team-1/games/game-1'), {
          teamId: 'team-1',
          type: 'game',
          date: '2026-07-09'
        });
        await setDoc(doc(firestore, 'users/parent-1'), {
          email: 'parent@example.com',
          isAdmin: false,
          parentTeamIds: ['team-1'],
          parentPlayerKeys: ['team-1::player-a', 'team-1::player-c']
        });
        await setDoc(doc(firestore, 'users/owner-1'), {
          email: 'owner@example.com',
          isAdmin: false
        });
      });
    });

    afterAll(async () => {
      await testEnv?.cleanup();
    });

    function authedFirestore(uid, email = `${uid}@example.com`) {
      return testEnv.authenticatedContext(uid, { email }).firestore();
    }

    function rsvpRef(firestore, playerId, uid = 'parent-1') {
      return doc(firestore, `teams/team-1/games/game-1/rsvps/${uid}__${playerId}`);
    }

    function baseRsvpRef(firestore, uid = 'parent-1') {
      return doc(firestore, `teams/team-1/games/game-1/rsvps/${uid}`);
    }

    function noteRef(firestore, playerId, uid = 'parent-1') {
      return doc(firestore, `teams/team-1/games/game-1/rsvpNotes/${uid}__${playerId}`);
    }

    function baseNoteRef(firestore, uid = 'parent-1') {
      return doc(firestore, `teams/team-1/games/game-1/rsvpNotes/${uid}`);
    }

    function rsvpPayload(playerId, uid = 'parent-1') {
      return {
        userId: uid,
        displayName: 'Parent One',
        playerIds: [playerId],
        playerId,
        childId: playerId,
        response: 'going',
        respondedAt: now
      };
    }

    function groupedRsvpPayload(playerIds, uid = 'parent-1') {
      return {
        userId: uid,
        displayName: 'Parent One',
        playerIds,
        playerId: null,
        childId: null,
        response: 'going',
        respondedAt: now
      };
    }

    function notePayload(playerId, uid = 'parent-1') {
      return {
        userId: uid,
        displayName: 'Parent One',
        playerIds: [playerId],
        playerId,
        childId: playerId,
        response: 'going',
        note: 'Available',
        visibility: 'admins',
        updatedAt: now,
        respondedAt: now
      };
    }

    function groupedNotePayload(playerIds, uid = 'parent-1') {
      return {
        userId: uid,
        displayName: 'Parent One',
        playerIds,
        playerId: null,
        childId: null,
        response: 'going',
        note: 'Available',
        visibility: 'admins',
        updatedAt: now,
        respondedAt: now
      };
    }

    async function seedRsvpDoc(path, data) {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), path), data);
      });
    }

    it('denies same-team different-player parent RSVP create, update, and delete', async () => {
      const parentDb = authedFirestore('parent-1', 'parent@example.com');
      const playerBRef = rsvpRef(parentDb, 'player-b');

      await assertFails(setDoc(playerBRef, rsvpPayload('player-b')));
      await assertFails(setDoc(baseRsvpRef(parentDb), rsvpPayload('player-b')));

      await seedRsvpDoc('teams/team-1/games/game-1/rsvps/parent-1__player-b', rsvpPayload('player-b'));
      await assertFails(updateDoc(playerBRef, { response: 'not_going' }));
      await assertFails(deleteDoc(playerBRef));
    });

    it('allows a parent to create, update, and delete their linked player RSVP', async () => {
      const parentDb = authedFirestore('parent-1', 'parent@example.com');
      const playerARef = rsvpRef(parentDb, 'player-a');

      await assertSucceeds(setDoc(playerARef, rsvpPayload('player-a')));
      await assertSucceeds(updateDoc(playerARef, { response: 'maybe' }));
      await assertSucceeds(deleteDoc(playerARef));
      await assertSucceeds(setDoc(baseRsvpRef(parentDb), rsvpPayload('player-a')));
    });

    it('allows grouped base RSVP and note writes only when every player is linked to the parent', async () => {
      const parentDb = authedFirestore('parent-1', 'parent@example.com');
      const linkedPlayers = ['player-a', 'player-c'];
      const mixedPlayers = ['player-a', 'player-b'];

      await assertSucceeds(setDoc(baseRsvpRef(parentDb), groupedRsvpPayload(linkedPlayers)));
      await assertSucceeds(setDoc(baseNoteRef(parentDb), groupedNotePayload(linkedPlayers)));
      await assertFails(setDoc(baseRsvpRef(parentDb), groupedRsvpPayload(mixedPlayers)));
      await assertFails(setDoc(baseNoteRef(parentDb), groupedNotePayload(mixedPlayers)));
    });

    it('allows one atomic family write when child override documents do not exist', async () => {
      const parentDb = authedFirestore('parent-1', 'parent@example.com');
      const linkedPlayers = ['player-a', 'player-c'];
      const batch = writeBatch(parentDb);

      batch.set(baseRsvpRef(parentDb), groupedRsvpPayload(linkedPlayers));
      batch.set(baseNoteRef(parentDb), groupedNotePayload(linkedPlayers));
      linkedPlayers.forEach((playerId) => {
        batch.delete(rsvpRef(parentDb, playerId));
        batch.delete(noteRef(parentDb, playerId));
      });

      await assertSucceeds(batch.commit());
    });

    it('returns missing own note overrides to a parent without exposing another user path', async () => {
      const parentDb = authedFirestore('parent-1', 'parent@example.com');

      await assertSucceeds(getDoc(baseNoteRef(parentDb)));
      await assertSucceeds(getDoc(noteRef(parentDb, 'player-a')));
      await assertFails(getDoc(noteRef(parentDb, 'player-a', 'other-parent')));
    });

    it('denies same-team different-player parent RSVP note create, update, and delete', async () => {
      const parentDb = authedFirestore('parent-1', 'parent@example.com');
      const playerBNoteRef = noteRef(parentDb, 'player-b');

      await assertFails(setDoc(playerBNoteRef, notePayload('player-b')));
      await assertFails(setDoc(baseNoteRef(parentDb), notePayload('player-b')));

      await seedRsvpDoc('teams/team-1/games/game-1/rsvpNotes/parent-1__player-b', notePayload('player-b'));
      await assertFails(updateDoc(playerBNoteRef, { note: 'Still available', updatedAt: now }));
      await assertFails(deleteDoc(playerBNoteRef));
    });

    it('keeps team owner writes available for player-scoped RSVP docs and notes', async () => {
      const ownerDb = authedFirestore('owner-1', 'owner@example.com');
      const ownerRsvpRef = rsvpRef(ownerDb, 'player-b', 'owner-1');
      const ownerNoteRef = noteRef(ownerDb, 'player-b', 'owner-1');

      await assertSucceeds(setDoc(ownerRsvpRef, rsvpPayload('player-b', 'owner-1')));
      await assertSucceeds(setDoc(ownerNoteRef, notePayload('player-b', 'owner-1')));
    });
  });
});
