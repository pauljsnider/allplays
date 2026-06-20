import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const appSource = readFileSync(path.resolve('apps/app/src/App.tsx'), 'utf8');

describe('app protected route bootstrap guard', () => {
    it('keeps a protected-route grace period before redirecting to auth', () => {
        expect(appSource).toContain('const protectedRouteBootstrapGraceMs = 750;');
        expect(appSource).toContain('const [bootstrapGraceExpired, setBootstrapGraceExpired] = useState(false);');
        expect(appSource).toContain('setBootstrapGraceExpired(true);');
        expect(appSource).toContain('if (!auth.user && !bootstrapGraceExpired) {');
        expect(appSource).toContain('return <LoadingScreen />;');
        expect(appSource).toContain('return <Navigate to="/auth" replace />;');
    });
});
