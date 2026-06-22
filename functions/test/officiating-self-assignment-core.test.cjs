const test = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizeOpenOfficiatingSlotClaimInput,
    isEligibleOpenOfficiatingSlotParticipant,
    decodeSharedGameSyntheticId,
    resolveOfficiatingGamePath,
    isTeamLinkedToSharedGame,
    buildOpenOfficiatingSlotClaimUpdate,
    buildOfficiatingSelfAssignmentNotificationRecord
} = require('../officiating-self-assignment-core.cjs');

test('normalizeOpenOfficiatingSlotClaimInput requires document-safe IDs', () => {
    assert.deepEqual(normalizeOpenOfficiatingSlotClaimInput({
        teamId: ' team-1 ',
        gameId: 'game-1',
        slotId: 'line-judge',
        displayName: ' Casey '
    }), {
        teamId: 'team-1',
        gameId: 'game-1',
        slotId: 'line-judge',
        displayName: 'Casey'
    });

    assert.throws(() => normalizeOpenOfficiatingSlotClaimInput({
        teamId: 'team-1',
        gameId: 'games/game-1',
        slotId: 'line-judge'
    }), /Game ID is required/);
});

test('resolveOfficiatingGamePath decodes shared synthetic game ids', () => {
    const syntheticId = 'shared_organizations%2Forg-1%2FsharedGames%2Fgame-1';

    assert.equal(decodeSharedGameSyntheticId(syntheticId), 'organizations/org-1/sharedGames/game-1');
    assert.equal(resolveOfficiatingGamePath('team-1', syntheticId), 'organizations/org-1/sharedGames/game-1');
    assert.equal(resolveOfficiatingGamePath('team-1', 'game-1'), 'teams/team-1/games/game-1');
});

test('isTeamLinkedToSharedGame only accepts participating teams', () => {
    assert.equal(isTeamLinkedToSharedGame({ homeTeamId: 'team-1' }, 'team-1'), true);
    assert.equal(isTeamLinkedToSharedGame({ awayTeamId: 'team-2' }, 'team-2'), true);
    assert.equal(isTeamLinkedToSharedGame({ teamIds: ['team-3', 'team-4'] }, 'team-4'), true);
    assert.equal(isTeamLinkedToSharedGame({ homeTeamId: 'team-1', awayTeamId: 'team-2' }, 'team-9'), false);
});

test('isEligibleOpenOfficiatingSlotParticipant accepts staff and linked parents only', () => {
    const team = { id: 'team-1', ownerId: 'coach-1', adminEmails: ['assistant@example.com'] };

    assert.equal(isEligibleOpenOfficiatingSlotParticipant({ team, uid: 'coach-1', teamId: 'team-1' }), true);
    assert.equal(isEligibleOpenOfficiatingSlotParticipant({
        team,
        user: { email: 'assistant@example.com' },
        uid: 'assistant-1',
        email: 'assistant@example.com',
        teamId: 'team-1'
    }), true);
    assert.equal(isEligibleOpenOfficiatingSlotParticipant({
        team,
        user: { parentTeamIds: ['team-1'] },
        uid: 'parent-1',
        email: 'parent@example.com',
        teamId: 'team-1'
    }), true);
    assert.equal(isEligibleOpenOfficiatingSlotParticipant({
        team,
        user: { parentTeamIds: ['other-team'] },
        uid: 'parent-2',
        email: 'parent2@example.com',
        teamId: 'team-1'
    }), false);
});

test('buildOpenOfficiatingSlotClaimUpdate changes exactly the requested open slot', () => {
    const result = buildOpenOfficiatingSlotClaimUpdate({
        game: {
            officiatingSelfAssignmentEnabled: true,
            officiatingSlots: [
                { id: 'center', position: 'Center Referee', status: 'open' },
                { id: 'line', position: 'Line Judge', officialUserId: 'official-2', officialEmail: 'taken@example.com', officialName: 'Taken Official', status: 'accepted' }
            ],
            officiatingAuthorizedUserIds: ['coach-1'],
            officiatingAuthorizedEmails: ['coach@example.com']
        },
        slotId: 'center',
        official: {
            uid: 'parent-1',
            email: 'Parent@Example.com',
            displayName: 'Pat Parent'
        },
        now: 'server-now'
    });

    assert.equal(result.claimedSlot.id, 'center');
    assert.equal(result.claimedSlot.officialUserId, 'parent-1');
    assert.equal(result.claimedSlot.officialEmail, 'parent@example.com');
    assert.equal(result.claimedSlot.selfAssigned, true);
    assert.deepEqual(result.update.officiatingSlots[1], {
        id: 'line',
        position: 'Line Judge',
        officialId: '',
        officialUserId: 'official-2',
        officialName: 'Taken Official',
        officialEmail: 'taken@example.com',
        status: 'accepted',
        selfAssigned: false,
        scheduleReviewRequired: false,
        scheduleReviewReason: '',
        scheduleReviewMarkedAt: null,
        submittedResult: null
    });
    assert.equal(result.update.officiatingCoverageStatus, 'covered');
    assert.equal(result.update.officiatingUpdatedAt, 'server-now');
    assert.deepEqual(result.update.officiatingAuthorizedUserIds, ['coach-1', 'parent-1']);
    assert.deepEqual(result.update.officiatingAuthorizedEmails, ['coach@example.com', 'parent@example.com']);
});

test('buildOpenOfficiatingSlotClaimUpdate rejects filled or disabled slots', () => {
    assert.throws(() => buildOpenOfficiatingSlotClaimUpdate({
        game: {
            officiatingSelfAssignmentEnabled: false,
            officiatingSlots: [{ id: 'center', position: 'Center Referee', status: 'open' }]
        },
        slotId: 'center',
        official: { uid: 'parent-1' }
    }), /Self-assignment is not enabled/);

    assert.throws(() => buildOpenOfficiatingSlotClaimUpdate({
        game: {
            officiatingSelfAssignmentEnabled: true,
            officiatingSlots: [{ id: 'center', position: 'Center Referee', officialUserId: 'official-1', status: 'accepted' }]
        },
        slotId: 'center',
        official: { uid: 'parent-1' }
    }), /already filled/);
});

test('buildOfficiatingSelfAssignmentNotificationRecord targets assigners for audit visibility', () => {
    const record = buildOfficiatingSelfAssignmentNotificationRecord({
        teamId: 'team-1',
        gameId: 'game-1',
        game: { opponent: 'Lions', location: 'Field 2', date: '2026-06-01T12:00:00.000Z' },
        slot: { id: 'center', position: 'Center Referee', officialUserId: 'parent-1', officialEmail: 'Parent@Example.com', status: 'accepted' },
        actor: { uid: 'parent-1', email: 'Parent@Example.com', displayName: 'Pat Parent' },
        timestamp: 'server-now'
    });

    assert.equal(record.type, 'officiating_assignment');
    assert.equal(record.event, 'self_assigned');
    assert.equal(record.recipientType, 'assigner');
    assert.equal(record.actorUserId, 'parent-1');
    assert.equal(record.actorEmail, 'parent@example.com');
    assert.equal(record.recipientOfficialUserId, 'parent-1');
    assert.equal(record.recipientOfficialEmail, 'parent@example.com');
    assert.deepEqual(record.gameReference, {
        teamId: 'team-1',
        gameId: 'game-1',
        opponent: 'Lions',
        location: 'Field 2',
        date: '2026-06-01T12:00:00.000Z'
    });
});
