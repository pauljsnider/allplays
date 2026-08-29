const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');

const { loadNotificationInternals } = require('./send-category-notification-test-helpers.cjs');

function makeSnapshot(ref, data, exists = true) {
  return {
    id: ref.id,
    ref,
    exists,
    data: () => data
  };
}

function makeChange(ref, beforeData, afterData) {
  return {
    before: makeSnapshot(ref, beforeData, beforeData != null),
    after: makeSnapshot(ref, afterData, afterData != null)
  };
}

function installCleanupFirestoreHarness(env, initialDocuments = {}) {
  const documents = new Map(Object.entries(initialDocuments));
  let nextReadError = null;
  let nextCommitError = null;
  let transactionCount = 0;

  function makeSnapshotForReference(ref) {
    const data = documents.get(ref.path);
    return makeSnapshot(ref, data, data !== undefined);
  }

  function collection(path) {
    return {
      path,
      doc(id) {
        return document(`${path}/${id}`);
      },
      limit(count) {
        return { cleanupQuery: true, path, count };
      }
    };
  }

  function document(path) {
    return {
      id: path.split('/').pop(),
      path,
      collection(name) {
        return collection(`${path}/${name}`);
      }
    };
  }

  env.firestoreState.runTransaction = async (handler) => {
    transactionCount += 1;
    const pendingDeletes = [];
    const result = await handler({
      async get(target) {
        if (nextReadError) {
          const error = nextReadError;
          nextReadError = null;
          throw error;
        }
        if (target?.cleanupQuery === true) {
          const prefix = `${target.path}/`;
          const docs = [...documents.keys()]
            .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
            .sort()
            .slice(0, target.count)
            .map((path) => makeSnapshotForReference(document(path)));
          return { docs, empty: docs.length === 0, size: docs.length };
        }
        return makeSnapshotForReference(target);
      },
      delete(ref) {
        pendingDeletes.push(ref.path);
      }
    });
    if (nextCommitError) {
      const error = nextCommitError;
      nextCommitError = null;
      throw error;
    }
    pendingDeletes.forEach((path) => {
      documents.delete(path);
      env.deletedPaths.push(path);
    });
    return result;
  };

  return {
    document,
    documents,
    set(path, data) {
      documents.set(path, data);
    },
    has(path) {
      return documents.has(path);
    },
    failNextRead(error) {
      nextReadError = error;
    },
    failNextCommit(error) {
      nextCommitError = error;
    },
    get transactionCount() {
      return transactionCount;
    }
  };
}

test('shared-game cleanup derives note ownership only from valid home and away team IDs', () => {
  const { internals, cleanup } = loadNotificationInternals();

  try {
    assert.equal(internals.normalizeCoachesOnlyNoteTeamId('team.one:two'), 'team.one:two');
    assert.equal(internals.normalizeCoachesOnlyNoteTeamId('legacy team 1'), 'legacy team 1');
    assert.equal(internals.normalizeCoachesOnlyNoteTeamId('a'.repeat(1500)), 'a'.repeat(1500));
    assert.equal(internals.normalizeCoachesOnlyNoteTeamId(''), '');
    assert.equal(internals.normalizeCoachesOnlyNoteTeamId('.'), '');
    assert.equal(internals.normalizeCoachesOnlyNoteTeamId('..'), '');
    assert.equal(internals.normalizeCoachesOnlyNoteTeamId('__reserved__'), '');
    assert.equal(internals.normalizeCoachesOnlyNoteTeamId('team/one'), '');
    assert.equal(internals.normalizeCoachesOnlyNoteTeamId('é'.repeat(751)), '');
    assert.equal(internals.normalizeCoachesOnlyNoteTeamId(123), '');

    assert.deepEqual(internals.getSharedGameCoachesOnlyNoteTeamIds({
      homeTeamId: 'team.one',
      awayTeamId: 'team:two',
      teamIds: ['discovery-only-team'],
      teams: ['also-not-authority']
    }), ['team.one', 'team:two']);
    assert.deepEqual(internals.getSharedGameCoachesOnlyNoteTeamIds({
      homeTeamId: 'same-team',
      awayTeamId: 'same-team'
    }), ['same-team']);
    assert.deepEqual(internals.getRemovedSharedGameCoachesOnlyNoteTeamIds(
      { homeTeamId: 'team-a', awayTeamId: 'team-b' },
      { homeTeamId: 'team-b', awayTeamId: 'team-c' }
    ), ['team-a']);
    assert.deepEqual(internals.getRemovedSharedGameCoachesOnlyNoteTeamIds(
      { homeTeamId: 'team-a', awayTeamId: 'team-b' },
      { homeTeamId: 'team-b', awayTeamId: 'team-a' }
    ), []);
  } finally {
    cleanup();
  }
});

