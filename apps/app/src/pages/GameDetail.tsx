import { useEffect, useState } from 'react'
import { AlertCircle, ChevronLeft, RefreshCw } from 'lucide-react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { getGenericEventDetailPath } from '../lib/scheduleLogic'
import { loadParentScheduleEventDetail, resolveParentGameRoute } from '../lib/scheduleService'
import type { AuthState } from '../lib/types'

type ResolutionState = {
  loading: boolean
  redirectTarget: string
  error: string | null
}

export function GameDetail({ auth }: { auth: AuthState }) {
  const { gameId = '' } = useParams()
  const [state, setState] = useState<ResolutionState>({
    loading: true,
    redirectTarget: '',
    error: null
  })

  useEffect(() => {
    let cancelled = false

    async function resolveGameRoute() {
      if (!auth.user || !gameId) {
        if (!cancelled) {
          setState({ loading: false, redirectTarget: '', error: 'This game is not available right now.' })
        }
        return
      }

      setState({ loading: true, redirectTarget: '', error: null })

      try {
        const targetRoute = await resolveParentGameRoute(auth.user, gameId, { expandStaffPlayers: false })

        if (cancelled) return

        if (!targetRoute) {
          setState({
            loading: false,
            redirectTarget: '',
            error: 'We could not find this game in your live schedule. Open Schedule to find the event or refresh after the team shares access.'
          })
          return
        }

        const fallbackParams = new URLSearchParams()
        if (targetRoute.childId) {
          fallbackParams.set('childId', targetRoute.childId)
        }
        fallbackParams.set('section', 'game')
        const fallbackQuery = fallbackParams.toString()
        const fallbackTarget = `/schedule/${encodeURIComponent(targetRoute.teamId)}/${encodeURIComponent(targetRoute.eventId)}${fallbackQuery ? `?${fallbackQuery}` : ''}`

        if (targetRoute.cachedEvent) {
          setState({
            loading: false,
            redirectTarget: getGenericEventDetailPath(targetRoute.cachedEvent, true),
            error: null
          })
          return
        }

        try {
          const detail = await loadParentScheduleEventDetail(auth.user, {
            teamId: targetRoute.teamId,
            eventId: targetRoute.eventId,
            expandStaffPlayers: false
          })

          if (cancelled) return

          const matchedEvent = detail.events.find((event) => event.childId === targetRoute.childId) || detail.events[0]

          setState({
            loading: false,
            redirectTarget: matchedEvent ? getGenericEventDetailPath(matchedEvent, true) : fallbackTarget,
            error: null
          })
        } catch {
          if (cancelled) return
          setState({
            loading: false,
            redirectTarget: fallbackTarget,
            error: null
          })
        }
      } catch (error: any) {
        if (cancelled) return
        setState({
          loading: false,
          redirectTarget: '',
          error: error?.message || 'Unable to open this game right now.'
        })
      }
    }

    resolveGameRoute()

    return () => {
      cancelled = true
    }
  }, [auth.user, gameId])

  if (state.redirectTarget) {
    return <Navigate to={state.redirectTarget} replace />
  }

  if (state.loading) {
    return (
      <div className="app-card p-6 text-center">
        <RefreshCw className="mx-auto h-8 w-8 animate-spin text-primary-600" aria-hidden="true" />
        <div className="mt-3 text-sm font-black text-gray-900">Opening game</div>
        <div className="mt-1 text-xs font-semibold text-gray-500">Routing you to the live event workflow.</div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <Link to="/schedule" className="ghost-button min-h-9 px-3 text-xs">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Schedule
      </Link>
      <div className="app-card p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-amber-50 text-amber-700">
            <AlertCircle className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <div className="text-sm font-black text-gray-950">Game not available</div>
            <div className="mt-1 text-sm font-semibold leading-6 text-gray-600">{state.error || 'Open Schedule to find the live event details for this game.'}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
