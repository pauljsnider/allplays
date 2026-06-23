import { lazy, ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProtectedRouteSkeleton } from './components/PageSkeletons';
import { ScrollRestoration } from './components/ScrollRestoration';
import {
  addNativeBackButtonListener,
  dispatchNativeBackDismissEvent,
  exitNativeApp,
  getNativeBackTarget,
  isNativeExitRoute,
  nativeBackExitPressWindowMs,
  type NativeBackButtonEvent
} from './lib/nativeBackButton';
import { addNativeDeepLinkListener } from './lib/nativeDeepLinkRouting';
import { clearPendingPushRoute, readPendingPushRoute } from './lib/pushNotificationRouting';
import { readAuthBootstrapHint } from './lib/authBootstrapHint';
import { useAuth } from './lib/useAuth';
import type { AuthState } from './lib/types';

const AuthPage = lazy(() => import('./pages/AuthPage').then((module) => ({ default: module.AuthPage })));
const AcceptInvite = lazy(() => import('./pages/AcceptInvite').then((module) => ({ default: module.AcceptInvite })));
const CapabilityPage = lazy(() => import('./pages/CapabilityPage').then((module) => ({ default: module.CapabilityPage })));
const GameDetail = lazy(() => import('./pages/GameDetail').then((module) => ({ default: module.GameDetail })));
const HelpArticle = lazy(() => import('./pages/HelpArticle').then((module) => ({ default: module.HelpArticle })));
const HelpPortal = lazy(() => import('./pages/HelpPortal').then((module) => ({ default: module.HelpPortal })));
const Home = lazy(() => import('./pages/Home').then((module) => ({ default: module.Home })));
const Messages = lazy(() => import('./pages/Messages').then((module) => ({ default: module.Messages })));
const Officials = lazy(() => import('./pages/Officials').then((module) => ({ default: module.Officials })));
const ParentTools = lazy(() => import('./pages/ParentTools').then((module) => ({ default: module.ParentTools })));
const RegistrationDetail = lazy(() => import('./pages/RegistrationDetail').then((module) => ({ default: module.RegistrationDetail })));
const TeamRegistrationReview = lazy(() => import('./pages/RegistrationDetail').then((module) => ({ default: module.TeamRegistrationReview })));
const PlayerDetail = lazy(() => import('./pages/PlayerDetail').then((module) => ({ default: module.PlayerDetail })));
const PrivateAiChat = lazy(() => import('./pages/PrivateAiChat').then((module) => ({ default: module.PrivateAiChat })));
const Profile = lazy(() => import('./pages/Profile').then((module) => ({ default: module.Profile })));
const PublicTeamsBrowse = lazy(() => import('./pages/PublicTeamsBrowse').then((module) => ({ default: module.PublicTeamsBrowse })));
const ResetPassword = lazy(() => import('./pages/ResetPassword').then((module) => ({ default: module.ResetPassword })));
const Schedule = lazy(() => import('./pages/Schedule').then((module) => ({ default: module.Schedule })));
const ScheduleEventDetail = lazy(() => import('./pages/ScheduleEventDetail').then((module) => ({ default: module.ScheduleEventDetail })));
const StandardTracker = lazy(() => import('./pages/StandardTracker').then((module) => ({ default: module.StandardTracker })));
const TeamDetail = lazy(() => import('./pages/TeamDetail').then((module) => ({ default: module.TeamDetail })));
const TeamSettings = lazy(() => import('./pages/TeamSettings').then((module) => ({ default: module.TeamSettings })));
const TeamCertificates = lazy(() => import('./pages/TeamCertificates').then((module) => ({ default: module.TeamCertificates })));
const TeamDrills = lazy(() => import('./pages/TeamDrills').then((module) => ({ default: module.TeamDrills })));
const TeamFees = lazy(() => import('./pages/TeamFees').then((module) => ({ default: module.TeamFees })));
const TeamMedia = lazy(() => import('./pages/TeamMedia').then((module) => ({ default: module.TeamMedia })));
const Teams = lazy(() => import('./pages/Teams').then((module) => ({ default: module.Teams })));
const VerifyPending = lazy(() => import('./pages/VerifyPending').then((module) => ({ default: module.VerifyPending })));

const protectedRouteBootstrapGraceMs = 750;

