'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildOfficialPhoneCandidates,
  createOfficialTeamDiscoveryHandler
} = require('../official-team-discovery-core.cjs');

class HttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function makeFirestore(records = [], { failField = null, documents = {}, gamesByTeam = {}, sharedGames = [] } = {}) {
  return {
    doc(path) {
      return {
        async get() {
          const data = documents[path];
          return {
            id: path.split('/').pop(),
            exists: data != null,
            data: () => data
          };
        }
      };
    },
    collection(path) {
      const match = /^teams\/([^/]+)\/games$/.exec(path);
      assert.ok(match, `Unexpected collection path: ${path}`);
      let queryLimit = Infinity;
      let startDate = null;
      return {
        where(field, operator, value) {
          assert.equal(field, 'date');
          assert.equal(operator, '>=');
          startDate = value;
          return this;
        },
        limit(value) {
          queryLimit = value;
          return this;
        },
        async get() {
          const docs = (gamesByTeam[match[1]] || [])
            .filter(({ data }) => !startDate || new Date(data.date).getTime() >= startDate.getTime())
            .slice(0, queryLimit)
            .map(({ id, data }) => ({ id, data: () => data }));
          return { docs, size: docs.length, empty: docs.length === 0 };
        }
      };
    },
    collectionGroup(name) {
      assert.ok(['officials', 'games', 'sharedGames'].includes(name), `Unexpected collection group: ${name}`);
      const filters = [];
      let queryLimit = Infinity;
      return {
        where(field, operator, value) {
          filters.push({ field, operator, value });
          return this;
        },
        limit(value) {
          queryLimit = value;
          return this;
        },
        async get() {
          if (filters.some(({ field }) => field === failField)) throw new Error('query failed');
          const source = name === 'officials'
            ? records
            : name === 'games'
              ? Object.entries(gamesByTeam).flatMap(([teamId, games]) => games.map(({ id, data }) => ({
                path: `teams/${teamId}/games/${id}`,
                data
              })))
              : sharedGames;
          const docs = source
            .filter(({ data }) => filters.every(({ field, operator, value }) => {
              if (operator === '==') return data[field] === value;
              if (operator === 'in') return value.includes(data[field]);
              if (operator === 'array-contains') return Array.isArray(data[field]) && data[field].includes(value);
              if (operator === '>=') return new Date(data[field]).getTime() >= value.getTime();
              return false;
            }))
            .slice(0, queryLimit)
            .map(({ path, data }) => ({ ref: { path }, data: () => data }));
          return { docs, size: docs.length, empty: docs.length === 0 };
        }
      };
    }
  };
}

function makeHandler(records, authUser, options = {}) {
  return createOfficialTeamDiscoveryHandler({
    firestore: makeFirestore(records, options),
    auth: { getUser: async () => authUser },
    HttpsError,
    maxDocumentsPerQuery: options.maxDocumentsPerQuery,
    maxAssignmentTeams: options.maxAssignmentTeams,
    maxGamesPerTeam: options.maxGamesPerTeam
  });
}

const context = { auth: { uid: 'official-1', token: { email: 'stale@example.com' } } };

test('official discovery uses the current enabled Auth email instead of stale token or profile identity', async () => {
  const handler = makeHandler([
    { path: 'teams/old-team/officials/old', data: { email: 'stale@example.com' } },
    { path: 'teams/new-team/officials/current', data: { email: 'current@example.com' } }
  ], {
    uid: 'official-1',
    email: 'current@example.com',
    emailVerified: true,
    disabled: false
  });

  assert.deepEqual(await handler({}, context), {
    teamIds: ['new-team'],
    teamCount: 1,
    isPartial: false
  });
});

