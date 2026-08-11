const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildSharedGameSyntheticId,
    normalizeOpenOfficiatingSlotClaimInput,
    normalizeOfficiatingAssignmentResponseInput,
    isEligibleOpenOfficiatingSlotParticipant,
    decodeSharedGameSyntheticId,
    resolveOfficiatingGamePath,
    isTeamLinkedToSharedGame,
    buildOpenOfficiatingSlotClaimUpdate,
    buildOfficiatingSelfAssignmentNotificationRecord,
    buildOfficiatingAssignmentResponseUpdate,
    buildOfficiatingAssignmentResponseNotificationRecord
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
    assert.throws(() => normalizeOpenOfficiatingSlotClaimInput({
        teamId: 't'.repeat(129),
        gameId: 'game-1',
        slotId: 'line-judge'
    }), /Team ID is required/);
});

test('normalizeOfficiatingAssignmentResponseInput allows only bounded accept or decline actions', () => {
    assert.deepEqual(normalizeOfficiatingAssignmentResponseInput({
        teamId: ' team-1 ',
        gameId: 'game-1',
        slotId: 'center',
        status: 'ACCEPTED'
    }), {
        teamId: 'team-1',
        gameId: 'game-1',
        slotId: 'center',
        status: 'accepted'
    });
    assert.throws(() => normalizeOfficiatingAssignmentResponseInput({
        teamId: 'team-1',
        gameId: 'game-1',
        slotId: 'center',
        status: 'open'
    }), /must be accepted or declined/);
});

test('resolveOfficiatingGamePath decodes shared synthetic game ids', () => {
    const syntheticId = 'shared_organizations%2Forg-1%2FsharedGames%2Fgame-1';

    assert.equal(decodeSharedGameSyntheticId(syntheticId), 'organizations/org-1/sharedGames/game-1');
    assert.equal(resolveOfficiatingGamePath('team-1', syntheticId), 'organizations/org-1/sharedGames/game-1');
    assert.equal(resolveOfficiatingGamePath('team-1', 'game-1'), 'teams/team-1/games/game-1');
});

test('long shared-game paths use bounded opaque ids paired with a validated path', () => {
    const sharedGamePath = `organizations/${'o'.repeat(90)}/sharedGames/${'g'.repeat(90)}`;
    const gameId = buildSharedGameSyntheticId(sharedGamePath);

    assert.match(gameId, /^sharedh_[A-Za-z0-9_-]+$/);
    assert.ok(gameId.length <= 128);
    assert.deepEqual(normalizeOpenOfficiatingSlotClaimInput({
        teamId: 'team-1',
        gameId,
        sharedGamePath,
        slotId: 'center'
    }), {
        teamId: 'team-1',
        gameId,
        sharedGamePath,
        slotId: 'center',
        displayName: ''
    });
    assert.equal(resolveOfficiatingGamePath('team-1', gameId, sharedGamePath), sharedGamePath);
    assert.throws(() => normalizeOpenOfficiatingSlotClaimInput({
        teamId: 'team-1',
        gameId,
        slotId: 'center'
    }), /Shared game path is required/);
    assert.throws(() => normalizeOfficiatingAssignmentResponseInput({
        teamId: 'team-1',
        gameId,
        sharedGamePath: `organizations/other/sharedGames/${'g'.repeat(90)}`,
        slotId: 'center',
        status: 'accepted'
    }), /does not match/);
});

