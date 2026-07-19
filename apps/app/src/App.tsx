import { ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import { lazyNamedPage } from './lib/lazyPage';
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
import { isNativeRuntime } from './lib/nativeRuntime';
import { clearPendingPushRoute, readPendingPushRoute } from './lib/pushNotificationRouting';
import { readAuthBootstrapHint } from './lib/authBootstrapHint';
import { getRouteForUser } from './lib/authService';
import { useAuth } from './lib/useAuth';
import type { AuthState } from './lib/types';

const AuthPage = lazyNamedPage(() => import('./pages/AuthPage'), 'AuthPage');
const AcceptInvite = lazyNamedPage(() => import('./pages/AcceptInvite'), 'AcceptInvite');
const CapabilityPage = lazyNamedPage(() => import('./pages/CapabilityPage'), 'CapabilityPage');
const CreateTeam = lazyNamedPage(() => import('./pages/CreateTeam'), 'CreateTeam');
const GameDetail = lazyNamedPage(() => import('./pages/GameDetail'), 'GameDetail');
const HelpArticle = lazyNamedPage(() => import('./pages/HelpArticle'), 'HelpArticle');
const HelpPortal = lazyNamedPage(() => import('./pages/HelpPortal'), 'HelpPortal');
const Home = lazyNamedPage(() => import('./pages/Home'), 'Home');
const Messages = lazyNamedPage(() => import('./pages/Messages'), 'Messages');
const Officials = lazyNamedPage(() => import('./pages/Officials'), 'Officials');
const ParentTools = lazyNamedPage(() => import('./pages/ParentTools'), 'ParentTools');
const RegistrationDetail = lazyNamedPage(() => import('./pages/RegistrationDetail'), 'RegistrationDetail');
const TeamRegistrationReview = lazyNamedPage(() => import('./pages/TeamRegistrationReview'), 'TeamRegistrationReview');
const TeamRegistrationForms = lazyNamedPage(() => import('./pages/TeamRegistrationForms'), 'TeamRegistrationForms');
const PlayerDetail = lazyNamedPage(() => import('./pages/PlayerDetail'), 'PlayerDetail');
const PrivateAiChat = lazyNamedPage(() => import('./pages/PrivateAiChat'), 'PrivateAiChat');
const Profile = lazyNamedPage(() => import('./pages/Profile'), 'Profile');
const FriendProfile = lazyNamedPage(() => import('./pages/FriendProfile'), 'FriendProfile');
const PublicTeamsBrowse = lazyNamedPage(() => import('./pages/PublicTeamsBrowse'), 'PublicTeamsBrowse');
const PublicTeamDetail = lazyNamedPage(() => import('./pages/PublicTeamDetail'), 'PublicTeamDetail');
const Discover = lazyNamedPage(() => import('./pages/Discover'), 'Discover');
const FamilyShare = lazyNamedPage(() => import('./pages/FamilyShare'), 'FamilyShare');
const OpportunityDetail = lazyNamedPage(() => import('./pages/OpportunityDetail'), 'OpportunityDetail');
const OpportunityForm = lazyNamedPage(() => import('./pages/OpportunityForm'), 'OpportunityForm');
const OpportunityManage = lazyNamedPage(() => import('./pages/OpportunityManage'), 'OpportunityManage');
const OpportunityInquiry = lazyNamedPage(() => import('./pages/OpportunityInquiry'), 'OpportunityInquiry');
const ResetPassword = lazyNamedPage(() => import('./pages/ResetPassword'), 'ResetPassword');
const Schedule = lazyNamedPage(() => import('./pages/Schedule'), 'Schedule');
const ScheduleEventDetail = lazyNamedPage(() => import('./pages/ScheduleEventDetail'), 'ScheduleEventDetail');
const StandardTracker = lazyNamedPage(() => import('./pages/StandardTracker'), 'StandardTracker');
const TeamDetail = lazyNamedPage(() => import('./pages/TeamDetail'), 'TeamDetail');
const TeamSettings = lazyNamedPage(() => import('./pages/TeamSettings'), 'TeamSettings');
const TeamCertificates = lazyNamedPage(() => import('./pages/TeamCertificates'), 'TeamCertificates');
const TeamDrills = lazyNamedPage(() => import('./pages/TeamDrills'), 'TeamDrills');
const TeamFees = lazyNamedPage(() => import('./pages/TeamFees'), 'TeamFees');
const TeamMedia = lazyNamedPage(() => import('./pages/TeamMedia'), 'TeamMedia');
const Teams = lazyNamedPage(() => import('./pages/Teams'), 'Teams');
const VerifyPending = lazyNamedPage(() => import('./pages/VerifyPending'), 'VerifyPending');

const protectedRouteBootstrapGraceMs = 750;

export default function App() {
  const auth = useAuth();
  const location = useLocation();
  const signedInUserId = auth.user?.uid ?? null;
  const signedInDefaultRoute = getRouteForUser(auth.user);
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
    if (!signedInUserId) {
      return;
    }

    if (!isNativeRuntime()) {
      return;
    }

    let active = true;
    let removeListener = () => {};

    async function registerPushListener() {
      // Dynamically import the push stack (Firebase messaging) so it stays out of
      // the boot critical path; registration only needs to run after first paint.
      const { addPushNotificationOpenListener, ensureAndroidNotificationChannels } = await import('./lib/pushService');
      const listenerRemoval = addPushNotificationOpenListener((route) => {
        if (authUserRef.current) {
          navigate(route, { replace: true });
        }
      });
      // Channel provisioning is best-effort inside pushService and must not delay
      // notification tap routing during native boot.
      void ensureAndroidNotificationChannels();
      const remove = await listenerRemoval;
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
  }, [signedInUserId, navigate]);

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
        <Route path="/family/:token" element={<PublicPage auth={auth}><FamilyShare /></PublicPage>} />
        <Route path="/discover" element={<PublicPage auth={auth}><Discover auth={auth} /></PublicPage>} />
        <Route path="/discover/opportunities/:listingId" element={<PublicPage auth={auth}><OpportunityDetail auth={auth} /></PublicPage>} />
        <Route path="/discover/new" element={<Protected auth={auth}><OpportunityForm auth={auth} /></Protected>} />
        <Route path="/discover/opportunities/:listingId/edit" element={<Protected auth={auth}><OpportunityForm auth={auth} /></Protected>} />
        <Route path="/discover/manage" element={<Protected auth={auth}><OpportunityManage auth={auth} /></Protected>} />
        <Route path="/discover/inquiries/:inquiryId" element={<Protected auth={auth}><OpportunityInquiry auth={auth} /></Protected>} />
        <Route path="/" element={auth.user ? <Navigate to={signedInDefaultRoute} replace /> : auth.loading ? <LoadingScreen /> : <AppShell auth={auth}><Home auth={auth} /></AppShell>} />
        <Route path="/home" element={auth.user || auth.loading ? <Protected auth={auth}><Home auth={auth} /></Protected> : <AppShell auth={auth}><Home auth={auth} /></AppShell>} />
        <Route path="/officials" element={<Protected auth={auth}><Officials auth={auth} /></Protected>} />
        <Route path="/schedule" element={<Protected auth={auth}><Schedule auth={auth} /></Protected>} />
        <Route path="/schedule/:teamId/:eventId/track" element={<Protected auth={auth}><StandardTracker auth={auth} /></Protected>} />
        <Route path="/schedule/:teamId/:eventId" element={<Protected auth={auth}><ScheduleEventDetail auth={auth} /></Protected>} />
        <Route path="/messages" element={<Protected auth={auth}><Messages auth={auth} /></Protected>} />
        <Route path="/messages/:teamId" element={<Protected auth={auth}><Messages auth={auth} /></Protected>} />
        <Route path="/ai" element={<Protected auth={auth}><PrivateAiChat auth={auth} /></Protected>} />
        <Route path="/teams" element={<Protected auth={auth}><Teams auth={auth} /></Protected>} />
        <Route path="/teams/new" element={<Protected auth={auth}><CreateTeam auth={auth} /></Protected>} />
        <Route path="/teams/browse" element={<PublicPage auth={auth}><PublicTeamsBrowse /></PublicPage>} />
        <Route path="/teams/:teamId/public" element={<PublicPage auth={auth}><PublicTeamDetail /></PublicPage>} />
        <Route path="/teams/:teamId" element={auth.user || auth.loading ? <Protected auth={auth}><TeamDetail auth={auth} /></Protected> : <PublicPage auth={auth}><PublicTeamDetail /></PublicPage>} />
        <Route path="/teams/:teamId/edit" element={<Protected auth={auth}><TeamSettings auth={auth} /></Protected>} />
        <Route path="/teams/:teamId/certificates" element={<Protected auth={auth}><TeamCertificates auth={auth} /></Protected>} />
        <Route path="/teams/:teamId/drills" element={<Protected auth={auth}><TeamDrills auth={auth} /></Protected>} />
        <Route path="/teams/:teamId/fees" element={<Protected auth={auth}><TeamFees auth={auth} /></Protected>} />
        <Route path="/teams/:teamId/fees/:batchId" element={<Protected auth={auth}><TeamFees auth={auth} /></Protected>} />
        <Route path="/teams/:teamId/media" element={<Protected auth={auth}><TeamMedia auth={auth} /></Protected>} />
        <Route path="/teams/:teamId/registration-forms" element={<Protected auth={auth}><TeamRegistrationForms auth={auth} /></Protected>} />
        <Route path="/teams/:teamId/registrations/:formId" element={<Protected auth={auth}><TeamRegistrationReview auth={auth} /></Protected>} />
        <Route path="/parent-tools" element={<Protected auth={auth}><ParentTools auth={auth} /></Protected>} />
        <Route path="/parent-tools/registrations/:teamId/:formId" element={<Protected auth={auth}><RegistrationDetail auth={auth} /></Protected>} />
        <Route path="/parent-tools/:toolId" element={<Protected auth={auth}><ParentTools auth={auth} /></Protected>} />
        <Route path="/players/:teamId/:playerId" element={<Protected auth={auth}><PlayerDetail auth={auth} /></Protected>} />
        <Route path="/players/:playerId" element={<Protected auth={auth}><PlayerDetail auth={auth} /></Protected>} />
        <Route path="/games/:gameId" element={<Protected auth={auth}><GameDetail auth={auth} /></Protected>} />
        <Route path="/help" element={<Protected auth={auth}><HelpPortal auth={auth} /></Protected>} />
        <Route path="/help/:helpId" element={<Protected auth={auth}><HelpArticle /></Protected>} />
        <Route path="/profile" element={<Protected auth={auth}><ProfileHomeRoute auth={auth} /></Protected>} />
        <Route path="/profile/settings" element={<Protected auth={auth}><Profile auth={auth} /></Protected>} />
        <Route path="/people/:userId" element={<Protected auth={auth}><FriendProfile auth={auth} /></Protected>} />
        <Route path="/capabilities/:capabilityId" element={<Protected auth={auth}><CapabilityPage /></Protected>} />
        <Route path="*" element={<Navigate to={auth.user ? signedInDefaultRoute : '/auth'} replace />} />
      </Routes>
      {nativeExitNoticeVisible ? (
        <div className="fixed inset-x-0 bottom-24 z-[80] flex justify-center px-4" role="status" aria-live="polite">
          <div className="rounded-full bg-gray-950 px-4 py-2 text-sm font-black text-white shadow-app-lg">Press back again to exit</div>
        </div>
      ) : null}
    </Suspense>
  );
}

function PublicPage({ auth, children }: { auth: AuthState; children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  if (auth.loading && !auth.user) return <LoadingScreen />;
  return (
    <AppShell auth={auth}>
      <ErrorBoundary
        name={`public-route:${location.pathname}`}
        resetKey={`${location.pathname}${location.search}`}
        onGoHome={() => navigate('/discover', { replace: true })}
      >
        <Suspense fallback={<ProtectedRouteLoadingState pathname={location.pathname} />}>
          {children}
        </Suspense>
      </ErrorBoundary>
    </AppShell>
  );
}

function ProfileHomeRoute({ auth }: { auth: AuthState }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  if (params.has('section') || params.has('teamId')) {
    return <Profile auth={auth} />;
  }
  return <FriendProfile auth={auth} profileUserId={auth.user?.uid} />;
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