test('official discovery supports normalized and common formatted Auth phone variants', async () => {
  assert.ok(buildOfficialPhoneCandidates({ phoneNumber: '+1 (816) 555-0123' }).includes('(816) 555-0123'));
  const handler = makeHandler([
    { path: 'teams/phone-team/officials/phone', data: { phone: '(816) 555-0123' } }
  ], {
    uid: 'official-1',
    phoneNumber: '+18165550123',
    disabled: false
  });

  assert.deepEqual((await handler({}, context)).teamIds, ['phone-team']);
});

test('official discovery rejects a caller UID that would change when trimmed', async () => {
  const handler = makeHandler([
    { path: 'teams/team-1/officials/current', data: { emailLower: 'current@example.com' } }
  ], {
    uid: 'official-1',
    email: 'current@example.com',
    emailVerified: true,
    disabled: false
  });

  await assert.rejects(
    handler({}, { auth: { uid: 'official-1 ' } }),
    (error) => error.code === 'unauthenticated'
  );
});

test('official discovery includes eligible open slots for a parentOf-only profile', async () => {
  const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const handler = makeHandler([
    { path: 'teams/team-1/officials/current', data: { emailLower: 'current@example.com' } }
  ], {
    uid: 'official-1',
    email: 'current@example.com',
    emailVerified: true,
    disabled: false
  }, {
    documents: {
      'users/official-1': { parentOf: [{ teamId: 'team-1', playerId: 'player-1' }] },
      'teams/team-1': { name: 'Alpha FC', ownerId: 'coach-1', adminEmails: [] }
    },
    gamesByTeam: {
      'team-1': [{
        id: 'game-1',
        data: {
          date: futureDate,
          opponent: 'Tigers',
          location: 'Field 2',
          officiatingSelfAssignmentEnabled: true,
          officiatingSlots: [
            { id: 'mine', position: 'Center', officialEmail: 'Current@Example.com', status: 'pending' },
            { id: 'other', position: 'Assistant', officialEmail: 'other@example.com', officialName: 'Other Ref', status: 'accepted' },
            { id: 'open', position: 'Line', status: 'open' }
          ]
        }
      }]
    }
  });

  const result = await handler({ includeAssignments: true }, context);

  assert.deepEqual(result.teamIds, ['team-1']);
  assert.equal(result.assignmentsComplete, true);
  assert.deepEqual(result.teams, [{ id: 'team-1', name: 'Alpha FC' }]);
  assert.deepEqual(result.assignments, [
    {
      kind: 'assigned',
      teamId: 'team-1',
      teamName: 'Alpha FC',
      gameId: 'game-1',
      slotId: 'mine',
      position: 'Center',
      status: 'pending',
      opponent: 'Tigers',
      location: 'Field 2',
      date: futureDate,
      canClaim: false,
      scheduleReviewRequired: false
    },
    {
      kind: 'open',
      teamId: 'team-1',
      teamName: 'Alpha FC',
      gameId: 'game-1',
      slotId: 'open',
      position: 'Line',
      status: 'open',
      opponent: 'Tigers',
      location: 'Field 2',
      date: futureDate,
      canClaim: true,
      scheduleReviewRequired: false
    }
  ]);
  assert.equal(result.assignments.some((assignment) => assignment.slotId === 'other'), false);
});

test('official discovery finds a direct canonical UID assignment without a directory row', async () => {
  const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const handler = makeHandler([], {
    uid: 'official-1',
    email: 'current@example.com',
    emailVerified: true,
    disabled: false
  }, {
    documents: {
      'teams/team-uid': { name: 'UID United', ownerId: 'coach-1', adminEmails: [] }
    },
    gamesByTeam: {
      'team-uid': [{
        id: 'game-uid',
        data: {
          date: futureDate,
          opponent: 'Tigers',
          officiatingAuthorizedUserIds: ['official-1'],
          officiatingSlots: [{
            id: 'center',
            position: 'Center',
            officialUserId: 'official-1',
            officialEmail: 'old@example.com',
            status: 'pending'
          }]
        }
      }]
    }
  });

  const result = await handler({ includeAssignments: true }, context);

  assert.deepEqual(result.teamIds, ['team-uid']);
  assert.deepEqual(result.assignments.map(({ teamId, gameId, slotId }) => ({ teamId, gameId, slotId })), [{
    teamId: 'team-uid',
    gameId: 'game-uid',
    slotId: 'center'
  }]);
});