test('direct-game delete transaction removes only coachNotes/main and retains it after recreation', async () => {
  const { moduleExports, env, cleanup } = loadNotificationInternals();

  try {
    const harness = installCleanupFirestoreHarness(env, {
      'teams/team-1/games/game-1/coachNotes/main': { text: 'Old private note' }
    });
    const gameRef = harness.document('teams/team-1/games/game-1');
    const result = await moduleExports.cleanupDirectGameCoachesOnlyNote(
      makeSnapshot(gameRef, { opponent: 'Lions' }),
      { params: { teamId: 'team-1', gameId: 'game-1' } }
    );

    assert.deepEqual(env.deletedPaths, [
      'teams/team-1/games/game-1/coachNotes/main'
    ]);
    assert.deepEqual(result, {
      deletedNotePath: 'teams/team-1/games/game-1/coachNotes/main',
      retained: false
    });
    assert.equal(harness.has('teams/team-1/games/game-1/coachNotes/main'), false);

    harness.set('teams/team-1/games/game-2', { opponent: 'Recreated game' });
    harness.set('teams/team-1/games/game-2/coachNotes/main', { text: 'New private note' });
    const recreatedGameRef = harness.document('teams/team-1/games/game-2');
    const staleDeleteResult = await moduleExports.cleanupDirectGameCoachesOnlyNote(
      makeSnapshot(recreatedGameRef, { opponent: 'Deleted game' })
    );
    assert.deepEqual(staleDeleteResult, { deletedNotePath: null, retained: true });
    assert.equal(harness.has('teams/team-1/games/game-2/coachNotes/main'), true);

    const expectedError = new Error('transient authoritative read failure');
    harness.failNextRead(expectedError);
    await assert.rejects(
      moduleExports.cleanupDirectGameCoachesOnlyNote(makeSnapshot(recreatedGameRef, {})),
      (error) => error === expectedError
    );
    assert.equal(harness.has('teams/team-1/games/game-2/coachNotes/main'), true);

    const commitError = new Error('transient transaction commit failure');
    const uncommittedGameRef = harness.document('teams/team-1/games/game-3');
    harness.set('teams/team-1/games/game-3/coachNotes/main', { text: 'Retain after failed commit' });
    harness.failNextCommit(commitError);
    await assert.rejects(
      moduleExports.cleanupDirectGameCoachesOnlyNote(makeSnapshot(uncommittedGameRef, {})),
      (error) => error === commitError
    );
    assert.equal(harness.has('teams/team-1/games/game-3/coachNotes/main'), true);
  } finally {
    cleanup();
  }
});

