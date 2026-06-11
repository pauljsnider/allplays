// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const scheduleServiceMocks = vi.hoisted(() => ({
  resolveParentGameRoute: vi.fn()
}))

vi.mock('../lib/scheduleService', () => scheduleServiceMocks)

import { GameDetail } from './GameDetail'
import type { AuthState } from '../lib/types'

const auth: AuthState = {
  user: {
    uid: 'parent-1',
    email: 'parent@example.com',
    displayName: 'Pat Parent'
  } as any,
  profile: null,
  loading: false,
  error: null,
  roles: ['parent'],
  isParent: true,
  isCoach: false,
  isAdmin: false,
  isPlatformAdmin: false,
  refresh: vi.fn(),
  signOut: vi.fn()
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>
}

function renderGameDetail(path = '/games/game-1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/games/:gameId" element={<GameDetail auth={auth} />} />
        <Route path="/schedule/:teamId/:eventId" element={(
          <div>
            <h1>Availability</h1>
            <div>Rideshare</div>
            <div>Assignments</div>
            <div>Game hub</div>
            <div>Live event workflow</div>
            <LocationProbe />
          </div>
        )}
        />
        <Route path="/schedule" element={<div>Schedule home</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('GameDetail route resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('routes /games/:gameId into the schedule event detail workflow with game section context', async () => {
    scheduleServiceMocks.resolveParentGameRoute.mockResolvedValue({
      teamId: 'team-bears',
      eventId: 'game-1',
      childId: 'player-7'
    })

    renderGameDetail()

    expect(screen.getByText('Opening game')).toBeTruthy()

    await waitFor(() => {
      expect(screen.getByText('Live event workflow')).toBeTruthy()
    })

    expect(screen.getByTestId('location').textContent).toBe('/schedule/team-bears/game-1?childId=player-7&section=game')
    expect(screen.getByRole('heading', { name: 'Availability' })).toBeTruthy()
    expect(screen.getByText('Rideshare')).toBeTruthy()
    expect(screen.getByText('Assignments')).toBeTruthy()
    expect(screen.queryByText('Live chat')).toBeNull()
    expect(screen.queryByText('Player Performance')).toBeNull()
    expect(scheduleServiceMocks.resolveParentGameRoute).toHaveBeenCalledWith(auth.user, 'game-1', {
      expandStaffPlayers: false
    })
  })

  it('shows a recovery state when the game cannot be resolved', async () => {
    scheduleServiceMocks.resolveParentGameRoute.mockResolvedValue(null)

    renderGameDetail('/games/missing-game')

    await waitFor(() => {
      expect(screen.getByText('Game not available')).toBeTruthy()
    })

    expect(screen.getByText(/could not find this game in your live schedule/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Schedule' }).getAttribute('href')).toBe('/schedule')
    expect(screen.queryByText('Live event workflow')).toBeNull()
  })
})