test('official discovery finds a current verified-email assignment without a directory row', async () => {
  const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const handler = makeHandler([], {
    uid: 'official-1',
    email: 'current@example.com',
    emailVerified: true,
    disabled: false
  }, {
    documents: {
      'teams/team-email': { name: 'Email United', ownerId: 'coach-1', adminEmails: [] }
    },
    gamesByTeam: {
      'team-email': [{
        id: 'game-email',
        data: {
          date: futureDate,
          officiatingAuthorizedEmails: ['current@example.com'],
          officiatingSlots: [{
            id: 'assistant',
            officialEmail: 'current@example.com',
            status: 'pending'
          }]
        }
      }]
    }
  });

  const result = await handler({ includeAssignments: true }, context);

  assert.deepEqual(result.teamIds, ['team-email']);
  assert.equal(result.assignments[0].slotId, 'assistant');
});

test('official discovery preserves a shared UID assignment after the official email changes', async () => {
  const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const sharedGamePath = 'organizations/org-1/sharedGames/shared-uid';
  const handler = makeHandler([
    { path: 'teams/team-shared/officials/old', data: { emailLower: 'old@example.com' } }
  ], {
    uid: 'official-1',
    email: 'current@example.com',
    emailVerified: true,
    disabled: false
  }, {
    documents: {
      'teams/team-shared': { name: 'Shared United', ownerId: 'coach-1', adminEmails: [] }
    },
    sharedGames: [{
      path: sharedGamePath,
      data: {
        date: futureDate,
        homeTeamId: 'team-shared',
        officiatingAuthorizedUserIds: ['official-1'],
        officiatingSlots: [{
          id: 'line',
          position: 'Line',
          officialUserId: 'official-1',
          officialEmail: 'old@example.com',
          status: 'accepted'
        }]
      }
    }]
  });

  const result = await handler({ includeAssignments: true, requestedTeamId: 'team-shared' }, context);

  assert.deepEqual(result.teamIds, ['team-shared']);
  assert.equal(result.assignments.length, 1);
  assert.equal(result.assignments[0].sharedGamePath, sharedGamePath);
  assert.equal(result.assignments[0].slotId, 'line');
});

test('official assignment projection does not expose open slots without current team authority', async () => {
  const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const handler = makeHandler([
    { path: 'teams/team-1/officials/current', data: { emailLower: 'current@example.com' } }
  ], {
    uid: 'official-1',
    email: 'current@example.com',
    emailVerified: true,
    disabled: false
  }, {
    documents: {
      'users/official-1': { parentTeamIds: [] },
      'teams/team-1': { name: 'Alpha FC', ownerId: 'coach-1', adminEmails: [] }
    },
    gamesByTeam: {
      'team-1': [{
        id: 'game-1',
        data: {
          date: futureDate,
          officiatingSelfAssignmentEnabled: true,
          officiatingSlots: [
            { id: 'mine', officialUserId: 'official-1', status: 'pending' },
            { id: 'open', status: 'open' }
          ]
        }
      }]
    }
  });

  const result = await handler({ includeAssignments: true }, context);

  assert.deepEqual(result.assignments.map((assignment) => assignment.slotId), ['mine']);
});