test('organization and tournament updates delete only currently removed teams and retain re-added notes', async () => {
  const { moduleExports, env, cleanup } = loadNotificationInternals();

  try {
    const harness = installCleanupFirestoreHarness(env, {
      'organizations/org-1/sharedGames/shared-game-1': {
        homeTeamId: 'team-b',
        awayTeamId: 'team-c'
      },
      'organizations/org-1/sharedGames/shared-game-1/coachNotes/team-a': {
        text: 'Removed team note'
      },
      'tournaments/tournament-1/sharedGames/shared-game-2': {
        homeTeamId: 'team.two',
        awayTeamId: 'team-three'
      },
      'tournaments/tournament-1/sharedGames/shared-game-2/coachNotes/team:one': {
        text: 'Removed tournament team note'
      }
    });
    const organizationGameRef = harness.document('organizations/org-1/sharedGames/shared-game-1');
    const organizationResult = await moduleExports.cleanupOrganizationSharedGameCoachesOnlyNotes(
      makeChange(
        organizationGameRef,
        {
          homeTeamId: 'team-a',
          awayTeamId: 'team-b',
          teamIds: ['discovery-only-team']
        },
        { homeTeamId: 'team-b', awayTeamId: 'team-c' }
      )
    );

    assert.deepEqual(organizationResult, {
      deletedAll: false,
      removedTeamIds: ['team-a'],
      deletedTeamIds: ['team-a'],
      retainedTeamIds: []
    });
    assert.deepEqual(env.deletedPaths, [
      'organizations/org-1/sharedGames/shared-game-1/coachNotes/team-a'
    ]);

    const tournamentGameRef = harness.document('tournaments/tournament-1/sharedGames/shared-game-2');
    const tournamentResult = await moduleExports.cleanupTournamentSharedGameCoachesOnlyNotes(
      makeChange(
        tournamentGameRef,
        { homeTeamId: 'team:one', awayTeamId: 'invalid/team' },
        { homeTeamId: 'team.two', awayTeamId: 'team-three' }
      )
    );

    assert.deepEqual(tournamentResult, {
      deletedAll: false,
      removedTeamIds: ['team:one'],
      deletedTeamIds: ['team:one'],
      retainedTeamIds: []
    });
    assert.deepEqual(env.deletedPaths, [
      'organizations/org-1/sharedGames/shared-game-1/coachNotes/team-a',
      'tournaments/tournament-1/sharedGames/shared-game-2/coachNotes/team:one'
    ]);

    const creationResult = await moduleExports.cleanupOrganizationSharedGameCoachesOnlyNotes(
      makeChange(organizationGameRef, null, { homeTeamId: 'team-a', awayTeamId: 'team-b' })
    );
    assert.deepEqual(creationResult, { deletedAll: false, removedTeamIds: [] });
    assert.equal(env.deletedPaths.length, 2);

    const readdedPath = 'organizations/org-1/sharedGames/shared-game-3';
    harness.set(readdedPath, { homeTeamId: 'team-old', awayTeamId: 'team-new' });
    harness.set(`${readdedPath}/coachNotes/team-old`, { text: 'Keep after re-add' });
    const readdedResult = await moduleExports.cleanupOrganizationSharedGameCoachesOnlyNotes(
      makeChange(
        harness.document(readdedPath),
        { homeTeamId: 'team-old', awayTeamId: 'team-staying' },
        { homeTeamId: 'team-new', awayTeamId: 'team-staying' }
      )
    );
    assert.deepEqual(readdedResult, {
      deletedAll: false,
      removedTeamIds: ['team-old'],
      deletedTeamIds: [],
      retainedTeamIds: ['team-old']
    });
    assert.equal(harness.has(`${readdedPath}/coachNotes/team-old`), true);

    const expectedError = new Error('transient removed-team authoritative read failure');
    harness.failNextRead(expectedError);
    await assert.rejects(
      moduleExports.cleanupOrganizationSharedGameCoachesOnlyNotes(
        makeChange(
          harness.document(readdedPath),
          { homeTeamId: 'team-old', awayTeamId: 'team-staying' },
          { homeTeamId: 'team-new', awayTeamId: 'team-staying' }
        )
      ),
      (error) => error === expectedError
    );
    assert.equal(harness.has(`${readdedPath}/coachNotes/team-old`), true);
  } finally {
    cleanup();
  }
});

