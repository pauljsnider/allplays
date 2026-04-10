import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  buildLineupDraftPayload,
  buildLineupPublishPayload,
  buildLineupPublishMessage
} from '../../js/game-day-lineup-publish.js';
import { buildRotationPlanFromGamePlan } from '../../js/game-plan-interop.js';
import { getPeriodsForFormation, normalizeActivePeriod } from '../../js/game-day-periods.js';

describe('game day lineup publish helpers', () => {
  it('builds a published lineup payload with versioned metadata and recipients', () => {
    const publishedAt = new Date('2026-03-11T23:25:26.000Z');
    const payload = buildLineupPublishPayload({
      formationId: 'soccer-9v9',
      numPeriods: 2,
      rotationPlan: {
        H1: { keeper: 'p1', striker: 'p2' },
        H2: { keeper: 'p3' }
      },
      previousGamePlan: {
        publishedVersion: 2,
        publishedLineups: {
          'H1-keeper': 'p1',
          'H1-striker': 'p9'
        },
        publishedReadBy: ['old-user']
      },
      publishedBy: 'coach-1',
      publishedByName: 'Coach Kim',
      publishedAt,
      recipientPlayerIds: ['p1', 'p2', 'p3'],
      recipientParentIds: ['parent-1']
    });

    expect(payload).toMatchObject({
      formationId: 'soccer-9v9',
      numPeriods: 2,
      lineups: {
        'H1-keeper': 'p1',
        'H1-striker': 'p2',
        'H2-keeper': 'p3'
      },
      isPublished: true,
      publishedBy: 'coach-1',
      publishedByName: 'Coach Kim',
      publishedVersion: 3,
      publishedFormationId: 'soccer-9v9',
      publishedNumPeriods: 2,
      publishedLineups: {
        'H1-keeper': 'p1',
        'H1-striker': 'p2',
        'H2-keeper': 'p3'
      },
      publishedRecipientPlayerIds: ['p1', 'p2', 'p3'],
      publishedRecipientParentIds: ['parent-1'],
      publishedReadBy: []
    });
    expect(payload.publishedAt).toBe(publishedAt);
  });

  it('builds a draft payload that preserves the last published snapshot but clears active published state', () => {
    const payload = buildLineupDraftPayload({
      formationId: 'basketball-5v5',
      numPeriods: 4,
      rotationPlan: {
        Q1: { pg: 'p1' }
      },
      previousGamePlan: {
        isPublished: true,
        publishedVersion: 4,
        publishedLineups: { 'Q1-pg': 'old-pg' },
        publishedFormationId: 'basketball-5v5',
        publishedNumPeriods: 4,
        publishedRecipientPlayerIds: ['p1'],
        publishedRecipientParentIds: ['parent-1'],
        publishedReadBy: ['viewer-1']
      }
    });

    expect(payload).toMatchObject({
      formationId: 'basketball-5v5',
      numPeriods: 4,
      lineups: { 'Q1-pg': 'p1' },
      isPublished: false,
      publishedVersion: 4,
      publishedLineups: { 'Q1-pg': 'old-pg' },
      publishedFormationId: 'basketball-5v5',
      publishedNumPeriods: 4,
      publishedRecipientPlayerIds: ['p1'],
      publishedRecipientParentIds: ['parent-1'],
      publishedReadBy: ['viewer-1']
    });
  });

  it('formats a publish message that distinguishes first publish from updates', () => {
    expect(buildLineupPublishMessage({
      opponentName: 'Lions',
      publishedVersion: 1,
      changedAssignments: 0
    })).toContain('published');

    expect(buildLineupPublishMessage({
      opponentName: 'Lions',
      publishedVersion: 2,
      changedAssignments: 3
    })).toContain('updated');
  });

  it('round-trips a saved 4-period lineup and restores the first visible game-day period', () => {
    const rotationPlan = {
      Q1: { pg: 'p1', sg: 'p2' },
      Q2: { pg: 'p3', sg: 'p4' },
      Q3: { pg: 'p5' },
      Q4: { pg: 'p6' }
    };

    const payload = buildLineupPublishPayload({
      formationId: 'basketball-5v5',
      numPeriods: 4,
      rotationPlan,
      previousGamePlan: {}
    });

    expect(payload).toMatchObject({
      formationId: 'basketball-5v5',
      numPeriods: 4,
      lineups: {
        'Q1-pg': 'p1',
        'Q1-sg': 'p2',
        'Q2-pg': 'p3',
        'Q2-sg': 'p4',
        'Q3-pg': 'p5',
        'Q4-pg': 'p6'
      }
    });

    expect(buildRotationPlanFromGamePlan(payload)).toEqual(rotationPlan);
    expect(normalizeActivePeriod(getPeriodsForFormation(payload), 'H1')).toBe('Q1');
  });
});

describe('game-day page wiring', () => {
  it('exposes publish controls and posts a team notification only after persistence succeeds', () => {
    const source = readFileSync(resolve(process.cwd(), 'game-day.html'), 'utf8');

    expect(source).toContain('Publish Lineup');
    expect(source).toContain('window.publishGamePlan');
    expect(source).toContain('postChatMessage(');
    expect(source).toContain('afterPersist: async () => {');
    expect(source).toContain("await updateGame(state.teamId, state.gameId, { gamePlan });");
    expect(source).toContain('renderLineupPublishStatus');
  });

  it('surfaces partial publish failures and uses the persisted game plan as the publish baseline', () => {
    const source = readFileSync(resolve(process.cwd(), 'game-day.html'), 'utf8');

    expect(source).toContain('return state.game?.gamePlan || state.gamePlan || {};');
    expect(source).toContain('previousGamePlan: getPersistedGamePlan()');
    expect(source).toContain('previousGamePlan?.publishedLineups');
    expect(source).toContain("alert('Lineup published successfully, but the team notification could not be sent. Please notify your team manually.');");
  });

  it('normalizes the visible game-day period when a saved lineup reloads', () => {
    const source = readFileSync(resolve(process.cwd(), 'game-day.html'), 'utf8');

    expect(source).toContain("import { getPeriodsForFormation, normalizeActivePeriod } from './js/game-day-periods.js?v=1';");
    expect(source).toContain('state.activePeriodGD = normalizeActivePeriod(periods, state.activePeriodGD);');
  });
});