test('official assignment projection includes bounded shared games without duplicating membership-query matches', async () => {
  const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const sharedPath = 'tournaments/tournament-1/sharedGames/shared-1';
  const handler = makeHandler([
    { path: 'teams/team-1/officials/current', data: { emailLower: 'current@example.com' } }
  ], {
    uid: 'official-1',
    email: 'current@example.com',
    emailVerified: true,
    disabled: false
  }, {
    documents: {
      'users/official-1': { parentTeamIds: ['team-1'] },
      'teams/team-1': { name: 'Alpha FC', ownerId: 'coach-1', adminEmails: [] }
    },
    sharedGames: [{
      path: sharedPath,
      data: {
        date: futureDate,
        homeTeamId: 'team-1',
        awayTeamId: 'team-2',
        teamIds: ['team-1', 'team-2'],
        awayTeamName: 'Tigers',
        location: 'Tournament Field',
        officiatingSelfAssignmentEnabled: true,
        officiatingSlots: [
          { id: 'mine', position: 'Center', officialUserId: 'official-1', status: 'pending' },
          { id: 'open', position: 'Line', status: 'open' }
        ]
      }
    }]
  });

  const result = await handler({ includeAssignments: true }, context);

  assert.equal(result.assignmentsComplete, true);
  assert.deepEqual(result.assignments.map((assignment) => ({
    kind: assignment.kind,
    gameId: assignment.gameId,
    slotId: assignment.slotId,
    opponent: assignment.opponent
  })), [{
    kind: 'assigned',
    gameId: `shared_${encodeURIComponent(sharedPath)}`,
    slotId: 'mine',
    opponent: 'Tigers'
  }, {
    kind: 'open',
    gameId: `shared_${encodeURIComponent(sharedPath)}`,
    slotId: 'open',
    opponent: 'Tigers'
  }]);
});

test('official assignment projection removes local mirrors of returned shared games', async () => {
  const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const sharedPath = 'tournaments/tournament-1/sharedGames/shared-1';
  const handler = makeHandler([
    { path: 'teams/team-1/officials/current', data: { emailLower: 'current@example.com' } }
  ], {
    uid: 'official-1',
    email: 'current@example.com',
    emailVerified: true,
    disabled: false
  }, {
    documents: {
      'users/official-1': {},
      'teams/team-1': { name: 'Alpha FC' }
    },
    gamesByTeam: {
      'team-1': [{
        id: 'local-mirror',
        data: {
          sharedGameId: 'shared-1',
          date: futureDate,
          opponent: 'Stale Tigers',
          officiatingSlots: [{ id: 'mine', officialUserId: 'official-1' }]
        }
      }]
    },
    sharedGames: [{
      path: sharedPath,
      data: {
        date: futureDate,
        homeTeamId: 'team-1',
        awayTeamId: 'team-2',
        awayTeamName: 'Current Tigers',
        officiatingSlots: [{ id: 'mine', officialUserId: 'official-1' }]
      }
    }]
  });

  const result = await handler({ includeAssignments: true }, context);

  assert.equal(result.assignments.length, 1);
  assert.equal(result.assignments[0].gameId, `shared_${encodeURIComponent(sharedPath)}`);
  assert.equal(result.assignments[0].opponent, 'Current Tigers');
  assert.equal(result.assignments[0].sharedGamePath, sharedPath);
});

test('official assignment projection preserves long shared-game paths with bounded opaque ids', async () => {
  const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const sharedPath = `organizations/${'o'.repeat(90)}/sharedGames/${'g'.repeat(90)}`;
  const handler = makeHandler([
    { path: 'teams/team-1/officials/current', data: { emailLower: 'current@example.com' } }
  ], {
    uid: 'official-1',
    email: 'current@example.com',
    emailVerified: true,
    disabled: false
  }, {
    documents: {
      'users/official-1': {},
      'teams/team-1': { name: 'Alpha FC' }
    },
    sharedGames: [{
      path: sharedPath,
      data: {
        date: futureDate,
        homeTeamId: 'team-1',
        officiatingSlots: [{ id: 'mine', officialUserId: 'official-1' }]
      }
    }]
  });

  const result = await handler({ includeAssignments: true }, context);

  assert.equal(result.assignments.length, 1);
  assert.match(result.assignments[0].gameId, /^sharedh_[A-Za-z0-9_-]+$/);
  assert.ok(result.assignments[0].gameId.length <= 128);
  assert.equal(result.assignments[0].sharedGamePath, sharedPath);
});