test('shared-game hard deletes drain every note transactionally and retain notes after recreation', async () => {
  const { moduleExports, env, cleanup } = loadNotificationInternals();

  try {
    const deletedGamePath = 'organizations/org-1/sharedGames/shared-game-1';
    const deletedNotes = Object.fromEntries(Array.from({ length: 401 }, (_unused, index) => [
      `${deletedGamePath}/coachNotes/note-owner-${String(index).padStart(3, '0')}`,
      { text: `Private note ${index}` }
    ]));
    const harness = installCleanupFirestoreHarness(env, deletedNotes);
    const organizationGameRef = harness.document(deletedGamePath);
    const result = await moduleExports.cleanupOrganizationSharedGameCoachesOnlyNotes(
      makeChange(
        organizationGameRef,
        {
          homeTeamId: 'team-a',
          awayTeamId: 'team-b',
          teamIds: ['unknown-leftover-note-owner']
        },
        null
      )
    );

    assert.deepEqual(result, {
      deletedAll: true,
      removedTeamIds: ['team-a', 'team-b'],
      deletedCount: 401,
      retained: false
    });
    assert.equal([...harness.documents.keys()].some((path) => path.startsWith(`${deletedGamePath}/coachNotes/`)), false);
    assert.equal(harness.transactionCount, 2);

    const recreatedGamePath = 'tournaments/tournament-1/sharedGames/shared-game-2';
    harness.set(recreatedGamePath, { homeTeamId: 'team-a', awayTeamId: 'team-b' });
    harness.set(`${recreatedGamePath}/coachNotes/team-a`, { text: 'New game note' });
    const recreatedResult = await moduleExports.cleanupTournamentSharedGameCoachesOnlyNotes(
      makeChange(
        harness.document(recreatedGamePath),
        { homeTeamId: 'team-a', awayTeamId: 'team-b' },
        null
      )
    );
    assert.deepEqual(recreatedResult, {
      deletedAll: false,
      removedTeamIds: ['team-a', 'team-b'],
      deletedCount: 0,
      retained: true
    });
    assert.equal(harness.has(`${recreatedGamePath}/coachNotes/team-a`), true);

    const expectedError = new Error('transient hard-delete authoritative read failure');
    harness.failNextRead(expectedError);
    await assert.rejects(
      moduleExports.cleanupTournamentSharedGameCoachesOnlyNotes(
        makeChange(
          harness.document(recreatedGamePath),
          { homeTeamId: 'team-a', awayTeamId: 'team-b' },
          null
        )
      ),
      (error) => error === expectedError
    );
    assert.equal(harness.has(`${recreatedGamePath}/coachNotes/team-a`), true);
  } finally {
    cleanup();
  }
});

test('all cleanup triggers use the retryable Functions configuration', () => {
  const source = readFileSync(require.resolve('../index.js'), 'utf8');

  assert.match(
    source,
    /const retryableCoachesOnlyNoteCleanupFunctions = functions\.runWith\(\{ failurePolicy: true \}\);/
  );
  assert.match(
    source,
    /exports\.cleanupDirectGameCoachesOnlyNote = retryableCoachesOnlyNoteCleanupFunctions\.firestore\s*\.document\('teams\/\{teamId\}\/games\/\{gameId\}'\)\s*\.onDelete\(cleanupDirectGameCoachesOnlyNote\);/
  );
  assert.match(
    source,
    /exports\.cleanupOrganizationSharedGameCoachesOnlyNotes = retryableCoachesOnlyNoteCleanupFunctions\.firestore\s*\.document\('organizations\/\{organizationId\}\/sharedGames\/\{gameId\}'\)\s*\.onWrite\(cleanupSharedGameCoachesOnlyNotes\);/
  );
  assert.match(
    source,
    /exports\.cleanupTournamentSharedGameCoachesOnlyNotes = retryableCoachesOnlyNoteCleanupFunctions\.firestore\s*\.document\('tournaments\/\{tournamentId\}\/sharedGames\/\{gameId\}'\)\s*\.onWrite\(cleanupSharedGameCoachesOnlyNotes\);/
  );
});
