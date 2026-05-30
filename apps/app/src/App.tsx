import { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { AuthPage } from './pages/AuthPage';
import { AcceptInvite } from './pages/AcceptInvite';
import { CapabilityPage } from './pages/CapabilityPage';
import { GameDetail } from './pages/GameDetail';
import { HelpArticle } from './pages/HelpArticle';
import { Home } from './pages/Home';
import { Messages } from './pages/Messages';
import { ParentTools } from './pages/ParentTools';
import { RegistrationDetail } from './pages/RegistrationDetail';
import { PlayerDetail } from './pages/PlayerDetail';
import { PrivateAiChat } from './pages/PrivateAiChat';
import { Profile } from './pages/Profile';
import { ResetPassword } from './pages/ResetPassword';
import { Schedule } from './pages/Schedule';
import { ScheduleEventDetail } from './pages/ScheduleEventDetail';
import { TeamDetail } from './pages/TeamDetail';
import { TeamFees } from './pages/TeamFees';
import { TeamMedia } from './pages/TeamMedia';
import { Teams } from './pages/Teams';
import { VerifyPending } from './pages/VerifyPending';
import { useAuth } from './lib/useAuth';
import type { AuthState } from './lib/types';

export default function App() {
  const auth = useAuth();

  return (
    <Routes>
      <Route path="/auth" element={<AuthPage auth={auth} />} />
      <Route path="/accept-invite" element={<AcceptInvite auth={auth} />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/verify-pending" element={<VerifyPending auth={auth} />} />
      <Route path="/registration" element={<AppShell auth={auth}><RegistrationDetail auth={auth} publicAccess /></AppShell>} />
      <Route path="/" element={<Navigate to={auth.user ? '/home' : '/auth'} replace />} />
      <Route path="/home" element={<Protected auth={auth}><Home auth={auth} /></Protected>} />
      <Route path="/schedule" element={<Protected auth={auth}><Schedule auth={auth} /></Protected>} />
      <Route path="/schedule/:teamId/:eventId" element={<Protected auth={auth}><ScheduleEventDetail auth={auth} /></Protected>} />
      <Route path="/messages" element={<Protected auth={auth}><Messages auth={auth} /></Protected>} />
      <Route path="/messages/:teamId" element={<Protected auth={auth}><Messages auth={auth} /></Protected>} />
      <Route path="/ai" element={<Protected auth={auth}><PrivateAiChat auth={auth} /></Protected>} />
      <Route path="/teams" element={<Protected auth={auth}><Teams auth={auth} /></Protected>} />
      <Route path="/teams/:teamId" element={<Protected auth={auth}><TeamDetail auth={auth} /></Protected>} />
      <Route path="/teams/:teamId/fees" element={<Protected auth={auth}><TeamFees auth={auth} /></Protected>} />
      <Route path="/teams/:teamId/fees/:batchId" element={<Protected auth={auth}><TeamFees auth={auth} /></Protected>} />
      <Route path="/teams/:teamId/media" element={<Protected auth={auth}><TeamMedia auth={auth} /></Protected>} />
      <Route path="/parent-tools" element={<Protected auth={auth}><ParentTools auth={auth} /></Protected>} />
      <Route path="/parent-tools/registrations/:teamId/:formId" element={<Protected auth={auth}><RegistrationDetail auth={auth} /></Protected>} />
      <Route path="/parent-tools/:toolId" element={<Protected auth={auth}><ParentTools auth={auth} /></Protected>} />
      <Route path="/players/:teamId/:playerId" element={<Protected auth={auth}><PlayerDetail auth={auth} /></Protected>} />
      <Route path="/players/:playerId" element={<Protected auth={auth}><PlayerDetail auth={auth} /></Protected>} />
      <Route path="/games/:gameId" element={<Protected auth={auth}><GameDetail auth={auth} /></Protected>} />
      <Route path="/help/:helpId" element={<Protected auth={auth}><HelpArticle /></Protected>} />
      <Route path="/profile" element={<Protected auth={auth}><Profile auth={auth} /></Protected>} />
      <Route path="/capabilities/:capabilityId" element={<Protected auth={auth}><CapabilityPage /></Protected>} />
      <Route path="*" element={<Navigate to={auth.user ? '/home' : '/auth'} replace />} />
    </Routes>
  );
}

function Protected({ auth, children }: { auth: AuthState; children: ReactNode }) {
  if (auth.loading && !auth.user) {
    return <LoadingScreen />;
  }

  if (!auth.user) {
    return <Navigate to="/auth" replace />;
  }

  return <AppShell auth={auth}>{children}</AppShell>;
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