test('requested-team projection includes shared slots for a current parent without an official directory row', async () => {
  const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const sharedPath = 'tournaments/tournament-1/sharedGames/shared-requested';
  const handler = makeHandler([], {
    uid: 'official-1',
    email: 'current@example.com',
    emailVerified: true,
    disabled: false
  }, {
    documents: {
      'users/official-1': { parentTeamIds: ['team-requested'] },
      'teams/team-requested': { name: 'Requested FC', ownerId: 'coach-1', adminEmails: [] }
    },
    sharedGames: [{
      path: sharedPath,
      data: {
        date: futureDate,
        homeTeamId: 'team-requested',
        awayTeamId: 'team-2',
        awayTeamName: 'Visitors',
        officiatingSelfAssignmentEnabled: true,
        officiatingSlots: [{ id: 'open', position: 'Center', status: 'open' }]
      }
    }]
  });

  const result = await handler({ includeAssignments: true, requestedTeamId: 'team-requested' }, context);

  assert.deepEqual(result.teamIds, ['team-requested']);
  assert.equal(result.assignmentsComplete, true);
  assert.deepEqual(result.assignments.map((assignment) => ({
    kind: assignment.kind,
    slotId: assignment.slotId,
    sharedGamePath: assignment.sharedGamePath
  })), [{ kind: 'open', slotId: 'open', sharedGamePath: sharedPath }]);
});

test('requested-team projection excludes a team when current access cannot be proven', async () => {
  const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const handler = makeHandler([], {
    uid: 'official-1',
    email: 'current@example.com',
    emailVerified: true,
    disabled: false
  }, {
    documents: {
      'users/official-1': { parentTeamIds: [] },
      'teams/unrelated': { name: 'Unrelated FC', ownerId: 'coach-1', adminEmails: [] }
    },
    gamesByTeam: {
      unrelated: [{
        id: 'game-1',
        data: {
          date: futureDate,
          officiatingSlots: [{ id: 'other', officialUserId: 'someone-else', status: 'accepted' }]
        }
      }]
    }
  });

  const result = await handler({ includeAssignments: true, requestedTeamId: 'unrelated' }, context);

  assert.deepEqual(result.teamIds, []);
  assert.deepEqual(result.teams, []);
  assert.deepEqual(result.assignments, []);
  assert.equal(result.assignmentsComplete, true);
});

test('requested-team projection rejects a stored owner UID that would change when trimmed', async () => {
  const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const handler = makeHandler([], {
    uid: 'official-1',
    email: 'current@example.com',
    emailVerified: true,
    disabled: false
  }, {
    documents: {
      'users/official-1': { parentTeamIds: [] },
      'teams/unrelated': { name: 'Unrelated FC', ownerId: 'official-1 ', adminEmails: [] }
    },
    gamesByTeam: {
      unrelated: [{
        id: 'game-1',
        data: {
          date: futureDate,
          officiatingSelfAssignmentEnabled: true,
          officiatingSlots: [{ id: 'open', position: 'Center', status: 'open' }]
        }
      }]
    }
  });

  const result = await handler({ includeAssignments: true, requestedTeamId: 'unrelated' }, context);

  assert.deepEqual(result.teamIds, []);
  assert.deepEqual(result.teams, []);
  assert.deepEqual(result.assignments, []);
  assert.equal(result.assignmentsComplete, true);
});

