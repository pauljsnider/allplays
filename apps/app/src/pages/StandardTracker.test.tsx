// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStandardTrackerSessionKey } from '../lib/standardTrackerSession';
import type { AuthState } from '../lib/types';

const scheduleServiceMocks = vi.hoisted(() => ({
  loadHomeScoringPlayers: vi.fn(),
  loadParentScheduleEventDetail: vi.fn(),
  loadScheduleStatTrackerConfigsForApp: vi.fn(),
  updateGameScore: vi.fn()
}));

const statTrackingMocks = vi.hoisted(() => {
  let lastService: any = null;

  function normalizeScore(score: any) {
    return {
      homeScore: Math.max(0, Number(score?.homeScore || 0)),
      awayScore: Math.max(0, Number(score?.awayScore || 0))
    };
  }

  function normalizeStatKey(value: unknown) {
    return String(value || '').trim().toLowerCase();
  }

  function isScoringStatKey(statKey: string) {
    return statKey === 'pts' || statKey === 'points' || statKey === 'goals' || statKey === 'goal';
  }

  const createDefaultStatTrackingService = vi.fn((options: any = {}) => {
    let currentScore = normalizeScore(options.initialScore);
    const log = [...(Array.isArray(options.initialEventLog) ? options.initialEventLog : [])];
    const service = {
      recordEvent: vi.fn(async (_teamId: string, _gameId: string, input: any, user: any) => {
        const statKey = normalizeStatKey(input?.undoData?.statKey);
        const value = Number(input?.undoData?.value || 0);
        const scoreBefore = { ...currentScore };
        const scoreAfter = { ...currentScore };
        if (isScoringStatKey(statKey)) {
          if (input?.teamSide === 'away') scoreAfter.awayScore += value;
          else scoreAfter.homeScore += value;
        }
        const entry = {
          eventId: `event-${log.length + 1}`,
          event: {
            text: input?.text || '',
            gameTime: input?.clock || '',
            period: input?.period || '',
            timestamp: input?.timestamp || 0,
            type: 'stat',
            playerId: input?.undoData?.playerId || '',
            statKey,
            value,
            isOpponent: input?.undoData?.isOpponent === true,
            createdBy: user?.uid || ''
          },
          scoreBefore,
          scoreAfter,
          aggregateStatKey: statKey,
          aggregateDelta: value,
          aggregatePlayerId: input?.undoData?.playerId || null,
          isOpponent: input?.undoData?.isOpponent === true,
          playerName: input?.playerName || 'Player',
          playerNumber: input?.playerNumber || ''
        };
        currentScore = scoreAfter;
        log.push(entry);
        return entry;
      }),
      undoLastEvent: vi.fn(async () => {
        const entry = log.pop() || null;
        if (entry) currentScore = { ...entry.scoreBefore };
        return entry;
      }),
      getEventLog: vi.fn(() => log.map((entry) => ({ ...entry, event: { ...entry.event } }))),
      getCurrentScore: vi.fn(() => ({ ...currentScore }))
    };
    lastService = service;
    return service;
  });

  return {
    createDefaultStatTrackingService,
    getLastService: () => lastService
  };
});

vi.mock('../lib/scheduleService', () => scheduleServiceMocks);
vi.mock('../lib/statTrackingService', () => ({
  createDefaultStatTrackingService: statTrackingMocks.createDefaultStatTrackingService
}));

import { StandardTracker } from './StandardTracker';

const auth: AuthState = {
  user: {
    uid: 'coach-1',
    email: 'coach@example.com',
    displayName: 'Coach Carter'
  } as any,
  profile: null,
  loading: false,
  error: null,
  roles: ['coach'],
  isParent: false,
  isCoach: true,
  isAdmin: false,
  isPlatformAdmin: false,
  refresh: vi.fn(),
  signOut: vi.fn()
};

const parentAuth: AuthState = {
  ...auth,
  roles: ['parent'],
  isParent: true,
  isCoach: false
};

function buildEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'game-1',
    teamId: 'team-1',
    teamName: 'Bears',
    type: 'game',
    isDbGame: true,
    isCancelled: false,
    canUpdateScore: true,
    statTrackerConfigId: 'cfg-soccer',
    opponent: 'Wolves',
    homeScore: 1,
    awayScore: 0,
    isHome: true,
    liveClockPeriod: 'H1',
    ...overrides
  } as any;
}

function configureDefaultMocks() {
  scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
    events: [buildEvent()],
    children: []
  });
  scheduleServiceMocks.loadScheduleStatTrackerConfigsForApp.mockResolvedValue([
    {
      id: 'cfg-soccer',
      name: 'Soccer standard',
      baseType: 'Soccer',
      columns: ['GOALS', 'SHOTS'],
      statDefinitions: [
        { id: 'goals', label: 'GOALS' },
        { id: 'shots', label: 'SHOTS' }
      ]
    }
  ]);
  scheduleServiceMocks.loadHomeScoringPlayers.mockResolvedValue([
    { id: 'p1', name: 'Avery Smith', number: '12', points: 0, fouls: 0, stats: { goals: 0, shots: 2 } },
    { id: 'p2', name: 'Blake Jones', number: '7', points: 0, fouls: 0, stats: { goals: 1, shots: 0 } }
  ]);
}

function renderTracker(authOverride = auth) {
  return render(
    <MemoryRouter initialEntries={['/schedule/team-1/game-1/track']}>
      <Routes>
        <Route path="/schedule/:teamId/:eventId/track" element={<StandardTracker auth={authOverride} />} />
      </Routes>
    </MemoryRouter>
  );
}

function installTestLocalStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, String(value));
      }),
      removeItem: vi.fn((key: string) => {
        values.delete(key);
      }),
      clear: vi.fn(() => {
        values.clear();
      })
    }
  });
}

describe('StandardTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installTestLocalStorage();
    configureDefaultMocks();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('records config-column roster stats through the shared tracking service and syncs undo UI state', async () => {
    renderTracker();

    expect(await screen.findByTestId('standard-tracker-grid')).toBeTruthy();
    expect(statTrackingMocks.createDefaultStatTrackingService).toHaveBeenCalledWith(expect.objectContaining({
      statConfig: expect.objectContaining({ id: 'cfg-soccer', columns: ['GOALS', 'SHOTS'] }),
      initialScore: { homeScore: 1, awayScore: 0 }
    }));

    fireEvent.click(screen.getByRole('button', { name: '#12 Avery Smith GOALS add one' }));

    const service = statTrackingMocks.getLastService();
    await waitFor(() => {
      expect(service.recordEvent).toHaveBeenCalledWith('team-1', 'game-1', expect.objectContaining({
        text: '#12 Avery Smith GOALS +1',
        period: 'H1',
        undoData: expect.objectContaining({ playerId: 'p1', statKey: 'goals', value: 1 })
      }), auth.user);
    });

    await waitFor(() => {
      expect(screen.getByText('2-0')).toBeTruthy();
      expect(within(screen.getByTestId('standard-tracker-row-p1')).getByText('+1 / 1')).toBeTruthy();
      expect(screen.getByText('#12 Avery Smith GOALS +1 recorded.')).toBeTruthy();
    });

    const savedSession = JSON.parse(window.localStorage.getItem(getStandardTrackerSessionKey('team-1', 'game-1')) || '{}');
    expect(savedSession).toMatchObject({
      statTrackerConfigId: 'cfg-soccer',
      score: { homeScore: 2, awayScore: 0 },
      tallies: { p1: { goals: 1, shots: 2 } }
    });

    fireEvent.click(screen.getByRole('button', { name: /Undo last/i }));

    await waitFor(() => {
      expect(service.undoLastEvent).toHaveBeenCalledWith('team-1', 'game-1', auth.user);
      expect(screen.getByText('1-0')).toBeTruthy();
      expect(within(screen.getByTestId('standard-tracker-row-p1')).getByText('+1 / 0')).toBeTruthy();
      expect(screen.getByText('Undid #12 Avery Smith GOALS +1.')).toBeTruthy();
    });
  });

  it('hydrates a restored app tracker session before allowing undo', async () => {
    window.localStorage.setItem(getStandardTrackerSessionKey('team-1', 'game-1'), JSON.stringify({
      version: 1,
      teamId: 'team-1',
      gameId: 'game-1',
      statTrackerConfigId: 'cfg-soccer',
      score: { homeScore: 2, awayScore: 0 },
      tallies: { p1: { goals: 2, shots: 2 } },
      eventLog: [{
        eventId: 'restored-goal-2',
        event: {
          text: '#12 Avery Smith GOALS +1',
          gameTime: '',
          period: 'H1',
          timestamp: 2001,
          type: 'stat',
          playerId: 'p1',
          statKey: 'goals',
          value: 1,
          isOpponent: false,
          createdBy: 'coach-1'
        },
        scoreBefore: { homeScore: 1, awayScore: 0 },
        scoreAfter: { homeScore: 2, awayScore: 0 },
        aggregateStatKey: 'goals',
        aggregateDelta: 1,
        aggregatePlayerId: 'p1',
        isOpponent: false,
        playerName: 'Avery Smith',
        playerNumber: '12'
      }],
      updatedAt: Date.now()
    }));

    renderTracker();

    expect(await screen.findByTestId('standard-tracker-grid')).toBeTruthy();
    expect(statTrackingMocks.createDefaultStatTrackingService).toHaveBeenCalledWith(expect.objectContaining({
      initialScore: { homeScore: 2, awayScore: 0 },
      initialEventLog: [expect.objectContaining({ eventId: 'restored-goal-2' })]
    }));
    expect(screen.getByText('2-0')).toBeTruthy();
    expect(within(screen.getByRole('button', { name: '#12 Avery Smith GOALS add one' })).getByText('+1 / 2')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Undo last/i }));

    await waitFor(() => {
      expect(screen.getByText('1-0')).toBeTruthy();
      expect(within(screen.getByRole('button', { name: '#12 Avery Smith GOALS add one' })).getByText('+1 / 1')).toBeTruthy();
      expect(screen.getByText('Undid #12 Avery Smith GOALS +1.')).toBeTruthy();
    });
  });

  it('blocks parent-only access before loading tracker config or roster', async () => {
    scheduleServiceMocks.loadParentScheduleEventDetail.mockResolvedValue({
      events: [buildEvent({ canUpdateScore: false })],
      children: []
    });

    renderTracker(parentAuth);

    expect(await screen.findByText('Tracker access is limited to staff scorekeepers for scheduled games.')).toBeTruthy();
    expect(screen.queryByTestId('standard-tracker-grid')).toBeNull();
    expect(scheduleServiceMocks.loadScheduleStatTrackerConfigsForApp).not.toHaveBeenCalled();
    expect(scheduleServiceMocks.loadHomeScoringPlayers).not.toHaveBeenCalled();
    expect(statTrackingMocks.createDefaultStatTrackingService).not.toHaveBeenCalled();
  });
});