export default function App() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const authUserRef = useRef(auth.user);
  const locationRef = useRef(location);
  const lastNativeExitBackPressRef = useRef(0);
  const nativeExitNoticeTimeoutRef = useRef<number | null>(null);
  const [nativeExitNoticeVisible, setNativeExitNoticeVisible] = useState(false);

  useEffect(() => {
    authUserRef.current = auth.user;
  }, [auth.user]);

  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  useEffect(() => {
    return () => {
      if (nativeExitNoticeTimeoutRef.current !== null) {
        window.clearTimeout(nativeExitNoticeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let removeListener = () => {};
    let disposed = false;

    async function registerBackButtonListener() {
      removeListener = await addNativeBackButtonListener((event) => {
        handleNativeBackButton(event);
      });
      if (disposed) removeListener();
    }

    function handleNativeBackButton(event: NativeBackButtonEvent) {
      if (dispatchNativeBackDismissEvent()) return;

      const { pathname, search } = locationRef.current;
      const target = getNativeBackTarget(pathname, search);
      if (target) {
        lastNativeExitBackPressRef.current = 0;
        setNativeExitNoticeVisible(false);
        navigate(target, { replace: pathname === '/home' });
        return;
      }

      if (event.canGoBack && !isNativeExitRoute(pathname, search)) {
        lastNativeExitBackPressRef.current = 0;
        setNativeExitNoticeVisible(false);
        navigate(-1);
        return;
      }

      const now = Date.now();
      if (now - lastNativeExitBackPressRef.current <= nativeBackExitPressWindowMs) {
        setNativeExitNoticeVisible(false);
        void exitNativeApp();
        return;
      }

      lastNativeExitBackPressRef.current = now;
      setNativeExitNoticeVisible(true);
      if (nativeExitNoticeTimeoutRef.current !== null) {
        window.clearTimeout(nativeExitNoticeTimeoutRef.current);
      }
      nativeExitNoticeTimeoutRef.current = window.setTimeout(() => {
        setNativeExitNoticeVisible(false);
      }, nativeBackExitPressWindowMs);
    }

    registerBackButtonListener();
    return () => {
      disposed = true;
      removeListener();
    };
  }, [navigate]);

  useEffect(() => {
    let removeListener = () => {};
    let disposed = false;

    async function registerDeepLinkListener() {
      removeListener = await addNativeDeepLinkListener((route) => {
        navigate(route);
      });
      if (disposed) removeListener();
    }

    registerDeepLinkListener();
    return () => {
      disposed = true;
      removeListener();
    };
  }, [navigate]);

  useEffect(() => {
    let active = true;
    let removeListener = () => {};

    async function registerPushListener() {
      // Dynamically import the push stack (Firebase messaging) so it stays out of
      // the boot critical path; registration only needs to run after first paint.
      const { addPushNotificationOpenListener, ensureAndroidNotificationChannels } = await import('./lib/pushService');
      await ensureAndroidNotificationChannels();
      const remove = await addPushNotificationOpenListener((route) => {
        if (authUserRef.current) {
          navigate(route, { replace: true });
        }
      });
      if (!active) {
        remove();
        return;
      }
      removeListener = remove;
    }

    void registerPushListener();
    return () => {
      active = false;
      removeListener();
    };
  }, [navigate]);

  useEffect(() => {
    if (auth.loading || !auth.user) {
      return;
    }

    const pendingRoute = readPendingPushRoute();
    if (!pendingRoute) {
      return;
    }

    const currentRoute = `${location.pathname}${location.search}`;
    clearPendingPushRoute();
    if (pendingRoute !== currentRoute) {
      navigate(pendingRoute, { replace: true });
    }
  }, [auth.loading, auth.user, location.pathname, location.search, navigate]);

  return (
    <Suspense fallback={<LoadingScreen />}>
      <ScrollRestoration />
      <Routes>
        <Route path="/auth" element={<AuthPage auth={auth} />} />
        <Route path="/accept-invite" element={<AcceptInvite auth={auth} />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/verify-pending" element={<VerifyPending auth={auth} />} />
        <Route path="/registration" element={<AppShell auth={auth}><RegistrationDetail auth={auth} publicAccess /></AppShell>} />
        <Route path="/" element={<Navigate to={auth.user ? '/home' : '/auth'} replace />} />
        <Route path="/home" element={<Protected auth={auth}><Home auth={auth} /></Protected>} />
        <Route path="/officials" element={<Protected auth={auth}><Officials auth={auth} /></Protected>} />
        <Route path="/schedule" element={<Protected auth={auth}><Schedule auth={auth} /></Protected>} />
        <Route path="/schedule/:teamId/:eventId/track" element={<Protected auth={auth}><StandardTracker auth={auth} /></Protected>} />
        <Route path="/schedule/:teamId/:eventId" element={<Protected auth={auth}><ScheduleEventDetail auth={auth} /></Protected>} />
        <Route path="/messages" element={<Protected auth={auth}><Messages auth={auth} /></Protected>} />
        <Route path="/messages/:teamId" element={<Protected auth={auth}><Messages auth={auth} /></Protected>} />
        <Route path="/ai" element={<Protected auth={auth}><PrivateAiChat auth={auth} /></Protected>} />
        <Route path="/teams" element={<Protected auth={auth}><Teams auth={auth} /></Protected>} />
        <Route path="/teams/browse" element={<Protected auth={auth}><PublicTeamsBrowse /></Protected>} />
        <Route path="/teams/:teamId" element={<Protected auth={auth}><TeamDetail auth={auth} /></Protected>} />
        <Route path="/teams/:teamId/edit" element={<Protected auth={auth}><TeamSettings auth={auth} /></Protected>} />
        <Route path="/teams/:teamId/certificates" element={<Protected auth={auth}><TeamCertificates auth={auth} /></Protected>} />
        <Route path="/teams/:teamId/drills" element={<Protected auth={auth}><TeamDrills auth={auth} /></Protected>} />
        <Route path="/teams/:teamId/fees" element={<Protected auth={auth}><TeamFees auth={auth} /></Protected>} />
        <Route path="/teams/:teamId/fees/:batchId" element={<Protected auth={auth}><TeamFees auth={auth} /></Protected>} />
        <Route path="/teams/:teamId/media" element={<Protected auth={auth}><TeamMedia auth={auth} /></Protected>} />
        <Route path="/teams/:teamId/registrations/:formId" element={<Protected auth={auth}><TeamRegistrationReview auth={auth} /></Protected>} />
        <Route path="/parent-tools" element={<Protected auth={auth}><ParentTools auth={auth} /></Protected>} />
        <Route path="/parent-tools/registrations/:teamId/:formId" element={<Protected auth={auth}><RegistrationDetail auth={auth} /></Protected>} />
        <Route path="/parent-tools/:toolId" element={<Protected auth={auth}><ParentTools auth={auth} /></Protected>} />
        <Route path="/players/:teamId/:playerId" element={<Protected auth={auth}><PlayerDetail auth={auth} /></Protected>} />
        <Route path="/players/:playerId" element={<Protected auth={auth}><PlayerDetail auth={auth} /></Protected>} />
        <Route path="/games/:gameId" element={<Protected auth={auth}><GameDetail auth={auth} /></Protected>} />
        <Route path="/help" element={<Protected auth={auth}><HelpPortal /></Protected>} />
        <Route path="/help/:helpId" element={<Protected auth={auth}><HelpArticle /></Protected>} />
        <Route path="/profile" element={<Protected auth={auth}><Profile auth={auth} /></Protected>} />
        <Route path="/capabilities/:capabilityId" element={<Protected auth={auth}><CapabilityPage /></Protected>} />
        <Route path="*" element={<Navigate to={auth.user ? '/home' : '/auth'} replace />} />
      </Routes>
      {nativeExitNoticeVisible ? (
        <div className="fixed inset-x-0 bottom-24 z-[80] flex justify-center px-4" role="status" aria-live="polite">
          <div className="rounded-full bg-gray-950 px-4 py-2 text-sm font-black text-white shadow-app-lg">Press back again to exit</div>
        </div>
      ) : null}
    </Suspense>
  );
}

function Protected({ auth, children }: { auth: AuthState; children: ReactNode }) {
  const [bootstrapGraceExpired, setBootstrapGraceExpired] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const hasAuthBootstrapHint = Boolean(readAuthBootstrapHint()?.uid);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setBootstrapGraceExpired(true);
    }, protectedRouteBootstrapGraceMs);

    return () => window.clearTimeout(timeoutId);
  }, []);

  if (auth.loading && !auth.user && hasAuthBootstrapHint) {
    return (
      <AppShell auth={auth}>
        <ProtectedRouteLoadingState pathname={location.pathname} />
      </AppShell>
    );
  }

  if (auth.loading && !auth.user) {
    return <LoadingScreen />;
  }

  if (!auth.user && !bootstrapGraceExpired) {
    return <LoadingScreen />;
  }

  if (!auth.user) {
    return <Navigate to="/auth" replace />;
  }

  return (
    <AppShell auth={auth}>
      <ErrorBoundary
        name={`route:${location.pathname}`}
        resetKey={`${location.pathname}${location.search}`}
        onGoHome={() => navigate('/home', { replace: true })}
      >
        <Suspense fallback={<ProtectedRouteLoadingState pathname={location.pathname} />}>
          {children}
        </Suspense>
      </ErrorBoundary>
    </AppShell>
  );
}

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="app-card w-full max-w-sm p-5 text-center">
        <img src="./logo_small.png" alt="" className="mx-auto h-12 w-12 rounded-xl" />
        <div className="mt-3 text-lg font-black text-gray-950">Loading ALL PLAYS</div>
        <div className="mt-1 text-sm font-semibold text-gray-500">Checking your account...</div>
      </div>
    </div>
  );
}

function ProtectedRouteLoadingState({ pathname }: { pathname: string }) {
  return <ProtectedRouteSkeleton pathname={pathname} />;
}