test('official assignment projection deduplicates one shared slot linked through both teams', async () => {
  const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const sharedPath = 'tournaments/tournament-1/sharedGames/shared-both-teams';
  const handler = makeHandler([
    { path: 'teams/team-1/officials/current', data: { emailLower: 'current@example.com' } },
    { path: 'teams/team-2/officials/current', data: { emailLower: 'current@example.com' } }
  ], {
    uid: 'official-1',
    email: 'current@example.com',
    emailVerified: true,
    disabled: false
  }, {
    documents: {
      'users/official-1': {},
      'teams/team-1': { name: 'Home FC' },
      'teams/team-2': { name: 'Away FC' }
    },
    sharedGames: [{
      path: sharedPath,
      data: {
        date: futureDate,
        homeTeamId: 'team-1',
        awayTeamId: 'team-2',
        homeTeamName: 'Home FC',
        awayTeamName: 'Away FC',
        officiatingSlots: [{ id: 'mine', officialUserId: 'official-1', status: 'pending' }]
      }
    }]
  });

  const result = await handler({ includeAssignments: true }, context);

  assert.deepEqual(result.teamIds, ['team-1', 'team-2']);
  assert.equal(result.assignments.length, 1);
  assert.equal(result.assignments[0].sharedGamePath, sharedPath);
  assert.equal(result.assignments[0].slotId, 'mine');

  const requestedResult = await handler({ includeAssignments: true, requestedTeamId: 'team-2' }, context);
  assert.deepEqual(requestedResult.teamIds, ['team-1', 'team-2']);
  assert.equal(requestedResult.assignments.length, 1);
  assert.equal(requestedResult.assignments[0].teamId, 'team-2');
  assert.equal(requestedResult.assignments[0].sharedGamePath, sharedPath);
  assert.equal(requestedResult.assignments[0].slotId, 'mine');
});

test('official assignment projection fails closed when shared-game membership exceeds the bound', async () => {
  const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const handler = makeHandler([
    { path: 'teams/team-1/officials/current', data: { emailLower: 'current@example.com' } }
  ], {
    uid: 'official-1',
    email: 'current@example.com',
    emailVerified: true,
    disabled: false
  }, {
    maxGamesPerTeam: 1,
    documents: {
      'users/official-1': {},
      'teams/team-1': { name: 'Alpha FC' }
    },
    sharedGames: [1, 2].map((index) => ({
      path: `tournaments/tournament-1/sharedGames/shared-${index}`,
      data: { date: futureDate, homeTeamId: 'team-1', officiatingSlots: [] }
    }))
  });

  await assert.rejects(
    handler({ includeAssignments: true }, context),
    (error) => error.code === 'resource-exhausted'
  );
});

test('official assignment projection prefers the canonical slot UID over a reassigned email', async () => {
  const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const handler = makeHandler([
    { path: 'teams/team-1/officials/current', data: { emailLower: 'current@example.com' } }
  ], {
    uid: 'official-1',
    email: 'current@example.com',
    emailVerified: true,
    disabled: false
  }, {
    documents: {
      'users/official-1': {},
      'teams/team-1': { name: 'Alpha FC' }
    },
    gamesByTeam: {
      'team-1': [{
        id: 'game-1',
        data: {
          date: futureDate,
          officiatingSlots: [
            { id: 'stale-email', position: 'Center', officialUserId: 'other-user', officialEmail: 'current@example.com' },
            { id: 'canonical-uid', position: 'Line', officialUserId: 'official-1', officialEmail: 'old@example.com' }
          ]
        }
      }]
    }
  });

  const result = await handler({ includeAssignments: true }, context);
  assert.deepEqual(result.assignments.map((assignment) => assignment.slotId), ['canonical-uid']);
});

test('official assignment projection rejects a non-string stored UID before comparison or email fallback', async () => {
  const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const handler = makeHandler([
    { path: 'teams/team-1/officials/current', data: { emailLower: 'current@example.com' } }
  ], {
    uid: '12345',
    email: 'current@example.com',
    emailVerified: true,
    disabled: false
  }, {
    documents: {
      'users/12345': {},
      'teams/team-1': { name: 'Alpha FC' }
    },
    gamesByTeam: {
      'team-1': [{
        id: 'game-1',
        data: {
          date: futureDate,
          officiatingSlots: [{
            id: 'malformed-uid',
            position: 'Center',
            officialUserId: 12345,
            officialEmail: 'current@example.com',
            status: 'pending'
          }]
        }
      }]
    }
  });

  const result = await handler({ includeAssignments: true }, { auth: { uid: '12345' } });
  assert.deepEqual(result.assignments, []);
});