test('shared synthetic ids cannot target a non-shared document path', () => {
    const syntheticId = `shared_${encodeURIComponent('users/user-1/privateData/record-1')}`;
    assert.throws(() => normalizeOpenOfficiatingSlotClaimInput({
        teamId: 'team-1',
        gameId: syntheticId,
        slotId: 'center'
    }), /Shared game identity is invalid/);
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
    assert.equal(isEligibleOpenOfficiatingSlotParticipant({
        team,
        user: { email: 'assistant@example.com', profileEmail: 'assistant@example.com' },
        uid: 'former-assistant',
        email: '',
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

test('buildOfficiatingAssignmentResponseUpdate changes only the current UID assignment', () => {
    const result = buildOfficiatingAssignmentResponseUpdate({
        game: {
            officiatingSlots: [
                { id: 'center', position: 'Center Referee', officialUserId: 'official-1', officialEmail: 'old@example.com', status: 'pending', scheduleReviewRequired: true },
                { id: 'line', position: 'Line Judge', officialUserId: 'official-2', officialEmail: 'other@example.com', status: 'pending' }
            ]
        },
        slotId: 'center',
        status: 'accepted',
        official: { uid: 'official-1', email: '' },
        now: 'server-now'
    });

    assert.equal(result.updatedSlot.status, 'accepted');
    assert.equal(result.updatedSlot.scheduleReviewRequired, false);
    assert.equal(result.update.officiatingSlots[1].status, 'pending');
    assert.equal(result.update.officiatingCoverageStatus, 'needs_attention');
    assert.equal(result.update.officiatingUpdatedAt, 'server-now');
});

test('buildOfficiatingAssignmentResponseUpdate accepts a verified-email identity supplied by the handler', () => {
    const result = buildOfficiatingAssignmentResponseUpdate({
        game: {
            officiatingSlots: [{ id: 'center', position: 'Center Referee', officialEmail: 'current@example.com', status: 'pending' }]
        },
        slotId: 'center',
        status: 'declined',
        official: { uid: 'official-1', email: 'CURRENT@example.com' },
        now: 'server-now'
    });

    assert.equal(result.updatedSlot.status, 'declined');
});

test('buildOfficiatingAssignmentResponseUpdate rejects another official and an absent email authority', () => {
    const game = {
        officiatingSlots: [{ id: 'center', position: 'Center Referee', officialEmail: 'current@example.com', status: 'pending' }]
    };

    assert.throws(() => buildOfficiatingAssignmentResponseUpdate({
        game,
        slotId: 'center',
        status: 'accepted',
        official: { uid: 'other-user', email: 'other@example.com' }
    }), /belongs to another official/);
    assert.throws(() => buildOfficiatingAssignmentResponseUpdate({
        game,
        slotId: 'center',
        status: 'accepted',
        official: { uid: 'current-user', email: '' }
    }), /belongs to another official/);
});

test('buildOfficiatingAssignmentResponseUpdate does not let a reassigned legacy email override the canonical UID', () => {
    const game = {
        officiatingSlots: [{
            id: 'center',
            position: 'Center Referee',
            officialUserId: 'canonical-official',
            officialEmail: 'reassigned@example.com',
            status: 'pending'
        }]
    };

    assert.throws(() => buildOfficiatingAssignmentResponseUpdate({
        game,
        slotId: 'center',
        status: 'accepted',
        official: { uid: 'different-user', email: 'reassigned@example.com' }
    }), /belongs to another official/);
});

test('buildOfficiatingAssignmentResponseUpdate rejects a non-string stored UID before comparison or email fallback', () => {
    const game = {
        officiatingSlots: [{
            id: 'center',
            position: 'Center Referee',
            officialUserId: 12345,
            officialEmail: 'current@example.com',
            status: 'pending'
        }]
    };

    assert.throws(() => buildOfficiatingAssignmentResponseUpdate({
        game,
        slotId: 'center',
        status: 'accepted',
        official: { uid: '12345', email: 'current@example.com' }
    }), /invalid user binding/);
});

test('buildOfficiatingAssignmentResponseUpdate rejects stored UIDs repaired by trimming', () => {
    const cases = [
        { storedUid: 'official-1 ', callerUid: 'official-1' },
        { storedUid: `${'x'.repeat(128)} `, callerUid: 'x'.repeat(128) }
    ];

    for (const { storedUid, callerUid } of cases) {
        const game = {
            officiatingSlots: [{
                id: 'center',
                position: 'Center Referee',
                officialUserId: storedUid,
                officialEmail: 'current@example.com',
                status: 'pending'
            }]
        };

        assert.throws(() => buildOfficiatingAssignmentResponseUpdate({
            game,
            slotId: 'center',
            status: 'accepted',
            official: { uid: callerUid, email: 'current@example.com' }
        }), /invalid user binding/);
    }
});

test('buildOfficiatingAssignmentResponseNotificationRecord targets the assigner', () => {
    const record = buildOfficiatingAssignmentResponseNotificationRecord({
        teamId: 'team-1',
        gameId: 'game-1',
        game: { opponent: 'Lions', location: 'Field 2', date: '2026-06-01T12:00:00.000Z' },
        slot: { id: 'center', position: 'Center Referee', officialUserId: 'official-1', officialEmail: 'Current@Example.com', status: 'declined' },
        status: 'declined',
        actor: { uid: 'official-1', email: 'Current@Example.com', displayName: 'Casey Current' },
        timestamp: 'server-now'
    });

    assert.equal(record.event, 'declined');
    assert.equal(record.status, 'declined');
    assert.equal(record.recipientType, 'assigner');
    assert.equal(record.actorUserId, 'official-1');
    assert.equal(record.actorEmail, 'current@example.com');
});
