import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, ChevronLeft, RefreshCw } from 'lucide-react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { resolveParentGameRoute, type ParentGameRouteResolution } from '../lib/scheduleService'
import type { AuthState } from '../lib/types'

type ResolutionState = {
  loading: boolean
  targetRoute: ParentGameRouteResolution | null
  error: string | null
}

export function GameDetail({ auth }: { auth: AuthState }) {
  const { gameId = '' } = useParams()
  const [state, setState] = useState<ResolutionState>({
    loading: true,
    targetRoute: null,
    error: null
  })

  useEffect(() => {
    let cancelled = false

    async function resolveGameRoute() {
      if (!auth.user || !gameId) {
        if (!cancelled) {
          setState({ loading: false, targetRoute: null, error: 'This game is not available right now.' })
        }
        return
      }

      setState({ loading: true, targetRoute: null, error: null })

      try {
        const targetRoute = await resolveParentGameRoute(auth.user, gameId, { expandStaffPlayers: false })

        if (cancelled) return

        if (!targetRoute) {
          setState({
            loading: false,
            targetRoute: null,
            error: 'We could not find this game in your live schedule. Open Schedule to find the event or refresh after the team shares access.'
          })
          return
        }

        setState({ loading: false, targetRoute, error: null })
      } catch (error: any) {
        if (cancelled) return
        setState({
          loading: false,
          targetRoute: null,
          error: error?.message || 'Unable to open this game right now.'
        })
      }
    }

    resolveGameRoute()

    return () => {
      cancelled = true
    }
  }, [auth.user, gameId])

  const redirectTarget = useMemo(() => {
    if (!state.targetRoute) return ''
    const params = new URLSearchParams()
    if (state.targetRoute.childId) {
      params.set('childId', state.targetRoute.childId)
    }
    params.set('section', 'game')
    const search = params.toString()
    return `/schedule/${encodeURIComponent(state.targetRoute.teamId)}/${encodeURIComponent(state.targetRoute.eventId)}${search ? `?${search}` : ''}`
  }, [state.targetRoute])

  if (redirectTarget) {
    return <Navigate to={redirectTarget} replace />
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
