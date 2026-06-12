import { lazy, ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { clearPendingPushRoute, readPendingPushRoute } from './lib/pushNotificationRouting';
import { shouldReloadTeamsToHome } from './lib/reloadRouting';
import { addPushNotificationOpenListener } from './lib/pushService';
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
const TeamDetail = lazy(() => import('./pages/TeamDetail').then((module) => ({ default: module.TeamDetail })));
const TeamSettings = lazy(() => import('./pages/TeamSettings').then((module) => ({ default: module.TeamSettings })));
const TeamCertificates = lazy(() => import('./pages/TeamCertificates').then((module) => ({ default: module.TeamCertificates })));
const TeamDrills = lazy(() => import('./pages/TeamDrills').then((module) => ({ default: module.TeamDrills })));
const TeamFees = lazy(() => import('./pages/TeamFees').then((module) => ({ default: module.TeamFees })));
const TeamMedia = lazy(() => import('./pages/TeamMedia').then((module) => ({ default: module.TeamMedia })));
const Teams = lazy(() => import('./pages/Teams').then((module) => ({ default: module.Teams })));
const VerifyPending = lazy(() => import('./pages/VerifyPending').then((module) => ({ default: module.VerifyPending })));

const protectedRouteBootstrapGraceMs = 3000;

export default function App() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const authUserRef = useRef(auth.user);
  const shouldDefaultReloadToHome = shouldReloadTeamsToHome({
    hasUser: Boolean(auth.user),
    pathname: location.pathname,
    search: location.search,
    isReload: isBrowserReload()
  });

  useEffect(() => {
    authUserRef.current = auth.user;
  }, [auth.user]);

  useEffect(() => {
    let removeListener = async () => {};

    async function registerPushListener() {
      removeListener = await addPushNotificationOpenListener((route) => {
        if (authUserRef.current) {
          navigate(route, { replace: true });
        }
      });
    }

    registerPushListener();
    return () => {
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
        <Route path="/schedule/:teamId/:eventId" element={<Protected auth={auth}><ScheduleEventDetail auth={auth} /></Protected>} />
        <Route path="/messages" element={<Protected auth={auth}><Messages auth={auth} /></Protected>} />
        <Route path="/messages/:teamId" element={<Protected auth={auth}><Messages auth={auth} /></Protected>} />
        <Route path="/ai" element={<Protected auth={auth}><PrivateAiChat auth={auth} /></Protected>} />
        <Route path="/teams" element={shouldDefaultReloadToHome ? <Navigate to="/home" replace /> : <Protected auth={auth}><Teams auth={auth} /></Protected>} />
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
    </Suspense>
  );
}

function isBrowserReload() {
  const navigation = performance.getEntriesByType?.('navigation')?.[0] as PerformanceNavigationTiming | undefined;
  if (navigation?.type) return navigation.type === 'reload';
  return (performance as Performance & { navigation?: { type?: number } }).navigation?.type === 1;
}

function Protected({ auth, children }: { auth: AuthState; children: ReactNode }) {
  const [bootstrapGraceExpired, setBootstrapGraceExpired] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setBootstrapGraceExpired(true);
    }, protectedRouteBootstrapGraceMs);

    return () => window.clearTimeout(timeoutId);
  }, []);

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
      <Suspense fallback={<ProtectedRouteLoadingState />}>
        {children}
      </Suspense>
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

function ProtectedRouteLoadingState() {
  return (
    <div className="app-card flex min-h-[240px] items-center justify-center p-5 text-center">
      <div>
        <div className="text-base font-black text-gray-950">Loading page</div>
        <div className="mt-1 text-sm font-semibold text-gray-500">Preparing your ALL PLAYS workspace...</div>
      </div>
    </div>
  );
}
