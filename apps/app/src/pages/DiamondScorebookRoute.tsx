import { Navigate } from 'react-router-dom';
import { lazyNamedPage } from '../lib/lazyPage';
import { isDiamondScorebookUiEnabled } from '../lib/launchFeatures';
import type { AuthState } from '../lib/types';

const DiamondScorebook = lazyNamedPage(() => import('./DiamondScorebook'), 'DiamondScorebook');

// Authentication is enforced by App's Protected boundary. The rollout gate
// must also cover direct links, not merely hide the schedule launcher.
export function DiamondScorebookRoute({ auth }: { auth: AuthState }) {
  return isDiamondScorebookUiEnabled() ? <DiamondScorebook auth={auth} /> : <Navigate to="/schedule" replace />;
}