test('official assignment projection does not repair a stored UID by trimming', async () => {
  const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const handler = makeHandler([
    { path: 'teams/team-1/officials/current', data: { emailLower: 'current@example.com' } }
  ], {
    uid: 'official-1',
    email: 'current@example.com',
    emailVerified: true,
    disabled: false
  }, {
    documents: {
      'users/official-1': {},
      'teams/team-1': { name: 'Alpha FC' }
    },
    gamesByTeam: {
      'team-1': [{
        id: 'game-1',
        data: {
          date: futureDate,
          officiatingSlots: [{
            id: 'malformed-uid',
            position: 'Center',
            officialUserId: 'official-1 ',
            officialEmail: 'current@example.com',
            status: 'pending'
          }]
        }
      }]
    }
  });

  const result = await handler({ includeAssignments: true }, { auth: { uid: 'official-1' } });
  assert.deepEqual(result.assignments, []);
});

test('official assignment projection fails closed when a bounded game query overflows', async () => {
  const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const handler = makeHandler([
    { path: 'teams/team-1/officials/current', data: { emailLower: 'current@example.com' } }
  ], {
    uid: 'official-1',
    email: 'current@example.com',
    emailVerified: true,
    disabled: false
  }, {
    maxGamesPerTeam: 1,
    documents: {
      'users/official-1': {},
      'teams/team-1': { name: 'Alpha FC' }
    },
    gamesByTeam: {
      'team-1': [
        { id: 'game-1', data: { date: futureDate, officiatingSlots: [] } },
        { id: 'game-2', data: { date: futureDate, officiatingSlots: [] } }
      ]
    }
  });

  await assert.rejects(
    handler({ includeAssignments: true }, context),
    (error) => error.code === 'resource-exhausted'
  );
});

test('official discovery denies disabled accounts', async () => {
  const handler = makeHandler([], { uid: 'official-1', email: 'current@example.com', disabled: true });
  await assert.rejects(handler({}, context), (error) => error.code === 'permission-denied');
});

test('official discovery denies unverified Auth email matches', async () => {
  const handler = makeHandler([
    { path: 'teams/team-1/officials/current', data: { email: 'current@example.com' } }
  ], {
    uid: 'official-1',
    email: 'current@example.com',
    emailVerified: false,
    disabled: false
  });

  assert.deepEqual(await handler({}, context), {
    teamIds: [],
    teamCount: 0,
    isPartial: false
  });
});

test('official discovery propagates any query failure instead of returning partial empty access', async () => {
  const handler = makeHandler([], {
    uid: 'official-1',
    email: 'current@example.com',
    emailVerified: true,
    disabled: false
  }, { failField: 'emailLower' });

  await assert.rejects(handler({}, context), (error) => (
    error.code === 'unavailable'
    && /could not be verified/i.test(error.message)
  ));
});

test('official discovery fails closed when a bounded query cannot prove completeness', async () => {
  const records = [1, 2, 3].map((index) => ({
    path: `teams/team-${index}/officials/official-${index}`,
    data: { email: 'current@example.com' }
  }));
  const handler = makeHandler(records, {
    uid: 'official-1',
    email: 'current@example.com',
    emailVerified: true,
    disabled: false
  }, { maxDocumentsPerQuery: 2 });

  await assert.rejects(handler({}, context), (error) => error.code === 'resource-exhausted');
});

test('official discovery ignores malformed collection-group paths', async () => {
  const handler = makeHandler([
    { path: 'organizations/org-1/officials/not-a-team', data: { email: 'current@example.com' } },
    { path: 'teams/team-1/officials/valid', data: { email: 'current@example.com' } }
  ], {
    uid: 'official-1',
    email: 'current@example.com',
    emailVerified: true,
    disabled: false
  });

  assert.deepEqual((await handler({}, context)).teamIds, ['team-1']);
});
